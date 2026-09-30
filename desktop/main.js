const { app, BrowserWindow, ipcMain, shell } = require('electron');
require('wwebjs-electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

let mainWindow;
let whatsappWindow;
let botProcess;
let botState = { status: 'stopped', pid: null, startedAt: null, lastExit: null };
const logs = [];

function projectRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, 'app') : path.join(__dirname, '..');
}

function dataPaths() {
  const dataRoot = app.getPath('userData');
  return {
    dataRoot,
    configRoot: path.join(dataRoot, 'config'),
    admins: path.join(dataRoot, 'config', 'admins.json'),
    commands: path.join(dataRoot, 'config', 'commands.json')
  };
}

function ensureUserFiles() {
  const paths = dataPaths();
  fs.mkdirSync(paths.configRoot, { recursive: true });
  for (const name of ['admins.json', 'commands.json']) {
    const target = path.join(paths.configRoot, name);
    if (!fs.existsSync(target)) fs.copyFileSync(path.join(projectRoot(), 'config', name), target);
  }
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function addLog(source, text) {
  const entry = { at: new Date().toISOString(), source, text: String(text).trimEnd() };
  if (!entry.text) return;
  logs.push(entry);
  if (logs.length > 1000) logs.splice(0, logs.length - 1000);
  send('bot-log', entry);
}

async function processDesktopEvent(line) {
  const marker = '[desktop-event] ';
  const index = line.indexOf(marker);
  if (index < 0) return;
  try {
    const event = JSON.parse(line.slice(index + marker.length));
    if (event.type === 'qr') event.dataUrl = await QRCode.toDataURL(event.value, { width: 300, margin: 2 });
    if (event.type === 'ready') botState.status = 'ready';
    if (event.type === 'disconnected') botState.status = 'reconnecting';
    send('bot-event', event);
    send('bot-status', botState);
  } catch (error) {
    addLog('desktop', `Could not read bot event: ${error.message}`);
  }
}

function startEmbeddedBotHost() {
  process.env.BOT_ELECTRON_HOST = '1';
  process.env.BOT_DESKTOP_EVENTS = '1';
  process.env.BOT_DATA_DIR = dataPaths().dataRoot;
  process.env.BOT_CONFIG_DIR = dataPaths().configRoot;
  whatsappWindow = new BrowserWindow({
    show: false,
    width: 1100,
    height: 760,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  global.__BOT_ELECTRON_TARGET = whatsappWindow;
  const root = projectRoot();
  require(path.join(root, 'port-guard.js'));
  require(path.join(root, 'phone-resolver.js'));
  require(path.join(root, 'rapid-ocr.js'));
  require(path.join(root, 'student-gate.js'));
  require(path.join(root, 'bot.js'));
}

function startBot() {
  if (botProcess) return botState;
  ensureUserFiles();
  botState = { status: 'starting', pid: null, startedAt: new Date().toISOString(), lastExit: null };
  const childArguments = app.isPackaged ? ['--bot-host'] : [projectRoot(), '--bot-host'];
  botProcess = spawn(process.execPath, childArguments, {
    cwd: projectRoot(),
    windowsHide: true,
    env: {
      ...process.env,
      BOT_DESKTOP_EVENTS: '1',
      BOT_DATA_DIR: dataPaths().dataRoot,
      BOT_CONFIG_DIR: dataPaths().configRoot
    }
  });
  botState.pid = botProcess.pid;
  send('bot-status', botState);
  botProcess.stdout.on('data', chunk => {
    const text = chunk.toString();
    addLog('bot', text);
    for (const line of text.split(/\r?\n/)) processDesktopEvent(line);
  });
  botProcess.stderr.on('data', chunk => addLog('error', chunk.toString()));
  botProcess.on('error', error => {
    addLog('desktop', error.stack || error.message);
    botState.status = 'error';
    send('bot-status', botState);
  });
  botProcess.on('exit', (code, signal) => {
    botState = { ...botState, status: 'stopped', pid: null, lastExit: { code, signal, at: new Date().toISOString() } };
    botProcess = null;
    send('bot-status', botState);
  });
  return botState;
}

async function stopBot() {
  if (!botProcess) return botState;
  const processToStop = botProcess;
  botState.status = 'stopping';
  send('bot-status', botState);
  processToStop.kill('SIGTERM');
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      if (botProcess === processToStop) processToStop.kill('SIGKILL');
      resolve();
    }, 8000);
    processToStop.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  return botState;
}

async function restartBot() {
  await stopBot();
  return startBot();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
  return value;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#f7f7f5',
    title: 'WhatsApp Admin Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  ensureUserFiles();
  if (process.argv.includes('--bot-host')) {
    startEmbeddedBotHost();
    return;
  }
  createWindow();
  startBot();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', event => {
  if (!botProcess) return;
  event.preventDefault();
  stopBot().finally(() => {
    botProcess = null;
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('studio:get-state', () => ({
  bot: botState,
  logs,
  autoStart: app.getLoginItemSettings().openAtLogin,
  version: app.getVersion(),
  paths: dataPaths()
}));
ipcMain.handle('studio:read-config', (_, name) => readJson(name === 'admins' ? dataPaths().admins : dataPaths().commands));
ipcMain.handle('studio:save-config', (_, name, value) => writeJson(name === 'admins' ? dataPaths().admins : dataPaths().commands, value));
ipcMain.handle('studio:start-bot', () => startBot());
ipcMain.handle('studio:stop-bot', () => stopBot());
ipcMain.handle('studio:restart-bot', () => restartBot());
ipcMain.handle('studio:set-auto-start', (_, enabled) => {
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: process.execPath });
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.handle('studio:open-dashboard', (_, port) => shell.openExternal(`http://127.0.0.1:${Number(port) === 3001 ? 3001 : 3000}`));
ipcMain.handle('studio:open-data-folder', () => shell.openPath(dataPaths().dataRoot));