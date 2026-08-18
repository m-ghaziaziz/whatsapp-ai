// Global State
let currentFilter = 'all';
let ordersData = [];
let productsData = [];
let storeCurrency = '$';

// DOM Elements
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const statusDesc = document.getElementById('statusDesc');
const btnOpenQrModal = document.getElementById('btnOpenQrModal');

const qrModal = document.getElementById('qrModal');
const btnCloseQrModal = document.getElementById('btnCloseQrModal');
const qrBox = document.getElementById('qrBox');

const chatModal = document.getElementById('chatModal');
const btnCloseChatModal = document.getElementById('btnCloseChatModal');
const chatLogsBox = document.getElementById('chatLogsBox');

const productModal = document.getElementById('productModal');
const btnCloseProductModal = document.getElementById('btnCloseProductModal');
const btnCancelProductModal = document.getElementById('btnCancelProductModal');
const btnAddProduct = document.getElementById('btnAddProduct');
const productForm = document.getElementById('productForm');

const ordersContainer = document.getElementById('ordersContainer');
const productsContainer = document.getElementById('productsContainer');
const feedbacksContainer = document.getElementById('feedbacksContainer');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupEventListeners();
  fetchWhatsAppStatus();
  fetchOrders();
  fetchProducts();

  // Poll for live status & order updates
  setInterval(fetchWhatsAppStatus, 4000);
  setInterval(fetchOrders, 6000);
});

// Navigation Setup
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const tabContents = document.querySelectorAll('.tab-content');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(n => n.classList.remove('active'));
      tabContents.forEach(tc => tc.classList.remove('active'));

      item.classList.add('active');
      const tabId = `tab-${item.dataset.tab}`;
      document.getElementById(tabId).classList.add('active');

      if (item.dataset.tab === 'orders') fetchOrders();
      if (item.dataset.tab === 'products') fetchProducts();
      if (item.dataset.tab === 'feedbacks') renderFeedbacks();
    });
  });

  // Filter Pills Setup
  const filterPills = document.querySelectorAll('.filter-pill');
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentFilter = pill.dataset.filter;
      renderOrders();
    });
  });
}

let qrPollTimer = null;

// Event Listeners
function setupEventListeners() {
  btnOpenQrModal.addEventListener('click', async () => {
    qrModal.classList.add('active');
    
    // Fast poll every 1s while modal is open to capture QR instantly
    if (qrPollTimer) clearInterval(qrPollTimer);
    qrPollTimer = setInterval(fetchWhatsAppStatus, 1000);

    const data = await fetchWhatsAppStatus();
    if (data && data.status === 'disconnected') {
      await triggerReconnect();
    }
  });

  btnCloseQrModal.addEventListener('click', () => {
    qrModal.classList.remove('active');
    if (qrPollTimer) {
      clearInterval(qrPollTimer);
      qrPollTimer = null;
    }
  });

  btnCloseChatModal.addEventListener('click', () => chatModal.classList.remove('active'));

  btnAddProduct.addEventListener('click', () => {
    document.getElementById('prodId').value = '';
    document.getElementById('productModalTitle').textContent = 'Add New Product';
    productForm.reset();
    productModal.classList.add('active');
  });

  btnCloseProductModal.addEventListener('click', () => productModal.classList.remove('active'));
  btnCancelProductModal.addEventListener('click', () => productModal.classList.remove('active'));

  document.getElementById('btnRefresh').addEventListener('click', () => {
    fetchOrders();
    fetchProducts();
    fetchWhatsAppStatus();
  });

  productForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveProduct();
  });
}

// Trigger Session Reset & Fresh QR Code Generation
async function triggerReconnect() {
  try {
    statusDot.className = 'status-indicator-dot disconnected';
    statusText.textContent = 'Generating QR...';
    statusDesc.textContent = 'Refreshing WhatsApp authentication session...';
    qrBox.innerHTML = `
      <div class="spinner"></div>
      <p style="margin-top: 12px; color: #9CA3AF;">Generating fresh QR code...</p>
    `;

    const res = await fetch('/api/reconnect', { method: 'POST' });
    const data = await res.json();
    updateStatusUI(data);
    return data;
  } catch (err) {
    console.error('Failed to reconnect session:', err);
  }
}

// Fetch WhatsApp Connection Status
async function fetchWhatsAppStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    updateStatusUI(data);
    return data;
  } catch (err) {
    console.error('Failed to fetch status:', err);
  }
}

function updateStatusUI(data) {
  if (!data) return;
  if (data.currency) storeCurrency = data.currency;

  if (data.status === 'connected') {
    statusDot.className = 'status-indicator-dot connected';
    statusText.textContent = 'WhatsApp Active';
    statusDesc.textContent = 'Bot connected and receiving customer orders!';
    qrBox.innerHTML = `
      <i class="ri-checkbox-circle-fill" style="font-size: 64px; color: #10B981;"></i>
      <p style="margin-top: 12px; font-weight: 600; color: #10B981;">WhatsApp is Fully Connected!</p>
      <button onclick="triggerReconnect()" class="btn-secondary" style="margin-top: 16px;">Disconnect / Pair New Account</button>
    `;
  } else if (data.status === 'qr_ready' && data.qr) {
    statusDot.className = 'status-indicator-dot';
    statusText.textContent = 'Action Required';
    statusDesc.textContent = 'Scan QR Code to pair WhatsApp.';
    qrBox.innerHTML = `<img src="${data.qr}" alt="WhatsApp QR Code">`;
  } else if (data.status === 'connecting') {
    statusDot.className = 'status-indicator-dot disconnected';
    statusText.textContent = 'Connecting...';
    statusDesc.textContent = 'Initializing WhatsApp Web...';
    qrBox.innerHTML = `
      <div class="spinner"></div>
      <p style="margin-top: 12px; color: #9CA3AF;">Generating QR code... Please wait a few seconds.</p>
    `;
  } else {
    statusDot.className = 'status-indicator-dot disconnected';
    statusText.textContent = 'Disconnected';
    statusDesc.textContent = 'Click button to generate QR Code.';
    qrBox.innerHTML = `
      <div class="spinner"></div>
      <p style="margin-top: 12px; color: #9CA3AF;">Session disconnected. Click below to generate new QR Code.</p>
      <button onclick="triggerReconnect()" class="btn-accent" style="margin-top: 16px;">Generate New QR Code</button>
    `;
  }
}



// Fetch Orders
async function fetchOrders() {
  try {
    const res = await fetch('/api/orders');
    ordersData = await res.json();
    updateBadgeCounts();
    renderOrders();
    renderFeedbacks();
  } catch (err) {
    console.error('Failed to fetch orders:', err);
  }
}

// Update Badge Counters
function updateBadgeCounts() {
  const counts = {
    pending: 0,
    confirmed: 0,
    preparing: 0,
    out_for_delivery: 0,
    delivered: 0
  };

  ordersData.forEach(o => {
    if (counts[o.status] !== undefined) counts[o.status]++;
  });

  document.getElementById('pendingBadge').textContent = counts.pending;
  document.getElementById('cnt-pending').textContent = counts.pending;
  document.getElementById('cnt-confirmed').textContent = counts.confirmed;
  document.getElementById('cnt-preparing').textContent = counts.preparing;
  document.getElementById('cnt-out').textContent = counts.out_for_delivery;
  document.getElementById('cnt-delivered').textContent = counts.delivered;
}

// Render Orders
function renderOrders() {
  const filtered = currentFilter === 'all'
    ? ordersData
    : ordersData.filter(o => o.status === currentFilter);

  if (filtered.length === 0) {
    ordersContainer.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; color: #6B7280;">
        <i class="ri-shopping-bag-line" style="font-size: 48px; margin-bottom: 12px; display: block;"></i>
        <h3>No orders found</h3>
        <p>No customer orders currently in this status.</p>
      </div>
    `;
    return;
  }

  ordersContainer.innerHTML = filtered.map(o => `
    <div class="order-card">
      <div class="order-card-header">
        <span class="order-id">Order #${o.id}</span>
        <span class="status-pill ${o.status}">${formatStatusLabel(o.status)}</span>
      </div>

      <div class="customer-info">
        <div class="customer-phone"><i class="ri-whatsapp-line"></i> ${o.customer_phone.replace('@s.whatsapp.net', '')}</div>
        <div class="delivery-addr"><i class="ri-map-pin-2-line"></i> ${escapeHtml(o.delivery_address || 'N/A')}</div>
        <div class="delivery-addr"><i class="ri-phone-line"></i> Contact: ${escapeHtml(o.contact_number || 'N/A')}</div>
      </div>

      <div class="order-items-list">
        ${(o.items || []).map(item => `
          <div class="order-item-row">
            <div>
              <strong>${escapeHtml(item.name)} x${item.quantity}</strong>
              ${item.selectedOptions && item.selectedOptions.length > 0
                ? `<span class="item-opts">${item.selectedOptions.map(opt => `${opt.group}: ${opt.option}`).join(', ')}</span>`
                : ''}
            </div>
            <div>${storeCurrency}${(item.unitPrice * item.quantity).toFixed(2)}</div>
          </div>
        `).join('')}
        <div class="order-total-row">
          <span>Total Bill</span>
          <span style="color: #10B981;">${storeCurrency}${o.total_amount.toFixed(2)}</span>
        </div>
      </div>

      ${o.special_instructions && o.special_instructions !== 'None' ? `
        <div class="instructions-box">
          <i class="ri-information-line"></i> <strong>Note:</strong> ${escapeHtml(o.special_instructions)}
        </div>
      ` : ''}

      <div class="order-actions">
        <select class="select-status" onchange="updateOrderStatus(${o.id}, this.value)">
          <option value="pending" ${o.status === 'pending' ? 'selected' : ''}>⏳ Pending</option>
          <option value="confirmed" ${o.status === 'confirmed' ? 'selected' : ''}>✅ Confirmed</option>
          <option value="preparing" ${o.status === 'preparing' ? 'selected' : ''}>👨‍🍳 Preparing</option>
          <option value="out_for_delivery" ${o.status === 'out_for_delivery' ? 'selected' : ''}>🛵 Out for Delivery</option>
          <option value="delivered" ${o.status === 'delivered' ? 'selected' : ''}>🎉 Delivered</option>
          <option value="cancelled" ${o.status === 'cancelled' ? 'selected' : ''}>❌ Cancelled</option>
        </select>
        <button class="btn-chat-log" onclick="openChatModal(${o.id})">
          <i class="ri-chat-history-line"></i> Chat
        </button>
      </div>
    </div>
  `).join('');
}

// Update Order Status API Call
async function updateOrderStatus(orderId, newStatus) {
  try {
    const res = await fetch(`/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    if (res.ok) {
      await fetchOrders();
    } else {
      alert('Failed to update status.');
    }
  } catch (err) {
    console.error('Error updating status:', err);
  }
}

// Open Chat Transcript Modal
async function openChatModal(orderId) {
  try {
    chatLogsBox.innerHTML = `<div class="spinner"></div>`;
    chatModal.classList.add('active');

    const res = await fetch(`/api/orders/${orderId}/chat`);
    const logs = await res.json();

    if (logs.length === 0) {
      chatLogsBox.innerHTML = `<p style="color: #9CA3AF; text-align: center;">No chat records found.</p>`;
      return;
    }

    chatLogsBox.innerHTML = logs.map(msg => `
      <div class="chat-bubble ${msg.sender}">
        <div>${escapeHtml(msg.message)}</div>
        <span class="timestamp">${new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load chat logs:', err);
  }
}

// Fetch Products
async function fetchProducts() {
  try {
    const res = await fetch('/api/products');
    productsData = await res.json();
    renderProducts();
  } catch (err) {
    console.error('Failed to fetch products:', err);
  }
}

// Render Products
function renderProducts() {
  if (productsData.length === 0) {
    productsContainer.innerHTML = `<p style="color: #9CA3AF; grid-column: 1/-1; text-align: center;">No menu items added yet.</p>`;
    return;
  }

  productsContainer.innerHTML = productsData.map(p => `
    <div class="product-card">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <span style="font-size: 11px; background: rgba(59, 130, 246, 0.2); color: #60A5FA; padding: 2px 8px; border-radius: 12px; font-weight: 600;">${escapeHtml(p.category)}</span>
        <span style="font-size: 16px; font-weight: 700; color: #10B981;">${storeCurrency}${p.base_price.toFixed(2)}</span>
      </div>
      <h3 style="font-size: 16px; font-weight: 700;">${escapeHtml(p.name)}</h3>
      <p style="font-size: 12px; color: #9CA3AF;">${escapeHtml(p.description || 'No description.')}</p>

      ${p.variations && p.variations.length > 0 ? `
        <div style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 8px; font-size: 11px; color: #9CA3AF;">
          <strong>Variations:</strong> ${p.variations.map(v => `${v.group} (${v.options ? v.options.length : 0} options)`).join(', ')}
        </div>
      ` : ''}

      <div style="display: flex; gap: 8px; margin-top: auto;">
        <button class="btn-secondary" style="flex: 1;" onclick="editProduct(${p.id})">Edit</button>
        <button class="btn-secondary" style="color: #EF4444;" onclick="deleteProduct(${p.id})">Delete</button>
      </div>
    </div>
  `).join('');
}

// Save Product
async function saveProduct() {
  const id = document.getElementById('prodId').value;
  const name = document.getElementById('prodName').value;
  const category = document.getElementById('prodCategory').value;
  const base_price = parseFloat(document.getElementById('prodPrice').value);
  const description = document.getElementById('prodDesc').value;
  const varText = document.getElementById('prodVariations').value;

  let variations = [];
  if (varText.trim().length > 0) {
    try {
      variations = JSON.parse(varText);
    } catch (e) {
      alert('Invalid JSON syntax in Variations field.');
      return;
    }
  }

  const payload = { name, category, base_price, description, variations, available: 1 };

  try {
    const url = id ? `/api/products/${id}` : '/api/products';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      productModal.classList.remove('active');
      await fetchProducts();
    } else {
      alert('Failed to save product');
    }
  } catch (err) {
    console.error('Error saving product:', err);
  }
}

// Edit Product Modal
function editProduct(id) {
  const p = productsData.find(item => item.id === id);
  if (!p) return;

  document.getElementById('prodId').value = p.id;
  document.getElementById('productModalTitle').textContent = 'Edit Product';
  document.getElementById('prodName').value = p.name;
  document.getElementById('prodCategory').value = p.category;
  document.getElementById('prodPrice').value = p.base_price;
  document.getElementById('prodDesc').value = p.description || '';
  document.getElementById('prodVariations').value = JSON.stringify(p.variations || [], null, 2);

  productModal.classList.add('active');
}

// Delete Product
async function deleteProduct(id) {
  if (!confirm('Are you sure you want to delete this menu item?')) return;
  try {
    const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
    if (res.ok) fetchProducts();
  } catch (err) {
    console.error('Error deleting product:', err);
  }
}

// Render Feedbacks
function renderFeedbacks() {
  const feedbacks = ordersData.filter(o => o.feedback_score !== null && o.feedback_score !== undefined);

  if (feedbacks.length === 0) {
    feedbacksContainer.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; color: #6B7280;">
        <i class="ri-star-smile-line" style="font-size: 48px; margin-bottom: 12px; display: block;"></i>
        <h3>No feedback received yet</h3>
        <p>When completed orders are marked as Delivered, customers are automatically prompted to rate their experience!</p>
      </div>
    `;
    return;
  }

  feedbacksContainer.innerHTML = feedbacks.map(f => `
    <div class="feedback-card">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight: 700; color: #10B981;">Order #${f.id}</span>
        <div class="feedback-stars">
          ${'★'.repeat(f.feedback_score)}${'☆'.repeat(5 - f.feedback_score)}
        </div>
      </div>
      <p style="font-size: 14px; font-style: italic; color: #F9FAFB;">"${escapeHtml(f.feedback_text || 'No comment provided.')}"</p>
      <div style="font-size: 12px; color: #9CA3AF; margin-top: auto;">
        From: ${f.customer_phone.replace('@s.whatsapp.net', '')} • ${new Date(f.updated_at).toLocaleDateString()}
      </div>
    </div>
  `).join('');
}

// Helpers
function formatStatusLabel(s) {
  const map = {
    pending: '⏳ Pending',
    confirmed: '✅ Confirmed',
    preparing: '👨‍🍳 Preparing',
    out_for_delivery: '🛵 Out for Delivery',
    delivered: '🎉 Delivered',
    cancelled: '❌ Cancelled'
  };
  return map[s] || s;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
