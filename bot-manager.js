const { spawn } = require('child_process');
const db = require('./database');

const processes = {};

function startBot(bot) {
  if (processes[bot.id]) return;

  const proc = spawn('node', [bot.file_path], {
    env: { ...process.env, DISCORD_TOKEN: bot.token }
  });

  processes[bot.id] = proc;
  db.prepare(`UPDATE bots SET status = 'running' WHERE id = ?`).run(bot.id);

  proc.on('exit', () => {
    delete processes[bot.id];
    db.prepare(`UPDATE bots SET status = 'stopped' WHERE id = ?`).run(bot.id);
  });
}

function stopBot(botId) {
  if (processes[botId]) {
    processes[botId].kill();
    delete processes[botId];
  }
  db.prepare(`UPDATE bots SET status = 'stopped' WHERE id = ?`).run(botId);
}

function restoreOnStartup() {
  const bots = db.prepare(`SELECT * FROM bots WHERE status = 'running'`).all();
  bots.forEach(startBot);
}

module.exports = { startBot, stopBot, restoreOnStartup };
