const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Products, Orders, Sessions, ChatLogs } = require('../db');
const { SYSTEM_PROMPT, STORE_NAME, STORE_CURRENCY } = require('./prompt');

const geminiApiKey = process.env.GEMINI_API_KEY || '';
const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

let genAI = null;
if (geminiApiKey.trim().length > 0) {
  try {
    genAI = new GoogleGenerativeAI(geminiApiKey);
  } catch (err) {
    console.warn('Gemini API Init warning:', err.message);
  }
}

/**
  Main Entrypoint for incoming WhatsApp messages
 */
async function handleCustomerMessage(customerPhone, messageText) {
  const cleanMsg = messageText.trim();
  await ChatLogs.add(customerPhone, 'customer', cleanMsg);

  // Fetch or initialize customer session
  let session = await Sessions.get(customerPhone);
  const activeOrder = await Orders.getActiveOrderByPhone(customerPhone);
  const latestOrder = await Orders.getLatestByPhone(customerPhone);

  const lowerMsg = cleanMsg.toLowerCase();

  // 1. GLOBAL INTENT CHECK: Order Status Inquiry
  if (
    lowerMsg.includes('status') ||
    lowerMsg.includes('where is my order') ||
    lowerMsg.includes('track') ||
    lowerMsg.includes('order update') ||
    (lowerMsg.includes('my order') && (lowerMsg.includes('where') || lowerMsg.includes('check') || lowerMsg.includes('when')))
  ) {
    let responseText = '';
    if (activeOrder) {
      responseText = formatOrderStatusMessage(activeOrder);
    } else if (latestOrder) {
      responseText = `Hi there! Your recent order #${latestOrder.id} has already been marked as **${latestOrder.status.toUpperCase()}**. 

If you'd like to place a fresh order today, reply **"Menu"** to view our delicious categories! 🍕`;
    } else {
      responseText = `Hello! I checked our system and couldn't find any active orders under your number right now. 

Would you like to explore our menu and place a new order? Reply **"Menu"** to see our categories today! 😊`;
    }
    await ChatLogs.add(customerPhone, 'agent', responseText);
    return responseText;
  }

  // 2. GLOBAL INTENT CHECK: Feedback submission for delivered order
  if (
    latestOrder &&
    latestOrder.status === 'delivered' &&
    (!latestOrder.feedback_score || session.current_step === 'AWAITING_FEEDBACK') &&
    (isFeedbackMessage(cleanMsg) || session.current_step === 'AWAITING_FEEDBACK')
  ) {
    const { score, comment } = parseFeedback(cleanMsg);
    await Orders.saveFeedback(latestOrder.id, score, comment || cleanMsg);
    session.current_step = 'IDLE';
    await Sessions.save(session);

    const reply = `Thank you so much for your feedback! ⭐ (${score}/5 Stars)
We truly appreciate your support and look forward to serving you again at ${STORE_NAME}! Have a wonderful day! ❤️`;

    await ChatLogs.add(customerPhone, 'agent', reply);
    return reply;
  }

  // 3. GLOBAL INTENT CHECK: Cancel or Start Over
  if (lowerMsg === 'cancel' || lowerMsg === 'reset' || lowerMsg === 'start over' || lowerMsg === 'clear') {
    await Sessions.clear(customerPhone);
    const reply = `No problem at all! I've cleared your current request. Whenever you're ready to order, just say **"Hi"** or **"Menu"**! 🛒`;
    await ChatLogs.add(customerPhone, 'agent', reply);
    return reply;
  }

  // 4. MULTI-STEP ORDERING STATE MACHINE
  let agentResponse = '';

  switch (session.current_step) {
    case 'IDLE':
      agentResponse = await handleIdleState(session, cleanMsg);
      break;

    case 'SELECTING_CATEGORY':
      agentResponse = await handleSelectingCategoryState(session, cleanMsg);
      break;

    case 'SELECTING_ITEMS':
      agentResponse = await handleSelectingItemsState(session, cleanMsg);
      break;

    case 'PROVIDING_ADDRESS':
      agentResponse = await handleAddressState(session, cleanMsg);
      break;

    case 'PROVIDING_PHONE':
      agentResponse = await handlePhoneState(session, cleanMsg);
      break;

    case 'PROVIDING_INSTRUCTIONS':
      agentResponse = await handleInstructionsState(session, cleanMsg);
      break;

    case 'CONFIRMING_ORDER':
      agentResponse = await handleConfirmationState(session, cleanMsg);
      break;

    default:
      session.current_step = 'IDLE';
      await Sessions.save(session);
      agentResponse = await handleIdleState(session, cleanMsg);
      break;
  }

  await Sessions.save(session);
  await ChatLogs.add(customerPhone, 'agent', agentResponse);
  return agentResponse;
}

// -------------------------------------------------------------
// State Handlers
// -------------------------------------------------------------

async function handleIdleState(session, messageText) {
  const products = await Products.getAll();
  
  session.current_step = 'SELECTING_CATEGORY';
  session.cart = [];
  session.temp_data = {};

  const categories = getUniqueCategories(products);
  const categoriesText = formatCategoriesDisplay(categories, products);

  return `Welcome to **${STORE_NAME}**! 🍽️

Here are our Menu Categories:

${categoriesText}

Which category would you like to explore today? Reply with the category number (e.g. 1, 2) or name! 😊`;
}

async function handleSelectingCategoryState(session, messageText) {
  const products = await Products.getAll();
  const lowerMsg = messageText.toLowerCase();

  const categories = getUniqueCategories(products);
  const matchedCategory = matchCategory(categories, messageText);

  if (!matchedCategory) {
    if (lowerMsg.includes('all') || lowerMsg.includes('full menu')) {
      session.current_step = 'SELECTING_ITEMS';
      session.temp_data.selectedCategory = 'ALL';
      return `Here is our full menu:\n\n${formatCategoryItems(products)}\n\nPlease reply with the item number or name to choose!`;
    }

    return `I couldn't find that category. 😊

Here are our available Menu Categories:
${formatCategoriesDisplay(categories, products)}

Please reply with the category number (e.g. 1, 2) or name!`;
  }

  // Filter products by selected category
  const categoryProducts = products.filter(p => (p.category || 'General').toLowerCase() === matchedCategory.toLowerCase());
  session.temp_data.selectedCategory = matchedCategory;
  session.current_step = 'SELECTING_ITEMS';

  return `📌 *${matchedCategory.toUpperCase()} MENU*

${formatCategoryItems(categoryProducts)}

Reply with the item number (e.g., 1, 2) or name to select your item!
(Reply **"Categories"** anytime to view other categories)`;
}

async function handleSelectingItemsState(session, messageText) {
  const products = await Products.getAll();
  const lowerMsg = messageText.toLowerCase();

  // Back to categories
  if (lowerMsg === 'categories' || lowerMsg === 'category' || lowerMsg === 'back' || lowerMsg === 'show categories') {
    session.current_step = 'SELECTING_CATEGORY';
    delete session.temp_data.pendingVariationItem;
    const categories = getUniqueCategories(products);
    return `Here are our Menu Categories:\n\n${formatCategoriesDisplay(categories, products)}\n\nWhich category would you like to explore? Reply with the number or category name!`;
  }

  // Checkout / Done
  if (session.cart.length > 0 && (lowerMsg === 'done' || lowerMsg === 'checkout' || lowerMsg === 'that is all' || lowerMsg === 'finish' || lowerMsg === 'no')) {
    session.current_step = 'PROVIDING_ADDRESS';
    return `Great choices! 📍 Please enter your **Full Delivery Address** (Street, Building/House Number, and Area/Landmark):`;
  }

  // Items search scope: category items or full menu fallback
  let searchProducts = products;
  if (session.temp_data.selectedCategory && session.temp_data.selectedCategory !== 'ALL') {
    searchProducts = products.filter(p => (p.category || 'General').toLowerCase() === session.temp_data.selectedCategory.toLowerCase());
  }

  // Handle variation selection response if user is selecting option
  if (session.temp_data.pendingVariationItem) {
    const pending = session.temp_data.pendingVariationItem;
    const currentGroupIdx = pending.selectedOptions.length;
    const currentGroup = pending.variations[currentGroupIdx];

    const selectedOption = matchVariationOption(currentGroup, messageText);
    if (!selectedOption) {
      return `Please select one of the options for **${currentGroup.group}**:\n` +
        currentGroup.options.map((opt, i) => `*${i + 1}.* ${opt.name} (${opt.priceDelta >= 0 ? '+' : ''}${STORE_CURRENCY}${opt.priceDelta.toFixed(2)})`).join('\n');
    }

    pending.selectedOptions.push({
      group: currentGroup.group,
      option: selectedOption.name,
      priceDelta: selectedOption.priceDelta
    });

    if (pending.selectedOptions.length < pending.variations.length) {
      const nextGroupIdx = pending.selectedOptions.length;
      const nextGroup = pending.variations[nextGroupIdx];
      return formatVariationPrompt(pending.name, nextGroup, nextGroupIdx);
    }

    // All variations selected!
    const finalPrice = pending.basePrice + pending.selectedOptions.reduce((sum, opt) => sum + opt.priceDelta, 0);
    const cartItem = {
      productId: pending.productId,
      name: pending.name,
      unitPrice: finalPrice,
      quantity: 1,
      selectedOptions: pending.selectedOptions
    };

    session.cart.push(cartItem);
    delete session.temp_data.pendingVariationItem;

    const cartSummary = formatCartSummary(session.cart);
    return `Added **${cartItem.name}** (${pending.selectedOptions.map(o => o.option).join(', ')}) to your order! 🛒\n\n${cartSummary}\n\nWhat would you like to do next?\n• Reply with another item number to add more\n• Reply **"Categories"** to browse another category\n• Reply **"Done"** to enter delivery address`;
  }

  // Try matching product
  let foundItem = matchProduct(searchProducts, messageText);
  if (!foundItem && searchProducts !== products) {
    foundItem = matchProduct(products, messageText);
  }

  if (!foundItem) {
    return `I couldn't find that item in the current selection. 😅

You can:
• Reply with a valid item number from the list above
• Reply **"Categories"** to view all categories
• Reply **"Done"** to proceed to checkout!`;
  }

  // Check variations
  if (foundItem.variations && foundItem.variations.length > 0 && !session.temp_data.pendingVariationItem) {
    session.temp_data.pendingVariationItem = {
      productId: foundItem.id,
      name: foundItem.name,
      basePrice: foundItem.base_price,
      variations: foundItem.variations,
      selectedOptions: []
    };

    const varGroup = foundItem.variations[0];
    return formatVariationPrompt(foundItem.name, varGroup, 0);
  }

  // Direct item without variations
  const cartItem = {
    productId: foundItem.id,
    name: foundItem.name,
    unitPrice: foundItem.base_price,
    quantity: 1,
    selectedOptions: []
  };

  session.cart.push(cartItem);
  const cartSummary = formatCartSummary(session.cart);

  return `Added **${foundItem.name}** (${STORE_CURRENCY}${foundItem.base_price.toFixed(2)}) to your order! 🛒\n\n${cartSummary}\n\nWhat would you like to do next?\n• Reply with another item number to add more\n• Reply **"Categories"** to browse another category\n• Reply **"Done"** to enter delivery address`;
}

async function handleAddressState(session, messageText) {
  if (messageText.trim().length < 5) {
    return `Please provide a complete delivery address (e.g. "123 Maple Street, Apt 4B, Near City Park") so our courier can reach you smoothly! 📍`;
  }

  session.temp_data.deliveryAddress = messageText.trim();
  session.current_step = 'PROVIDING_PHONE';

  return `Got it! Delivery address saved: 
📍 *${session.temp_data.deliveryAddress}*

📞 Next, what is the best **Contact Phone Number** for the delivery driver to call? (Reply **"Same"** to use your WhatsApp number, or enter a number):`;
}

async function handlePhoneState(session, messageText) {
  const lowerMsg = messageText.toLowerCase();
  let contactNumber = messageText.trim();

  if (lowerMsg.includes('same') || lowerMsg.includes('this number') || lowerMsg.includes('whatsapp')) {
    contactNumber = session.customer_phone.replace('@s.whatsapp.net', '').replace(/[^0-9+]/g, '');
  }

  session.temp_data.contactNumber = contactNumber;
  session.current_step = 'PROVIDING_INSTRUCTIONS';

  return `Contact number recorded: 📞 *${contactNumber}*

📝 Do you have any **Special Instructions** for your order or delivery driver? (e.g., "Extra spicy", "Ring doorbell twice", "Leave with receptionist", or reply **"None"**):`;
}

async function handleInstructionsState(session, messageText) {
  const lowerMsg = messageText.toLowerCase();
  session.temp_data.specialInstructions = (lowerMsg === 'none' || lowerMsg === 'no' || lowerMsg === 'n/a')
    ? 'None'
    : messageText.trim();

  session.current_step = 'CONFIRMING_ORDER';

  const orderSummary = formatOrderConfirmation(session);

  return `Please review your final order details below:

${orderSummary}

Reply **"Confirm"** (or **"Yes"**) to place your order now, or **"Cancel"** to start over! 🚀`;
}

async function handleConfirmationState(session, messageText) {
  const lowerMsg = messageText.toLowerCase();

  if (lowerMsg.includes('yes') || lowerMsg.includes('confirm') || lowerMsg.includes('ok') || lowerMsg.includes('place')) {
    const totalAmount = session.cart.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);

    const orderId = await Orders.create({
      customer_phone: session.customer_phone,
      customer_name: session.temp_data.customerName || 'WhatsApp Customer',
      delivery_address: session.temp_data.deliveryAddress,
      contact_number: session.temp_data.contactNumber,
      items: session.cart,
      special_instructions: session.temp_data.specialInstructions,
      total_amount: totalAmount
    });

    await Sessions.clear(session.customer_phone);

    return `🎉 **Order Placed Successfully!**

Order ID: **#${orderId}**
Total Amount: **${STORE_CURRENCY}${totalAmount.toFixed(2)}**
Status: ⏳ **Pending Confirmation**

Our kitchen has received your order! We will send you live updates right here on WhatsApp as your order progresses.

Thank you for choosing ${STORE_NAME}! 💚`;
  }

  if (lowerMsg.includes('cancel') || lowerMsg.includes('no')) {
    await Sessions.clear(session.customer_phone);
    return `Your order draft has been cancelled. Whenever you'd like to order again, just send us a message! 😊`;
  }

  return `Please reply **"Confirm"** to place your order or **"Cancel"** if you wish to stop.`;
}

// -------------------------------------------------------------
// Helper Formatting & Matching Functions
// -------------------------------------------------------------

function getUniqueCategories(products) {
  const cats = [];
  products.forEach(p => {
    const c = p.category || 'General';
    if (!cats.includes(c)) cats.push(c);
  });
  return cats;
}

function formatCategoriesDisplay(categories, products) {
  const categoryEmojis = {
    'Pizzas': '🍕',
    'Burgers': '🍔',
    'Starters': '🍗',
    'Pastas': '🍝',
    'Drinks': '🥤',
    'Desserts': '🍰'
  };

  let text = '';
  categories.forEach((cat, idx) => {
    const count = products.filter(p => (p.category || 'General') === cat).length;
    const emoji = categoryEmojis[cat] || '📌';
    text += `*${idx + 1}.* ${emoji} *${cat}* _(${count} item${count > 1 ? 's' : ''})_\n`;
  });
  return text.trim();
}

function formatCategoryItems(categoryProducts) {
  if (!categoryProducts || categoryProducts.length === 0) return "No items in this category.";

  let text = "";
  categoryProducts.forEach((p, idx) => {
    text += `*${idx + 1}. ${p.name}* - ${STORE_CURRENCY}${p.base_price.toFixed(2)}\n_${p.description}_\n`;
    if (p.variations && p.variations.length > 0) {
      const varTypes = p.variations.map(v => v.group).join(', ');
      text += `   ⚙️ Options: ${varTypes}\n`;
    }
    text += `\n`;
  });

  return text.trim();
}

function matchCategory(categories, text) {
  const clean = text.trim().toLowerCase();
  const num = parseInt(clean, 10);
  if (!isNaN(num) && num >= 1 && num <= categories.length) {
    return categories[num - 1];
  }
  return categories.find(cat => cat.toLowerCase().includes(clean) || clean.includes(cat.toLowerCase()));
}

function formatVariationPrompt(itemName, varGroup, groupIdx) {
  let prompt = `For *${itemName}*, please choose your **${varGroup.group}**:\n\n`;
  varGroup.options.forEach((opt, idx) => {
    const deltaStr = opt.priceDelta > 0 ? ` (+${STORE_CURRENCY}${opt.priceDelta.toFixed(2)})` : (opt.priceDelta < 0 ? ` (-${STORE_CURRENCY}${Math.abs(opt.priceDelta).toFixed(2)})` : '');
    prompt += `*${idx + 1}.* ${opt.name}${deltaStr}\n`;
  });
  prompt += `\nReply with option number (e.g., 1, 2) or option name!`;
  return prompt;
}

function formatCartSummary(cart) {
  let total = 0;
  let text = `🛒 *Your Current Cart:*\n`;
  cart.forEach((item, i) => {
    const itemTotal = item.unitPrice * item.quantity;
    total += itemTotal;
    const opts = item.selectedOptions && item.selectedOptions.length > 0
      ? ` (${item.selectedOptions.map(o => o.option).join(', ')})`
      : '';
    text += `${i + 1}. ${item.name}${opts} x${item.quantity} = ${STORE_CURRENCY}${itemTotal.toFixed(2)}\n`;
  });
  text += `\n*Subtotal: ${STORE_CURRENCY}${total.toFixed(2)}*`;
  return text;
}

function formatOrderConfirmation(session) {
  const cart = session.cart || [];
  let total = 0;
  let text = `📋 *ORDER SUMMARY*\n---------------------\n`;
  cart.forEach(item => {
    const itemTotal = item.unitPrice * item.quantity;
    total += itemTotal;
    const opts = item.selectedOptions && item.selectedOptions.length > 0
      ? ` (${item.selectedOptions.map(o => o.option).join(', ')})`
      : '';
    text += `• ${item.name}${opts} x${item.quantity} - ${STORE_CURRENCY}${itemTotal.toFixed(2)}\n`;
  });
  text += `---------------------\n`;
  text += `💰 *Total Bill:* ${STORE_CURRENCY}${total.toFixed(2)}\n`;
  text += `📍 *Delivery Address:* ${session.temp_data.deliveryAddress}\n`;
  text += `📞 *Contact Phone:* ${session.temp_data.contactNumber}\n`;
  text += `📝 *Instructions:* ${session.temp_data.specialInstructions}\n`;
  return text;
}

function formatOrderStatusMessage(order) {
  const statusEmojiMap = {
    pending: '⏳ Pending Confirmation',
    confirmed: '✅ Confirmed by Kitchen',
    preparing: '👨‍🍳 Preparing your Food',
    out_for_delivery: '🛵 Out for Delivery',
    delivered: '🎉 Delivered',
    cancelled: '❌ Cancelled'
  };

  const statusStr = statusEmojiMap[order.status] || order.status.toUpperCase();

  return `📦 *ORDER STATUS UPDATE*

Order ID: **#${order.id}**
Status: **${statusStr}**
Total Bill: **${STORE_CURRENCY}${order.total_amount.toFixed(2)}**
Delivery to: _${order.delivery_address}_

${order.status === 'out_for_delivery' ? '🛵 Your driver is on the way! Please keep your phone handy.' : 'We are making sure everything is prepared with care!'}

Thank you for your patience! Reply **"Status"** anytime for updates.`;
}

function matchProduct(products, text) {
  const clean = text.trim().toLowerCase();
  const num = parseInt(clean, 10);
  if (!isNaN(num) && num >= 1 && num <= products.length) {
    return products[num - 1];
  }
  return products.find(p => p.name.toLowerCase().includes(clean) || clean.includes(p.name.toLowerCase()));
}

function matchVariationOption(varGroup, text) {
  const clean = text.trim().toLowerCase();
  const num = parseInt(clean, 10);
  if (!isNaN(num) && num >= 1 && num <= varGroup.options.length) {
    return varGroup.options[num - 1];
  }
  return varGroup.options.find(opt => opt.name.toLowerCase().includes(clean) || clean.includes(opt.name.toLowerCase()));
}

function isFeedbackMessage(text) {
  const lower = text.toLowerCase();
  return (
    lower.includes('star') ||
    lower.includes('good') ||
    lower.includes('bad') ||
    lower.includes('delicious') ||
    lower.includes('great') ||
    lower.includes('fast') ||
    lower.includes('slow') ||
    /^[1-5](\/5)?$/ .test(text.trim())
  );
}

function parseFeedback(text) {
  let score = 5;
  const numMatch = text.match(/\b([1-5])\b/);
  if (numMatch) {
    score = parseInt(numMatch[1], 10);
  } else if (text.toLowerCase().includes('bad') || text.toLowerCase().includes('terrible') || text.toLowerCase().includes('worst')) {
    score = 1;
  }
  return { score, comment: text };
}

async function generateAIResponse(promptContext, fallbackText) {
  if (!genAI) return fallbackText;

  try {
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: SYSTEM_PROMPT
    });

    const result = await model.generateContent(promptContext);
    const text = result.response.text();
    return text ? text.trim() : fallbackText;
  } catch (err) {
    console.warn('Gemini API call warning:', err.message);
    return fallbackText;
  }
}

module.exports = {
  handleCustomerMessage,
  formatOrderStatusMessage
};
