const express = require('express');
const multer = require('multer');
const cors = require('cors');
const db = require('./database');
const { startBot, stopBot, restoreOnStartup } = require('./bot-manager');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.post('/api/bots', upload.single('file'), (req, res) => {
  const { name, token } = req.body;
  const file_path = req.file.path;
  const result = db.prepare(
    `INSERT INTO bots (name, token, file_path) VALUES (?, ?, ?)`
  ).run(name, token, file_path);
  res.json({ id: result.lastInsertRowid, name, status: 'stopped' });
});

app.get('/api/bots', (req, res) => {
  const bots = db.prepare(`SELECT id, name, status, created_at FROM bots`).all();
  res.json(bots);
});

app.post('/api/bots/:id/start', (req, res) => {
  const bot = db.prepare(`SELECT * FROM bots WHERE id = ?`).get(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot introuvable' });
  startBot(bot);
  res.json({ status: 'running' });
});

app.post('/api/bots/:id/stop', (req, res) => {
  stopBot(req.params.id);
  res.json({ status: 'stopped' });
});

app.delete('/api/bots/:id', (req, res) => {
  stopBot(req.params.id);
  db.prepare(`DELETE FROM bots WHERE id = ?`).run(req.params.id);
  res.json({ success: true });
});

restoreOnStartup();
app.listen(3000, () => console.log('Panel actif sur port 3000'));
