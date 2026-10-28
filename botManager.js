const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

// --- Persistance sur disque ---
// /tmp survit aux restarts Render (free tier, pas de disk)
const DATA_DIR = process.env.DATA_DIR || '/tmp/bothost';
const BOTS_FILE = path.join(DATA_DIR, 'bots.json');
const BOTS_DIR = path.join(DATA_DIR, 'bots');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BOTS_DIR, { recursive: true });

// --- State en mémoire ---
let bots = {};         // { [id]: botConfig }
let processes = {};    // { [id]: ChildProcess }
let statuses = {};     // { [id]: 'stopped'|'starting'|'running'|'error'|'deploying' }
let logHistory = {};   // { [id]: [{ts, text}] }
const logEmitter = new EventEmitter();
logEmitter.setMaxListeners(200);

// --- Charge les bots depuis le disque au démarrage ---
function loadBots() {
  try {
    if (fs.existsSync(BOTS_FILE)) {
      bots = JSON.parse(fs.readFileSync(BOTS_FILE, 'utf8'));
      Object.keys(bots).forEach(id => {
        statuses[id] = 'stopped';
        logHistory[id] = [];
      });
      console.log(`Loaded ${Object.keys(bots).length} bot(s) from disk`);
    }
  } catch (e) {
    console.error('Failed to load bots from disk:', e.message);
    bots = {};
  }
}

function saveBots() {
  fs.writeFileSync(BOTS_FILE, JSON.stringify(bots, null, 2));
}

// --- API publique ---

function listBots() {
  return Object.values(bots).map(bot => ({
    ...bot,
    status: statuses[bot.id] || 'stopped',
    env: Object.keys(bot.env || {}).reduce((acc, k) => {
      acc[k] = '***'; // masque les valeurs en liste
      return acc;
    }, {}),
  }));
}

function getBot(id) {
  return bots[id] || null;
}

function getBotStatus(id) {
  return {
    id,
    status: statuses[id] || 'stopped',
    pid: processes[id]?.pid || null,
  };
}

function registerBot(bot) {
  bots[bot.id] = bot;
  statuses[bot.id] = 'stopped';
  logHistory[bot.id] = [];
  saveBots();
}

function updateBot(id, patch) {
  const allowed = ['name', 'branch', 'mainFile', 'runtime', 'env'];
  allowed.forEach(k => { if (patch[k] !== undefined) bots[id][k] = patch[k]; });
  saveBots();
  return bots[id];
}

function deleteBot(id) {
  delete bots[id];
  delete statuses[id];
  delete logHistory[id];
  delete processes[id];
  saveBots();
}

// --- Logs ---

function appendLog(id, text, level = 'info') {
  const line = { ts: new Date().toISOString(), text, level };
  if (!logHistory[id]) logHistory[id] = [];
  logHistory[id].push(line);
  if (logHistory[id].length > 500) logHistory[id].shift(); // garde 500 lignes max
  logEmitter.emit(`log:${id}`, line);
}

function getLogHistory(id) {
  return (logHistory[id] || []).slice(-100);
}

function onLog(id, fn) {
  logEmitter.on(`log:${id}`, fn);
}

function offLog(id, fn) {
  logEmitter.off(`log:${id}`, fn);
}

// --- Deploy : clone + install ---

async function deployBot(id) {
  const bot = bots[id];
  if (!bot) throw new Error('Bot not found');

  const botDir = path.join(BOTS_DIR, id);
  statuses[id] = 'deploying';
  appendLog(id, `🚀 Starting deploy for ${bot.name}...`, 'info');

  // Stop si tourne déjà
  if (processes[id]) {
    appendLog(id, '⏹ Stopping current process...', 'info');
    await stopBot(id);
  }

  // Toujours supprimer et re-cloner pour garantir un code frais
  if (fs.existsSync(botDir)) {
    appendLog(id, `🗑 Removing old directory...`, 'info');
    try {
      fs.rmSync(botDir, { recursive: true, force: true });
      appendLog(id, '✅ Old directory removed', 'info');
    } catch (e) {
      appendLog(id, `Warning: could not remove old dir: ${e.message}`, 'error');
    }
  }

  appendLog(id, `📦 Cloning ${bot.repoUrl} (branch: ${bot.branch})...`, 'info');
  try {
    execSync(`git clone --branch ${bot.branch} --depth 1 "${bot.repoUrl}" "${botDir}"`, { timeout: 120000 });
    appendLog(id, '✅ Clone successful', 'info');

    // Affiche les fichiers clonés
    const files = execSync(`git -C "${botDir}" show --stat HEAD`, { timeout: 10000 }).toString().trim();
    const lastLine = files.split('\n').pop();
    appendLog(id, `📋 ${lastLine}`, 'info');
  } catch (e) {
    appendLog(id, `Git clone failed: ${e.message}`, 'error');
    statuses[id] = 'error';
    return;
  }

  // Install deps
  const hasPkg = fs.existsSync(path.join(botDir, 'package.json'));
  const hasReq = fs.existsSync(path.join(botDir, 'requirements.txt'));

  if (hasPkg && bot.runtime === 'node') {
    appendLog(id, '📦 Installing npm dependencies...', 'info');
    try {
      const out = execSync(`npm install --production`, { cwd: botDir, timeout: 120000 });
      appendLog(id, 'npm install done', 'info');
    } catch (e) {
      appendLog(id, `npm install failed: ${e.message}`, 'error');
      statuses[id] = 'error';
      return;
    }
  }

  if (hasReq && bot.runtime === 'python') {
    appendLog(id, '🐍 Installing pip dependencies...', 'info');
    try {
      const out = execSync(`pip install -r requirements.txt`, { cwd: botDir, timeout: 180000 });
      appendLog(id, 'pip install done', 'info');
    } catch (e) {
      appendLog(id, `pip install failed: ${e.message}`, 'error');
      statuses[id] = 'error';
      return;
    }
  }

  appendLog(id, '✅ Deploy complete. Starting bot...', 'info');
  await startBot(id);
}

// --- Start ---

async function startBot(id) {
  const bot = bots[id];
  if (!bot) throw new Error('Bot not found');

  const botDir = path.join(BOTS_DIR, id);
  if (!fs.existsSync(botDir)) throw new Error('Bot not deployed yet — run deploy first');

  const mainFile = path.join(botDir, bot.mainFile);
  if (!fs.existsSync(mainFile)) throw new Error(`Main file not found: ${bot.mainFile}`);

  statuses[id] = 'starting';
  appendLog(id, `▶ Starting ${bot.name}...`, 'info');

  const cmd = bot.runtime === 'python' ? 'python3' : 'node';
  const env = { ...process.env, ...bot.env };

  const proc = spawn(cmd, [mainFile], {
    cwd: botDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  processes[id] = proc;

  proc.stdout.on('data', (data) => {
    data.toString().split('\n').filter(Boolean).forEach(line => appendLog(id, line, 'info'));
  });

  proc.stderr.on('data', (data) => {
    data.toString().split('\n').filter(Boolean).forEach(line => appendLog(id, line, 'error'));
  });

  proc.on('spawn', () => {
    statuses[id] = 'running';
    appendLog(id, `✅ Bot running (PID ${proc.pid})`, 'info');
  });

  proc.on('error', (err) => {
    statuses[id] = 'error';
    appendLog(id, `❌ Process error: ${err.message}`, 'error');
    delete processes[id];
  });

  proc.on('exit', (code, signal) => {
    if (statuses[id] !== 'stopped') {
      statuses[id] = code === 0 ? 'stopped' : 'error';
      appendLog(id, `⚠ Process exited (code: ${code ?? signal})`, code === 0 ? 'info' : 'error');

      // Auto-restart si crash (max 3 tentatives)
      if (code !== 0 && !signal) {
        const attempts = (bot._restartAttempts || 0) + 1;
        bots[id]._restartAttempts = attempts;
        if (attempts <= 3) {
          const delay = attempts * 5000;
          appendLog(id, `🔄 Auto-restart in ${delay / 1000}s (attempt ${attempts}/3)...`, 'info');
          setTimeout(() => startBot(id).catch(() => {}), delay);
        } else {
          appendLog(id, '🛑 Max restart attempts reached. Manual restart required.', 'error');
          bots[id]._restartAttempts = 0;
        }
      }
    }
    delete processes[id];
  });
}

// --- Stop ---

async function stopBot(id) {
  const proc = processes[id];
  if (!proc) {
    statuses[id] = 'stopped';
    return;
  }

  return new Promise((resolve) => {
    statuses[id] = 'stopped';
    appendLog(id, '⏹ Stopping bot...', 'info');

    proc.removeAllListeners('exit');
    proc.once('exit', () => {
      delete processes[id];
      appendLog(id, 'Bot stopped', 'info');
      resolve();
    });

    proc.kill('SIGTERM');
    // Force kill après 5s
    setTimeout(() => {
      if (processes[id]) {
        proc.kill('SIGKILL');
        delete processes[id];
        resolve();
      }
    }, 5000);
  });
}

loadBots();

module.exports = {
  listBots, getBot, getBotStatus,
  registerBot, updateBot, deleteBot,
  deployBot, startBot, stopBot,
  getLogHistory, onLog, offLog,
};
