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
  db.run(`INSERT INTO bots (name, token, file_path) VALUES (?, ?, ?)`,
    [name, token, file_path],
    function(err) {
      res.json({ id: this.lastID, name, status: 'stopped' });
    });
});

app.get('/api/bots', (req, res) => {
  db.all(`SELECT id, name, status, created_at FROM bots`, [], (err, bots) => {
    res.json(bots || []);
  });
});

app.post('/api/bots/:id/start', (req, res) => {
  db.get(`SELECT * FROM bots WHERE id = ?`, [req.params.id], (err, bot) => {
    if (!bot) return res.status(404).json({ error: 'Bot introuvable' });
    startBot(bot);
    res.json({ status: 'running' });
  });
});

app.post('/api/bots/:id/stop', (req, res) => {
  stopBot(req.params.id);
  res.json({ status: 'stopped' });
});

app.delete('/api/bots/:id', (req, res) => {
  stopBot(req.params.id);
  db.run(`DELETE FROM bots WHERE id = ?`, [req.params.id]);
  res.json({ success: true });
});

restoreOnStartup();
app.listen(3000, () => console.log('Panel actif sur port 3000'));
