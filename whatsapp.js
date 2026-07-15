const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

let sock = null;
let isReady = false;
let reconnectAttempts = 0;
let latestQr = null;

// In-memory message log (max 100 entries, FIFO)
const messageLog = [];

function appendLog(entry) {
  messageLog.unshift({ ...entry, timestamp: new Date().toISOString() });
  if (messageLog.length > 100) messageLog.pop();
}

function getLogs() {
  return messageLog;
}

async function initWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();
    console.log('Menggunakan WA Web version:', version.join('.'));

    sock = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        latestQr = await QRCode.toDataURL(qr);
      }

      if (connection === 'open') {
        isReady = true;
        latestQr = null;
        reconnectAttempts = 0;
        console.log('WhatsApp connected');
      }

      if (connection === 'close') {
        isReady = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        if (!shouldReconnect) {
          console.log('Logged out, hapus folder auth_info untuk login ulang');
          return;
        }

        scheduleReconnect();
      }
    });

    return sock;
  } catch (err) {
    console.error('Gagal connect ke WhatsApp:', err.message);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  reconnectAttempts += 1;
  const delay = reconnectAttempts > 3 ? 10000 : 2000;
  console.log(`Reconnecting dalam ${delay / 1000}s (percobaan ke-${reconnectAttempts})`);
  setTimeout(() => initWhatsApp(), delay);
}

function toJid(number) {
  let cleaned = number.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.slice(1);
  }
  return `${cleaned}@s.whatsapp.net`;
}

async function sendMessage(number, message) {
  if (!sock || !isReady) {
    throw new Error('WhatsApp belum terhubung, scan QR dulu');
  }

  const jid = toJid(number);
  const [result] = await sock.onWhatsApp(jid);
  if (!result?.exists) {
    appendLog({ type: 'text', to: number, message, status: 'failed', error: `Nomor ${number} tidak terdaftar di WhatsApp` });
    throw new Error(`Nomor ${number} tidak terdaftar di WhatsApp`);
  }

  await sock.sendMessage(result.jid, { text: message });
  appendLog({ type: 'text', to: number, message, status: 'sent' });
}

async function sendDocument(number, filePath, fileName, mimetype, caption = '') {
  if (!sock || !isReady) {
    throw new Error('WhatsApp belum terhubung, scan QR dulu');
  }

  const jid = toJid(number);
  const [result] = await sock.onWhatsApp(jid);
  if (!result?.exists) {
    appendLog({ type: 'document', to: number, fileName, status: 'failed', error: `Nomor ${number} tidak terdaftar di WhatsApp` });
    throw new Error(`Nomor ${number} tidak terdaftar di WhatsApp`);
  }

  await sock.sendMessage(result.jid, {
    document: { url: filePath },
    fileName,
    mimetype,
    caption,
  });
  appendLog({ type: 'document', to: number, fileName, caption, status: 'sent' });
}

function getStatus() {
  return isReady;
}

function getLatestQr() {
  return latestQr;
}

async function logout() {
  if (sock) {
    try {
      await sock.logout();
    } catch (_) {}
    sock = null;
  }
  isReady = false;
  latestQr = null;

  // Hapus folder auth_info
  const authPath = path.join(__dirname, 'auth_info');
  if (fs.existsSync(authPath)) {
    fs.rmSync(authPath, { recursive: true, force: true });
  }

  console.log('WhatsApp logged out, auth_info deleted');
}

module.exports = { initWhatsApp, sendMessage, sendDocument, getStatus, getLatestQr, logout, getLogs };
