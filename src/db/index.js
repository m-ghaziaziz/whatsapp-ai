const { db, initSchema } = require('./schema');

// Promisified DB helpers
function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function getQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function allQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

// Product DAO
const Products = {
  getAll: async () => {
    const rows = await allQuery(`SELECT * FROM products WHERE available = 1 ORDER BY category, name`);
    return rows.map(r => ({
      ...r,
      variations: JSON.parse(r.variations || '[]')
    }));
  },
  getById: async (id) => {
    const row = await getQuery(`SELECT * FROM products WHERE id = ?`, [id]);
    if (!row) return null;
    return {
      ...row,
      variations: JSON.parse(row.variations || '[]')
    };
  },
  create: async ({ name, category, description, base_price, variations }) => {
    const res = await runQuery(
      `INSERT INTO products (name, category, description, base_price, variations) VALUES (?, ?, ?, ?, ?)`,
      [name, category || 'General', description || '', base_price, JSON.stringify(variations || [])]
    );
    return res.id;
  },
  update: async (id, { name, category, description, base_price, variations, available }) => {
    await runQuery(
      `UPDATE products SET name = ?, category = ?, description = ?, base_price = ?, variations = ?, available = ? WHERE id = ?`,
      [name, category, description, base_price, JSON.stringify(variations || []), available ? 1 : 0, id]
    );
  },
  delete: async (id) => {
    await runQuery(`DELETE FROM products WHERE id = ?`, [id]);
  }
};

// Order DAO
const Orders = {
  getAll: async (statusFilter = null) => {
    let sql = `SELECT * FROM orders ORDER BY created_at DESC`;
    let params = [];
    if (statusFilter) {
      sql = `SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC`;
      params = [statusFilter];
    }
    const rows = await allQuery(sql, params);
    return rows.map(r => ({
      ...r,
      items: JSON.parse(r.items || '[]')
    }));
  },
  getById: async (id) => {
    const row = await getQuery(`SELECT * FROM orders WHERE id = ?`, [id]);
    if (!row) return null;
    return {
      ...row,
      items: JSON.parse(row.items || '[]')
    };
  },
  getLatestByPhone: async (phone) => {
    const row = await getQuery(
      `SELECT * FROM orders WHERE customer_phone = ? ORDER BY created_at DESC LIMIT 1`,
      [phone]
    );
    if (!row) return null;
    return {
      ...row,
      items: JSON.parse(row.items || '[]')
    };
  },
  getActiveOrderByPhone: async (phone) => {
    const row = await getQuery(
      `SELECT * FROM orders WHERE customer_phone = ? AND status IN ('pending', 'confirmed', 'preparing', 'out_for_delivery') ORDER BY created_at DESC LIMIT 1`,
      [phone]
    );
    if (!row) return null;
    return {
      ...row,
      items: JSON.parse(row.items || '[]')
    };
  },
  create: async ({ customer_phone, customer_name, delivery_address, contact_number, items, special_instructions, total_amount }) => {
    const res = await runQuery(
      `INSERT INTO orders (customer_phone, customer_name, delivery_address, contact_number, items, special_instructions, total_amount, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        customer_phone,
        customer_name || 'Customer',
        delivery_address,
        contact_number,
        JSON.stringify(items || []),
        special_instructions || 'None',
        total_amount
      ]
    );
    return res.id;
  },
  updateStatus: async (id, status) => {
    await runQuery(
      `UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, id]
    );
    return Orders.getById(id);
  },
  saveFeedback: async (id, score, text) => {
    await runQuery(
      `UPDATE orders SET feedback_score = ?, feedback_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [score, text, id]
    );
    return Orders.getById(id);
  }
};

// User Session DAO
const Sessions = {
  get: async (phone) => {
    const row = await getQuery(`SELECT * FROM sessions WHERE customer_phone = ?`, [phone]);
    if (!row) {
      // Return default initial session structure
      return {
        customer_phone: phone,
        current_step: 'IDLE',
        cart: [],
        temp_data: {}
      };
    }
    return {
      customer_phone: row.customer_phone,
      current_step: row.current_step,
      cart: JSON.parse(row.cart || '[]'),
      temp_data: JSON.parse(row.temp_data || '{}')
    };
  },
  save: async (session) => {
    const { customer_phone, current_step, cart, temp_data } = session;
    await runQuery(
      `INSERT INTO sessions (customer_phone, current_step, cart, temp_data, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(customer_phone) DO UPDATE SET
         current_step = excluded.current_step,
         cart = excluded.cart,
         temp_data = excluded.temp_data,
         updated_at = CURRENT_TIMESTAMP`,
      [customer_phone, current_step, JSON.stringify(cart || []), JSON.stringify(temp_data || {})]
    );
  },
  clear: async (phone) => {
    await runQuery(
      `UPDATE sessions SET current_step = 'IDLE', cart = '[]', temp_data = '{}', updated_at = CURRENT_TIMESTAMP WHERE customer_phone = ?`,
      [phone]
    );
  }
};

// Chat Logs DAO
const ChatLogs = {
  add: async (customer_phone, sender, message) => {
    await runQuery(
      `INSERT INTO chat_logs (customer_phone, sender, message) VALUES (?, ?, ?)`,
      [customer_phone, sender, message]
    );
  },
  getRecent: async (customer_phone, limit = 20) => {
    return await allQuery(
      `SELECT * FROM chat_logs WHERE customer_phone = ? ORDER BY timestamp DESC LIMIT ?`,
      [customer_phone, limit]
    );
  }
};

module.exports = {
  initSchema,
  Products,
  Orders,
  Sessions,
  ChatLogs
};
