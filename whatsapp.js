const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');

let sock = null;
let isReady = false;
let reconnectAttempts = 0;

// io = instance socket.io, dikirim dari server.js supaya file ini bisa emit event ke frontend
async function connectToWhatsApp(io) {
  try {
    // Session disimpan di folder ./auth_info, auto-generated oleh Baileys
    // Kalau folder ini dihapus, harus scan QR ulang
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    // Penting: versi WA Web berubah cukup sering. Kalau versi yang dipakai Baileys
    // sudah usang dibanding server WhatsApp saat ini, koneksi gagal dengan error
    // "Connection Failure" tepat setelah "attempting registration...".
    // fetchLatestBaileysVersion() mengambil versi terbaru secara dinamis untuk menghindari ini.
    const { version } = await fetchLatestBaileysVersion();
    console.log('Menggunakan WA Web version:', version.join('.'));

    sock = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false, // kita handle QR sendiri lewat browser, bukan terminal
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        // convert QR string ke data URL image, kirim ke frontend via socket.io
        const qrImage = await QRCode.toDataURL(qr);
        io.emit('qr', qrImage);
        io.emit('status', 'Scan QR code di bawah ini');
      }

      if (connection === 'open') {
        isReady = true;
        reconnectAttempts = 0; // reset counter begitu berhasil connect
        io.emit('ready', true);
        io.emit('status', 'WhatsApp terhubung!');
        console.log('WhatsApp connected');
      }

      if (connection === 'close') {
        isReady = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        io.emit('status', `Terputus: ${lastDisconnect?.error?.message || 'unknown'}`);
        io.emit('ready', false);

        if (!shouldReconnect) {
          console.log('Logged out, hapus folder auth_info untuk login ulang');
          return;
        }

        scheduleReconnect(io);
      }
    });

    return sock;
  } catch (err) {
    // Penting: kalau bagian manapun di atas throw (fetch version gagal, auth state
    // corrupt, dll) dan tidak ditangkap, ini jadi unhandled promise rejection yang
    // akan mematikan SELURUH proses Node.js (termasuk Express server ikut mati).
    // Makanya seluruh isi function ini dibungkus try-catch.
    console.error('Gagal connect ke WhatsApp:', err.message);
    io.emit('status', `Gagal connect: ${err.message}`);
    scheduleReconnect(io);
  }
}

function scheduleReconnect(io) {
  reconnectAttempts += 1;

  // Kalau gagal berkali-kali berturut-turut (misal loop "Connection Failure"
  // saat registrasi), kemungkinan besar penyebabnya BUKAN masalah sementara,
  // melainkan state auth_info yang korup dari percobaan sebelumnya, atau isu
  // jaringan di server. Setelah 3x gagal beruntun, beri jeda lebih panjang
  // supaya gak spam WhatsApp server dan gampang dilihat di log.
  const delay = reconnectAttempts > 3 ? 10000 : 2000;
  console.log(`Reconnecting dalam ${delay / 1000}s (percobaan ke-${reconnectAttempts})`);
  setTimeout(() => connectToWhatsApp(io), delay);
}

// Format nomor Indonesia ke JID yang dipakai Baileys.
// Contoh: "085731591508" -> "6285731591508@s.whatsapp.net"
//         "+6285731591508" -> "6285731591508@s.whatsapp.net"
//         "6285731591508" -> "6285731591508@s.whatsapp.net" (sudah benar, dibiarkan)
function toJid(number) {
  let cleaned = number.replace(/\D/g, ''); // buang semua karakter selain digit

  if (cleaned.startsWith('0')) {
    // nomor lokal Indonesia diawali 0 -> ganti jadi kode negara 62
    cleaned = '62' + cleaned.slice(1);
  }

  return `${cleaned}@s.whatsapp.net`;
}

async function sendMessage(number, message) {
  if (!sock || !isReady) {
    throw new Error('WhatsApp belum terhubung, scan QR dulu');
  }

  const jid = toJid(number);

  // Cek dulu apakah nomor ini beneran terdaftar di WhatsApp sebelum kirim.
  // Tanpa ini, kirim ke nomor salah/gak terdaftar bisa menggantung dan
  // akhirnya muncul error generik "Timed Out" yang membingungkan.
  const [result] = await sock.onWhatsApp(jid);
  if (!result?.exists) {
    throw new Error(`Nomor ${number} tidak terdaftar di WhatsApp`);
  }

  await sock.sendMessage(result.jid, { text: message });
}

async function sendDocument(number, filePath, fileName, mimetype, caption = '') {
  if (!sock || !isReady) {
    throw new Error('WhatsApp belum terhubung, scan QR dulu');
  }

  const jid = toJid(number);

  const [result] = await sock.onWhatsApp(jid);
  if (!result?.exists) {
    throw new Error(`Nomor ${number} tidak terdaftar di WhatsApp`);
  }

  await sock.sendMessage(result.jid, {
    document: { url: filePath }, // Baileys baca file dari path lokal via stream, hemat memori
    fileName,
    mimetype,
    caption,
  });
}

function getStatus() {
  return isReady;
}

module.exports = { connectToWhatsApp, sendMessage, sendDocument, getStatus };
