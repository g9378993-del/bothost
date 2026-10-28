const { spawn } = require('child_process');
const db = require('./database');

const processes = {};

function startBot(bot) {
  if (processes[bot.id]) return;
  const proc = spawn('node', [bot.file_path], {
    env: { ...process.env, DISCORD_TOKEN: bot.token }
  });
  processes[bot.id] = proc;
  db.run(`UPDATE bots SET status = 'running' WHERE id = ?`, [bot.id]);
  proc.on('exit', () => {
    delete processes[bot.id];
    db.run(`UPDATE bots SET status = 'stopped' WHERE id = ?`, [bot.id]);
  });
}

function stopBot(botId) {
  if (processes[botId]) {
    processes[botId].kill();
    delete processes[botId];
  }
  db.run(`UPDATE bots SET status = 'stopped' WHERE id = ?`, [botId]);
}

function restoreOnStartup() {
  db.all(`SELECT * FROM bots WHERE status = 'running'`, [], (err, bots) => {
    if (bots) bots.forEach(startBot);
  });
}

module.exports = { startBot, stopBot, restoreOnStartup };
