const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { handleCustomerMessage } = require('../agent/engine');

let sock = null;
let currentQrCodeDataUrl = null;
let connectionStatus = 'disconnected'; // 'connecting', 'qr_ready', 'connected', 'disconnected'
let statusCallback = null;
const authFolderPath = path.resolve(__dirname, '../../data/baileys_auth');

function ensureAuthDir() {
  if (!fs.existsSync(authFolderPath)) {
    fs.mkdirSync(authFolderPath, { recursive: true });
  }
}

function clearAuthDir() {
  try {
    if (fs.existsSync(authFolderPath)) {
      fs.rmSync(authFolderPath, { recursive: true, force: true });
    }
  } catch (err) {
    console.error('Error clearing auth directory:', err);
  }
  ensureAuthDir();
}

async function initWhatsApp(onStatusUpdate) {
  if (onStatusUpdate) statusCallback = onStatusUpdate;
  ensureAuthDir();

  try {
    const { state, saveCreds } = await useMultiFileAuthState(authFolderPath);
    const { version } = await fetchLatestBaileysVersion();

    connectionStatus = 'connecting';
    if (statusCallback) statusCallback({ status: connectionStatus, qr: currentQrCodeDataUrl });

    if (sock) {
      try {
        sock.ev.removeAllListeners();
        sock.end(undefined);
      } catch (e) {}
      sock = null;
    }

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: ['Gourmet Express Bot', 'Chrome', '1.0.0'],
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 25000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        connectionStatus = 'qr_ready';
        qrcodeTerminal.generate(qr, { small: true });
        try {
          currentQrCodeDataUrl = await QRCode.toDataURL(qr);
        } catch (e) {
          console.error('Failed to generate QR DataURL:', e);
        }
        if (statusCallback) statusCallback({ status: connectionStatus, qr: currentQrCodeDataUrl });
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;

        console.log(`WhatsApp Connection closed (Code: ${statusCode}). Logged out: ${isLoggedOut}`);

        connectionStatus = 'disconnected';
        currentQrCodeDataUrl = null;
        if (statusCallback) statusCallback({ status: connectionStatus, qr: null });

        if (isLoggedOut) {
          console.log('User logged out or session expired. Clearing auth credentials & generating new QR code...');
          clearAuthDir();
          setTimeout(() => initWhatsApp(statusCallback), 2000);
        } else {
          // Reconnect on temporary disconnect or timeout
          setTimeout(() => initWhatsApp(statusCallback), 3000);
        }
      } else if (connection === 'open') {
        connectionStatus = 'connected';
        currentQrCodeDataUrl = null;
        console.log('✅ WhatsApp Web client successfully connected and active!');
        if (statusCallback) statusCallback({ status: connectionStatus, qr: null });
      }
    });

    // Listen for incoming messages
    sock.ev.on('messages.upsert', async (m) => {
      if (m.type !== 'notify') return;

      for (const msg of m.messages) {
        if (msg.key.fromMe) continue; // Ignore bot's own messages
        
        const customerPhone = msg.key.remoteJid;
        if (!customerPhone || customerPhone.includes('@g.us')) continue; // Skip group chats

        const textMessage = msg.message?.conversation ||
                           msg.message?.extendedTextMessage?.text ||
                           msg.message?.imageMessage?.caption || '';

        if (!textMessage.trim()) continue;

        console.log(`📩 Incoming message from [${customerPhone}]: "${textMessage}"`);

        try {
          const responseText = await handleCustomerMessage(customerPhone, textMessage);
          if (responseText && sock) {
            await sock.sendMessage(customerPhone, { text: responseText });
          }
        } catch (err) {
          console.error(`Error processing message from ${customerPhone}:`, err);
        }
      }
    });

  } catch (err) {
    console.error('Fatal error initializing WhatsApp client:', err);
    connectionStatus = 'disconnected';
    if (statusCallback) statusCallback({ status: connectionStatus, qr: null });
  }
}

async function restartWhatsAppSession() {
  console.log('Manually restarting WhatsApp session and clearing old credentials...');
  if (sock) {
    try {
      sock.ev.removeAllListeners();
      sock.end(undefined);
    } catch (e) {}
    sock = null;
  }
  connectionStatus = 'connecting';
  currentQrCodeDataUrl = null;
  clearAuthDir();
  await initWhatsApp(statusCallback);
  return { status: connectionStatus, qr: currentQrCodeDataUrl };
}

function cleanJid(phone) {
  if (!phone) return '';
  const str = String(phone).trim();
  if (str.endsWith('@s.whatsapp.net') || str.endsWith('@lid')) {
    return str;
  }
  const digitsOnly = str.split('@')[0].replace(/[^0-9]/g, '');
  if (!digitsOnly) return '';
  return `${digitsOnly}@s.whatsapp.net`;
}


/**
 * Send an outbound message to a customer phone number
 */
async function sendWhatsAppMessage(customerPhone, textMessage) {
  if (!sock) {
    console.warn(`[sendWhatsAppMessage] Cannot send WhatsApp message. Client socket is null.`);
    return false;
  }

  const jid = cleanJid(customerPhone);
  if (!jid) {
    console.warn(`[sendWhatsAppMessage] Invalid phone number provided: ${customerPhone}`);
    return false;
  }

  try {
    console.log(`[sendWhatsAppMessage] Sending WhatsApp notification to [${jid}]...`);
    await sock.sendMessage(jid, { text: textMessage });
    console.log(`[sendWhatsAppMessage] ✅ WhatsApp notification sent to [${jid}]`);
    return true;
  } catch (err) {
    console.error(`[sendWhatsAppMessage] ❌ Failed to send WhatsApp message to ${jid}:`, err.message);
    return false;
  }
}


function getWhatsAppStatus() {
  return {
    status: connectionStatus,
    qr: currentQrCodeDataUrl
  };
}

module.exports = {
  initWhatsApp,
  restartWhatsAppSession,
  sendWhatsAppMessage,
  getWhatsAppStatus
};

