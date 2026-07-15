const express = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const { initWhatsApp, sendMessage, sendDocument, getStatus, getLatestQr, logout, getLogs } = require('./whatsapp');

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json());

// Auth middleware — semua request wajib header x-api-key
app.use((req, res, next) => {
  const apiKey = process.env.WA_API_KEY;
  if (apiKey && req.headers['x-api-key'] !== apiKey) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
});

// GET /status — status koneksi WA
app.get('/status', (req, res) => {
  res.json({ ok: true, ready: getStatus() });
});

// GET /qr-base64 — QR code (null jika sudah connect)
app.get('/qr-base64', (req, res) => {
  res.json({ ok: true, qr: getLatestQr() });
});

// POST /send — kirim pesan teks
app.post('/send', async (req, res) => {
  const { number, message } = req.body;
  if (!number || !message) {
    return res.status(400).json({ ok: false, error: 'number dan message wajib diisi' });
  }
  try {
    await sendMessage(number, message);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /send-document — kirim dokumen (PDF, gambar, dll)
app.post('/send-document', upload.single('file'), async (req, res) => {
  const { number, caption } = req.body;
  const file = req.file;
  if (!number || !file) {
    return res.status(400).json({ ok: false, error: 'number dan file wajib diisi' });
  }
  try {
    await sendDocument(number, file.path, file.originalname, file.mimetype, caption || '');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    fs.unlink(file.path, () => {});
  }
});

// POST /logout — putus koneksi & hapus session
app.post('/logout', async (req, res) => {
  try {
    await logout();
    res.json({ ok: true, message: 'WhatsApp logout berhasil. Scan QR ulang untuk connect.' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /connect — memulai koneksi WA secara manual
app.post('/connect', async (req, res) => {
  try {
    const status = getStatus();
    if (status) {
      return res.json({ ok: true, message: 'WhatsApp sudah terhubung.' });
    }
    initWhatsApp();
    res.json({ ok: true, message: 'Proses koneksi WhatsApp berhasil dipicu.' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /logs — riwayat pengiriman (max 100)
app.get('/logs', (req, res) => {
  res.json({ ok: true, logs: getLogs() });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`WA Gateway berjalan di port ${PORT}`);
  initWhatsApp();
});
