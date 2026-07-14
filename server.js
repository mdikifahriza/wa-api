const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Server } = require('socket.io');
const { connectToWhatsApp, sendMessage, sendDocument, getStatus } = require('./whatsapp');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// File di-upload sementara ke folder ./uploads, dihapus lagi setelah terkirim
const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use(express.static('public'));

// Endpoint testing kirim pesan
app.post('/send', async (req, res) => {
  const { number, message } = req.body;

  if (!number || !message) {
    return res.status(400).json({ ok: false, error: 'number dan message wajib diisi' });
  }

  try {
    await sendMessage(number, message);
    res.json({ ok: true, message: 'Pesan terkirim' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/status', (req, res) => {
  res.json({ ready: getStatus() });
});

// Endpoint testing kirim dokumen (PDF, dll)
app.post('/send-document', upload.single('file'), async (req, res) => {
  const { number, caption } = req.body;
  const file = req.file;

  if (!number || !file) {
    return res.status(400).json({ ok: false, error: 'number dan file wajib diisi' });
  }

  try {
    await sendDocument(number, file.path, file.originalname, file.mimetype, caption || '');
    res.json({ ok: true, message: 'Dokumen terkirim' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    // hapus file temporary setelah selesai, berhasil ataupun gagal
    fs.unlink(file.path, () => {});
  }
});

io.on('connection', (socket) => {
  console.log('Frontend connected via socket.io');
  socket.emit('ready', getStatus());
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server jalan di http://localhost:${PORT}`);
  connectToWhatsApp(io); // mulai koneksi WhatsApp begitu server start
});
