const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const botManager = require('./botManager');
const { requireAuth } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

// --- CORS : autoriser le dashboard artifact ---
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.json());

// --- Healthcheck (public) ---
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// --- Auth sur tout le reste ---
app.use(requireAuth);

// --- GET /bots --- liste tous les bots
app.get('/bots', (req, res) => {
  res.json(botManager.listBots());
});

// --- POST /bots --- enregistre un nouveau bot
app.post('/bots', (req, res) => {
  const { name, repoUrl, branch = 'main', mainFile = 'index.js', runtime = 'node', env = {} } = req.body;
  if (!name || !repoUrl) return res.status(400).json({ error: 'name and repoUrl are required' });

  const bot = {
    id: uuidv4(),
    name,
    repoUrl,
    branch,
    mainFile,
    runtime,
    env,
    createdAt: new Date().toISOString(),
  };

  botManager.registerBot(bot);
  res.status(201).json(bot);
});

// --- PATCH /bots/:id --- mise à jour config/env
app.patch('/bots/:id', (req, res) => {
  const bot = botManager.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });

  const updated = botManager.updateBot(req.params.id, req.body);
  res.json(updated);
});

// --- DELETE /bots/:id --- supprime et stop le bot
app.delete('/bots/:id', async (req, res) => {
  const bot = botManager.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });

  await botManager.stopBot(req.params.id);
  botManager.deleteBot(req.params.id);
  res.json({ deleted: true });
});

// --- POST /bots/:id/deploy --- clone repo + install + start
app.post('/bots/:id/deploy', async (req, res) => {
  const bot = botManager.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });

  try {
    // Réponse immédiate, deploy en arrière-plan
    res.json({ status: 'deploying', botId: bot.id });
    await botManager.deployBot(bot.id);
  } catch (err) {
    // L'erreur est capturée dans les logs du bot
    console.error(`Deploy error for ${bot.id}:`, err.message);
  }
});

// --- POST /bots/:id/start ---
app.post('/bots/:id/start', async (req, res) => {
  const bot = botManager.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });

  try {
    await botManager.startBot(bot.id);
    res.json({ status: 'starting', botId: bot.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- POST /bots/:id/stop ---
app.post('/bots/:id/stop', async (req, res) => {
  const bot = botManager.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });

  await botManager.stopBot(bot.id);
  res.json({ status: 'stopped', botId: bot.id });
});

// --- POST /bots/:id/restart ---
app.post('/bots/:id/restart', async (req, res) => {
  const bot = botManager.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });

  await botManager.stopBot(bot.id);
  setTimeout(async () => {
    try { await botManager.startBot(bot.id); } catch (e) { /* logged */ }
  }, 1000);
  res.json({ status: 'restarting', botId: bot.id });
});

// --- GET /bots/:id/logs --- SSE stream temps réel
app.get('/bots/:id/logs', (req, res) => {
  const bot = botManager.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': req.headers.origin || '*',
  });

  // Envoie les dernières 100 lignes immédiatement
  const history = botManager.getLogHistory(req.params.id);
  history.forEach(line => res.write(`data: ${JSON.stringify(line)}\n\n`));

  // Souscrit aux nouveaux logs
  const onLog = (line) => res.write(`data: ${JSON.stringify(line)}\n\n`);
  botManager.onLog(req.params.id, onLog);

  // Keepalive toutes les 15s
  const keepalive = setInterval(() => res.write(': ping\n\n'), 15000);

  req.on('close', () => {
    clearInterval(keepalive);
    botManager.offLog(req.params.id, onLog);
  });
});

// --- GET /bots/:id/env --- retourne les env vars en clair (protégé par auth)
app.get('/bots/:id/env', (req, res) => {
  const bot = botManager.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  res.json({ env: bot.env || {} });
});

// --- GET /bots/:id/logs-poll --- polling fallback (EventSource ne supporte pas Bearer)
app.get('/bots/:id/logs-poll', (req, res) => {
  const bot = botManager.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  const since = req.query.since || null;
  const history = botManager.getLogHistory(req.params.id);
  const lines = since ? history.filter(l => l.ts > since) : history;
  res.json({ lines });
});

// --- GET /bots/:id/status ---
app.get('/bots/:id/status', (req, res) => {
  const bot = botManager.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  res.json(botManager.getBotStatus(req.params.id));
});

app.listen(PORT, () => console.log(`BotHost API running on port ${PORT}`));
