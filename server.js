const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const {
  listBots, getBot, getBotStatus,
  registerBot, updateBot, deleteBot,
  deployBot, startBot, stopBot,
  getLogHistory, onLog, offLog,
} = require('./botManager');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Lister les bots
app.get('/api/bots', (req, res) => {
  res.json(listBots());
});

// Ajouter un bot
app.post('/api/bots', (req, res) => {
  const { name, repoUrl, branch = 'main', mainFile = 'index.js', runtime = 'node', env = {} } = req.body;
  if (!name || !repoUrl) return res.status(400).json({ error: 'name et repoUrl requis' });
  const id = uuidv4();
  const bot = { id, name, repoUrl, branch, mainFile, runtime, env };
  registerBot(bot);
  res.json(bot);
});

// Statut d'un bot
app.get('/api/bots/:id/status', (req, res) => {
  res.json(getBotStatus(req.params.id));
});

// Deploy
app.post('/api/bots/:id/deploy', async (req, res) => {
  try {
    deployBot(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Start
app.post('/api/bots/:id/start', async (req, res) => {
  try {
    await startBot(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Stop
app.post('/api/bots/:id/stop', async (req, res) => {
  await stopBot(req.params.id);
  res.json({ ok: true });
});

// Update (env vars, mainFile, etc)
app.patch('/api/bots/:id', (req, res) => {
  const bot = updateBot(req.params.id, req.body);
  res.json(bot);
});

// Supprimer
app.delete('/api/bots/:id', async (req, res) => {
  await stopBot(req.params.id);
  deleteBot(req.params.id);
  res.json({ ok: true });
});

// Logs historique
app.get('/api/bots/:id/logs', (req, res) => {
  res.json(getLogHistory(req.params.id));
});

// Logs SSE temps réel
app.get('/api/bots/:id/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const fn = (line) => res.write(`data: ${JSON.stringify(line)}\n\n`);
  onLog(req.params.id, fn);
  req.on('close', () => offLog(req.params.id, fn));
});

app.listen(3000, () => console.log('Panel actif sur port 3000'));
