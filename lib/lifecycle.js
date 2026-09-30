const cleanups = new Map();
const healthProviders = new Map();
let shuttingDown = false;

function registerCleanup(name, cleanup) {
  cleanups.set(name, cleanup);
}

function registerHealth(name, provider) {
  healthProviders.set(name, provider);
}

function healthSnapshot() {
  const services = {};
  for (const [name, provider] of healthProviders) {
    try {
      services[name] = provider();
    } catch (error) {
      services[name] = { ok: false, error: error.message };
    }
  }
  return services;
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const [name, cleanup] of [...cleanups].reverse()) {
    try {
      await cleanup();
    } catch (error) {
      console.error(`[shutdown] ${name}:`, error.stack || error);
    }
  }
}

module.exports = { registerCleanup, registerHealth, healthSnapshot, shutdown };