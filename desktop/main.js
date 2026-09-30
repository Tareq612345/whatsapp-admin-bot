const { app, BrowserWindow, ipcMain, shell } = require('electron');
require('wwebjs-electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { createLineDecoder } = require('../lib/desktop-events');
const { removeWhatsAppSession, whatsappSessionPaths } = require('../lib/session-data');

let mainWindow;
let whatsappWindow;
let botProcess;
let botStartPromise;
let botHostLock;
let botState = { status: 'stopped', pid: null, startedAt: null, lastExit: null };
let authState = {
  status: 'starting',
  qrDataUrl: null,
  message: 'Starting the WhatsApp connection…',
  updatedAt: new Date().toISOString()
};
let setupState = {
  ownerConfigured: false,
  claimCode: null,
  expiresAt: null,
  owner: null
};
const logs = [];
const isBotHost = process.argv.includes('--bot-host');
const isSmokeTest = process.argv.includes('--smoke-test');
const isSmokeChild = process.argv.includes('--smoke-child');

function projectRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, 'app.asar') : path.join(__dirname, '..');
}

function processWorkingDirectory() {
  // ASAR paths work with Electron's fs/require hooks, but Windows cannot use
  // an archive path as the native working directory for child_process.spawn.
  return app.isPackaged ? process.resourcesPath : projectRoot();
}

function dataPaths() {
  const dataRoot = app.getPath('userData');
  const session = whatsappSessionPaths(dataRoot);
  return {
    dataRoot,
    configRoot: path.join(dataRoot, 'config'),
    admins: path.join(dataRoot, 'config', 'admins.json'),
    commands: path.join(dataRoot, 'config', 'commands.json'),
    whatsappSession: session.auth,
    whatsappCache: session.cache
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

function setupFromDisk() {
  try {
    const data = JSON.parse(fs.readFileSync(dataPaths().admins, 'utf8'));
    const owner = (data.admins || []).find(admin =>
      admin.enabled !== false && admin.role === 'owner'
    );
    return {
      ...setupState,
      ownerConfigured: Boolean(owner),
      owner: owner ? { name: owner.name || 'Owner', number: owner.number || null } : null,
      claimCode: owner ? null : setupState.claimCode,
      expiresAt: owner ? null : setupState.expiresAt
    };
  } catch {
    return { ...setupState };
  }
}

function setSetupState(updates) {
  setupState = { ...setupState, ...updates };
  send('setup-state', setupState);
}

function pidIsRunning(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function acquireBotHostLock() {
  const lockPath = path.join(dataPaths().dataRoot, 'bot-host.lock');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(descriptor, String(process.pid));
      fs.closeSync(descriptor);
      botHostLock = lockPath;
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let existingPid = 0;
      try { existingPid = Number(fs.readFileSync(lockPath, 'utf8')); } catch {}
      if (pidIsRunning(existingPid)) return false;
      fs.rmSync(lockPath, { force: true });
    }
  }
  return false;
}

function releaseBotHostLock() {
  if (!botHostLock) return;
  try {
    const ownerPid = Number(fs.readFileSync(botHostLock, 'utf8'));
    if (ownerPid === process.pid) fs.rmSync(botHostLock, { force: true });
  } catch {}
  botHostLock = null;
}

function cleanupOrphanBotHosts() {
  if (process.platform !== 'win32') return Promise.resolve();
  const script = [
    "$self = $PID",
    `"$exe = '${app.getPath('exe').replace(/'/g, "''")}'"`,
    "Get-CimInstance Win32_Process |",
    "Where-Object { $_.ProcessId -ne $self -and $_.ExecutablePath -eq $exe -and $_.CommandLine -like '*--bot-host*' } |",
    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
  ].join('; ');
  return new Promise(resolve => {
    const cleanup = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      cwd: processWorkingDirectory(),
      windowsHide: true,
      stdio: 'ignore'
    });
    cleanup.once('exit', resolve);
    cleanup.once('error', resolve);
    setTimeout(resolve, 5000).unref?.();
  });
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

function setAuthState(status, updates = {}) {
  authState = {
    ...authState,
    ...updates,
    status,
    updatedAt: new Date().toISOString()
  };
}

async function processDesktopEvent(line) {
  const marker = '[desktop-event] ';
  const index = line.indexOf(marker);
  if (index < 0) return;
  try {
    const event = JSON.parse(line.slice(index + marker.length));
    if (event.type === 'qr') {
      event.dataUrl = await QRCode.toDataURL(event.value, { width: 320, margin: 2 });
      botState.status = 'waiting-login';
      setAuthState('qr', {
        qrDataUrl: event.dataUrl,
        message: 'Scan the QR code with the WhatsApp account that will run the bot.'
      });
    }
    if (event.type === 'authenticated') {
      botState.status = 'connecting';
      setAuthState('authenticated', {
        qrDataUrl: null,
        message: 'Login accepted. Loading your WhatsApp account…'
      });
    }
    if (event.type === 'loading') {
      botState.status = 'connecting';
      setAuthState('loading', {
        qrDataUrl: null,
        percent: event.percent,
        message: event.message || 'Loading WhatsApp…'
      });
    }
    if (event.type === 'ready') {
      botState.status = 'ready';
      setAuthState('ready', {
        qrDataUrl: null,
        percent: 100,
        account: event.account || null,
        message: 'WhatsApp is connected. Your saved session will be reused automatically.'
      });
    }
    if (event.type === 'auth-failure') {
      botState.status = 'error';
      setAuthState('auth-failure', {
        qrDataUrl: null,
        message: event.message || 'WhatsApp rejected the saved session. Try connecting again.'
      });
    }
    if (event.type === 'disconnected') {
      botState.status = 'reconnecting';
      setAuthState('disconnected', {
        qrDataUrl: null,
        message: `Connection lost${event.reason ? `: ${event.reason}` : ''}. Reconnecting…`
      });
    }
    if (event.type === 'owner-claim-required') {
      setSetupState({
        ownerConfigured: false,
        owner: null,
        claimCode: event.code,
        expiresAt: event.expiresAt
      });
    }
    if (event.type === 'owner-claimed') {
      setSetupState({
        ownerConfigured: true,
        owner: event.owner || null,
        claimCode: null,
        expiresAt: null
      });
    }
    send('bot-event', event);
    send('bot-status', botState);
  } catch (error) {
    addLog('desktop', `Could not read bot event: ${error.message}`);
  }
}

function startEmbeddedBotHost() {
  if (!acquireBotHostLock()) {
    console.error('[desktop-event] {"type":"duplicate-host","message":"Another bot host is already running."}');
    app.exit(12);
    return;
  }
  process.env.BOT_ELECTRON_HOST = '1';
  process.env.BOT_DESKTOP_EVENTS = '1';
  process.env.BOT_DATA_DIR = dataPaths().dataRoot;
  process.env.BOT_CONFIG_DIR = dataPaths().configRoot;
  process.env.BOT_OCR_WORKER = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'ocr', 'rapid_worker.py')
    : path.join(projectRoot(), 'ocr', 'rapid_worker.py');
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

async function startBot() {
  if (botProcess) return botState;
  if (botStartPromise) return botStartPromise;
  botStartPromise = (async () => {
    ensureUserFiles();
    botState = { status: 'starting', pid: null, startedAt: new Date().toISOString(), lastExit: null };
    setAuthState('starting', {
      qrDataUrl: null,
      percent: null,
      message: 'Checking for a saved WhatsApp session…'
    });
    send('bot-status', botState);
    await cleanupOrphanBotHosts();
    if (botProcess) return botState;
    const childArguments = app.isPackaged ? ['--bot-host'] : [projectRoot(), '--bot-host'];
    const child = spawn(app.getPath('exe'), childArguments, {
      cwd: processWorkingDirectory(),
      windowsHide: true,
      env: {
        ...process.env,
        BOT_DESKTOP_EVENTS: '1',
        BOT_DATA_DIR: dataPaths().dataRoot,
        BOT_CONFIG_DIR: dataPaths().configRoot
      }
    });
    botProcess = child;
    botState.pid = child.pid;
    send('bot-status', botState);
    const desktopEventDecoder = createLineDecoder(line => {
      processDesktopEvent(line);
      if (!line.includes('[desktop-event]')) addLog('bot', line);
    });
    child.stdout.on('data', chunk => {
      desktopEventDecoder.push(chunk);
    });
    child.stderr.on('data', chunk => addLog('error', chunk.toString()));
    child.on('error', error => {
      addLog('desktop', error.stack || error.message);
      if (botProcess === child) botProcess = null;
      botState.status = 'error';
      botState.pid = null;
      send('bot-status', botState);
    });
    child.on('exit', (code, signal) => {
      desktopEventDecoder.flush();
      if (botProcess !== child) return;
      botState = { ...botState, status: 'stopped', pid: null, lastExit: { code, signal, at: new Date().toISOString() } };
      if (authState.status !== 'ready') {
        setAuthState('stopped', {
          qrDataUrl: null,
          message: 'The WhatsApp engine stopped before it connected.'
        });
      }
      botProcess = null;
      send('bot-status', botState);
    });
    return botState;
  })();
  try {
    return await botStartPromise;
  } finally {
    botStartPromise = null;
  }
}

async function stopBot() {
  if (!botProcess) return botState;
  const processToStop = botProcess;
  botState.status = 'stopping';
  send('bot-status', botState);
  processToStop.kill('SIGTERM');
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      if (botProcess === processToStop) {
        if (process.platform === 'win32' && processToStop.pid) {
          const killer = spawn('taskkill', ['/pid', String(processToStop.pid), '/T', '/F'], {
            cwd: processWorkingDirectory(),
            windowsHide: true,
            stdio: 'ignore'
          });
          killer.once('exit', resolve);
          killer.once('error', resolve);
          return;
        }
        processToStop.kill('SIGKILL');
      }
      resolve();
    }, 8000);
    processToStop.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  if (botProcess === processToStop) {
    botProcess = null;
    botState = { ...botState, status: 'stopped', pid: null };
    send('bot-status', botState);
  }
  return botState;
}

async function restartBot() {
  await stopBot();
  return startBot();
}

async function renewOwnerClaim() {
  if (!botProcess?.stdin?.writable) {
    await restartBot();
    return setupState;
  }
  botProcess.stdin.write(`${JSON.stringify({ type: 'renew-owner-claim' })}\n`);
  return setupState;
}

async function resetWhatsAppSession() {
  await stopBot();
  const paths = dataPaths();
  removeWhatsAppSession(paths.dataRoot);
  setAuthState('starting', {
    qrDataUrl: null,
    account: null,
    percent: null,
    message: 'Saved WhatsApp login removed. Preparing a new QR code…'
  });
  return startBot();
}

function runSmokeChild() {
  console.log('[smoke-child] ready');
  setTimeout(() => app.exit(0), 150);
}

function runPackagedSmokeTest() {
  const runChild = () => new Promise((resolve, reject) => {
    const args = app.isPackaged ? ['--smoke-child'] : [projectRoot(), '--smoke-child'];
    const child = spawn(app.getPath('exe'), args, {
      cwd: processWorkingDirectory(),
      windowsHide: true,
      env: process.env
    });
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Smoke child timed out'));
    }, 15000);
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', code => {
      clearTimeout(timer);
      if (code === 0 && output.includes('[smoke-child] ready')) resolve();
      else reject(new Error(`Smoke child failed (${code}): ${output}`));
    });
  });
  return runChild()
    .then(runChild)
    .then(() => {
      console.log('[smoke-test] PASS: packaged child start/stop/restart');
      app.exit(0);
    })
    .catch(error => {
      console.error(`[smoke-test] FAIL: ${error.stack || error}`);
      app.exit(1);
    });
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

if (!isBotHost && !isSmokeTest && !isSmokeChild) {
  const primaryStudio = app.requestSingleInstanceLock();
  if (!primaryStudio) app.quit();
  else app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(() => {
  ensureUserFiles();
  if (isSmokeChild) {
    runSmokeChild();
    return;
  }
  if (isSmokeTest) {
    runPackagedSmokeTest();
    return;
  }
  if (isBotHost) {
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

process.once('exit', releaseBotHostLock);

ipcMain.handle('studio:get-state', () => ({
  bot: botState,
  auth: authState,
  setup: setupFromDisk(),
  logs,
  autoStart: app.getLoginItemSettings().openAtLogin,
  version: app.getVersion(),
  paths: dataPaths()
}));
ipcMain.handle('studio:read-config', (_, name) => readJson(name === 'admins' ? dataPaths().admins : dataPaths().commands));
ipcMain.handle('studio:save-config', (_, name, value) => {
  if (name === 'admins') {
    const current = readJson(dataPaths().admins);
    const addsUnclaimedOwner = !current.setup?.ownerClaimedAt &&
      (value.admins || []).some(admin => admin.enabled !== false && admin.role === 'owner');
    if (addsUnclaimedOwner) {
      throw new Error('Complete the one-time owner claim before adding an Owner account.');
    }
  }
  const result = writeJson(name === 'admins' ? dataPaths().admins : dataPaths().commands, value);
  if (name === 'admins') setSetupState(setupFromDisk());
  return result;
});
ipcMain.handle('studio:start-bot', () => startBot());
ipcMain.handle('studio:stop-bot', () => stopBot());
ipcMain.handle('studio:restart-bot', () => restartBot());
ipcMain.handle('studio:renew-owner-claim', () => renewOwnerClaim());
ipcMain.handle('studio:reset-whatsapp-session', () => resetWhatsAppSession());
ipcMain.handle('studio:set-auto-start', (_, enabled) => {
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: process.execPath });
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.handle('studio:open-dashboard', (_, port) => shell.openExternal(`http://127.0.0.1:${Number(port) === 3001 ? 3001 : 3000}`));
ipcMain.handle('studio:open-data-folder', () => shell.openPath(dataPaths().dataRoot));