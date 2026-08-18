require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { initSchema, Products, Orders, Sessions, ChatLogs } = require('./db');
const { initWhatsApp, restartWhatsAppSession, sendWhatsAppMessage, getWhatsAppStatus } = require('./whatsapp/client');

const app = express();
const PORT = process.env.PORT || 3000;
const STORE_NAME = process.env.STORE_NAME || "Gourmet Express";
const STORE_CURRENCY = process.env.STORE_CURRENCY || "$";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// -------------------------------------------------------------
// REST API ENDPOINTS
// -------------------------------------------------------------

// 1. WhatsApp Connection Status & QR Code
app.get('/api/status', (req, res) => {
  res.json({
    storeName: STORE_NAME,
    currency: STORE_CURRENCY,
    ...getWhatsAppStatus()
  });
});

// 1b. Restart WhatsApp Session & Generate Fresh QR Code
app.post('/api/reconnect', async (req, res) => {
  try {
    const status = await restartWhatsAppSession();
    res.json({
      storeName: STORE_NAME,
      currency: STORE_CURRENCY,
      ...status
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// 2. Products API
app.get('/api/products', async (req, res) => {
  try {
    const products = await Products.getAll();
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const productId = await Products.create(req.body);
    const newProduct = await Products.getById(productId);
    res.status(201).json(newProduct);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    await Products.update(req.params.id, req.body);
    const updated = await Products.getById(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    await Products.delete(req.params.id);
    res.json({ success: true, message: `Product ${req.params.id} deleted` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Orders API
app.get('/api/orders', async (req, res) => {
  try {
    const { status } = req.query;
    const orders = await Orders.getAll(status || null);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/orders/:id', async (req, res) => {
  try {
    const order = await Orders.getById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Update Order Status (Triggers Automated WhatsApp Broadcast Message + Feedback Prompt)
app.patch('/api/orders/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'Status is required' });

    const updatedOrder = await Orders.updateStatus(req.params.id, status);
    if (!updatedOrder) return res.status(404).json({ error: 'Order not found' });

    // Format WhatsApp status notification message
    const statusNotification = buildStatusNotificationText(updatedOrder, status);
    
    // Dispatch instant WhatsApp message to customer
    await sendWhatsAppMessage(updatedOrder.customer_phone, statusNotification);
    await ChatLogs.add(updatedOrder.customer_phone, 'agent', statusNotification);

    // If order status is set to 'delivered', trigger Feedback Request Prompt
    if (status === 'delivered') {
      const session = await Sessions.get(updatedOrder.customer_phone);
      session.current_step = 'AWAITING_FEEDBACK';
      await Sessions.save(session);

      const feedbackPrompt = `⭐ *How was your experience with ${STORE_NAME}?* ⭐\n\nYour order #${updatedOrder.id} has been delivered! We'd love your feedback.\n\nPlease reply with a rating from **1 to 5 stars** and any comments on your food and delivery! 🙏`;

      setTimeout(async () => {
        await sendWhatsAppMessage(updatedOrder.customer_phone, feedbackPrompt);
        await ChatLogs.add(updatedOrder.customer_phone, 'agent', feedbackPrompt);
      }, 2000);
    }

    res.json(updatedOrder);
  } catch (err) {
    console.error('Error updating order status:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. Customer Chat Logs API
app.get('/api/orders/:id/chat', async (req, res) => {
  try {
    const order = await Orders.getById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const logs = await ChatLogs.getRecent(order.customer_phone, 50);
    res.json(logs.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper for status notification phrasing
function buildStatusNotificationText(order, status) {
  const currency = STORE_CURRENCY;
  switch (status) {
    case 'confirmed':
      return `✅ *ORDER CONFIRMED!*

Hi! Your order **#${order.id}** (${currency}${order.total_amount.toFixed(2)}) has been confirmed by our team. We are preparing it for you now!`;

    case 'preparing':
      return `👨‍🍳 *KITCHEN IS PREPARING YOUR ORDER!*

Order **#${order.id}** is currently being cooked and freshly packed with love at ${STORE_NAME}!`;

    case 'out_for_delivery':
      return `🛵 *OUT FOR DELIVERY!*

Great news! Your order **#${order.id}** is on its way to:
📍 _${order.delivery_address}_

Our delivery driver will contact you at *${order.contact_number}* upon arrival!`;

    case 'delivered':
      return `🎉 *ORDER DELIVERED!*

Your order **#${order.id}** has been successfully delivered! Enjoy your delicious meal! 🍽️`;

    case 'cancelled':
      return `❌ *ORDER CANCELLED*

Your order **#${order.id}** has been marked as cancelled. If you have any questions, please contact store support.`;

    default:
      return `📢 *ORDER UPDATE*

Your order **#${order.id}** status is now: **${status.toUpperCase()}**.`;
  }
}

// Start Server & Services
async function startServer() {
  await initSchema();
  console.log('Database initialized successfully.');

  app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`🚀 Store Admin Server running at: http://localhost:${PORT}`);
    console.log(`==================================================`);
  });

  // Initialize WhatsApp Baileys Client
  initWhatsApp((statusUpdate) => {
    // Connection status broadcast callback
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
});
