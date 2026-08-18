const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, '../../data/store.db');
const dataDir = path.dirname(dbPath);

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

function initSchema() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Products table
      db.run(`
        CREATE TABLE IF NOT EXISTS products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          category TEXT,
          description TEXT,
          base_price REAL NOT NULL,
          variations TEXT DEFAULT '[]',
          available INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Orders table
      db.run(`
        CREATE TABLE IF NOT EXISTS orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_phone TEXT NOT NULL,
          customer_name TEXT,
          delivery_address TEXT,
          contact_number TEXT,
          items TEXT DEFAULT '[]',
          special_instructions TEXT,
          total_amount REAL NOT NULL,
          status TEXT DEFAULT 'pending',
          feedback_score INTEGER,
          feedback_text TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // User Sessions table
      db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
          customer_phone TEXT PRIMARY KEY,
          current_step TEXT DEFAULT 'IDLE',
          cart TEXT DEFAULT '[]',
          temp_data TEXT DEFAULT '{}',
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Chat logs
      db.run(`
        CREATE TABLE IF NOT EXISTS chat_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_phone TEXT NOT NULL,
          sender TEXT NOT NULL,
          message TEXT NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

module.exports = { db, initSchema };
