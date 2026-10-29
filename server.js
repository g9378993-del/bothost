const express = require('express');
const session = require('express-session');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const passport = require('./auth');
const db = require('./database');
const { startBot, stopBot, deployBot, getLogHistory, onLog, offLog } = require('./botManager');

const app = express();

app.use(cors());
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'moon-secret-key-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static('public'));

// Auth middleware
const requireAuth = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Non connecté' });
};

// Auth routes
app.get('/auth/github', passport.authenticate('github', { scope: ['user:email'] }));
app.get('/auth/github/callback',
  passport.authenticate('github', { failureRedirect: '/?error=auth' }),
  (req, res) => res.redirect('/')
);
app.get('/auth/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});
app.get('/auth/me', (req, res) => {
  if (!req.user) return res.json(null);
  res.json({ id: req.user.id, username: req.user.username, avatar: req.user.avatar });
});

// Bots API
app.get('/api/bots', requireAuth, (req, res) => {
  db.all('SELECT * FROM bots WHERE user_id = ?', [req.user.id], (err, bots) => {
    res.json((bots || []).map(b => ({ ...b, env: JSON.parse(b.env || '{}') })));
  });
});

app.post('/api/bots', requireAuth, (req, res) => {
  const { name, repoUrl, branch = 'main', mainFile = 'index.js', runtime = 'node', env = {} } = req.body;
  if (!name || !repoUrl) return res.status(400).json({ error: 'name et repoUrl requis' });
  const id = uuidv4();
  db.run('INSERT INTO bots (id, user_id, name, repo_url, branch, main_file, runtime, env) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, req.user.id, name, repoUrl, branch, mainFile, runtime, JSON.stringify(env)],
    () => res.json({ id, name, repoUrl, branch, mainFile, runtime, env, status: 'stopped' })
  );
});

app.get('/api/bots/:id/status', requireAuth, (req, res) => {
  db.get('SELECT status FROM bots WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], (err, bot) => {
    if (!bot) return res.status(404).json({ error: 'Bot introuvable' });
    res.json({ status: bot.status });
  });
});

app.post('/api/bots/:id/deploy', requireAuth, (req, res) => {
  db.get('SELECT * FROM bots WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], (err, bot) => {
    if (!bot) return res.status(404).json({ error: 'Bot introuvable' });
    const b = { ...bot, env: JSON.parse(bot.env || '{}'), repoUrl: bot.repo_url, mainFile: bot.main_file };
    deployBot(b);
    db.run('UPDATE bots SET status = ? WHERE id = ?', ['deploying', bot.id]);
    res.json({ ok: true });
  });
});

app.post('/api/bots/:id/start', requireAuth, (req, res) => {
  db.get('SELECT * FROM bots WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], (err, bot) => {
    if (!bot) return res.status(404).json({ error: 'Bot introuvable' });
    const b = { ...bot, env: JSON.parse(bot.env || '{}'), repoUrl: bot.repo_url, mainFile: bot.main_file };
    startBot(b);
    db.run('UPDATE bots SET status = ? WHERE id = ?', ['running', bot.id]);
    res.json({ ok: true });
  });
});

app.post('/api/bots/:id/stop', requireAuth, (req, res) => {
  db.get('SELECT * FROM bots WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], (err, bot) => {
    if (!bot) return res.status(404).json({ error: 'Bot introuvable' });
    stopBot(bot.id);
    db.run('UPDATE bots SET status = ? WHERE id = ?', ['stopped', bot.id]);
    res.json({ ok: true });
  });
});

app.delete('/api/bots/:id', requireAuth, (req, res) => {
  db.get('SELECT * FROM bots WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], (err, bot) => {
    if (!bot) return res.status(404).json({ error: 'Bot introuvable' });
    stopBot(bot.id);
    db.run('DELETE FROM bots WHERE id = ?', [bot.id]);
    res.json({ ok: true });
  });
});

app.get('/api/bots/:id/logs', requireAuth, (req, res) => {
  db.get('SELECT id FROM bots WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], (err, bot) => {
    if (!bot) return res.status(404).json({ error: 'Bot introuvable' });
    res.json(getLogHistory(req.params.id));
  });
});

app.get('/api/bots/:id/logs/stream', requireAuth, (req, res) => {
  db.get('SELECT id FROM bots WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], (err, bot) => {
    if (!bot) return res.status(404).end();
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();
    const fn = (line) => res.write(`data: ${JSON.stringify(line)}\n\n`);
    onLog(req.params.id, fn);
    req.on('close', () => offLog(req.params.id, fn));
  });
});

app.listen(3000, () => console.log('Moon Hosting actif sur port 3000'));
