const lifecycle = require('./lifecycle');

class RuntimeManager {
  constructor(client, { ownerChatId, alert } = {}) {
    this.client = client;
    this.ownerChatId = ownerChatId;
    this.alert = alert;
    this.startedAt = new Date().toISOString();
    this.ready = false;
    this.recovering = false;
    this.reconnectAttempts = 0;
    this.lastDisconnect = null;
    this.lastError = null;
    this.reconnectTimer = null;
    this.bind();
  }

  bind() {
    this.client.on('ready', async () => {
      const recovered = this.recovering;
      this.ready = true;
      this.recovering = false;
      this.reconnectAttempts = 0;
      if (recovered) await this.notify('✅ WhatsApp bot reconnected successfully.');
    });

    this.client.on('auth_failure', message => {
      this.ready = false;
      this.lastError = `Authentication failure: ${message}`;
    });

    this.client.on('disconnected', reason => {
      this.ready = false;
      this.recovering = true;
      this.lastDisconnect = { at: new Date().toISOString(), reason: String(reason) };
      this.scheduleReconnect();
    });

    lifecycle.registerCleanup('whatsapp-client', async () => {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      await this.client.destroy().catch(() => {});
    });
    lifecycle.registerHealth('runtime', () => this.health());

    const stop = signal => this.shutdown(signal);
    process.once('SIGINT', () => stop('SIGINT'));
    process.once('SIGTERM', () => stop('SIGTERM'));
  }

  async notify(text) {
    try {
      const id = this.ownerChatId?.();
      if (id && this.client.info?.wid) await (this.alert ? this.alert(id, text) : this.client.sendMessage(id, text));
    } catch (error) {
      console.error('[runtime] Owner alert failed:', error.message);
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    const delay = Math.min(60_000, 5_000 * (2 ** Math.min(this.reconnectAttempts - 1, 4)));
    console.log(`[runtime] Reconnect attempt ${this.reconnectAttempts} in ${delay / 1000}s`);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.client.destroy().catch(() => {});
        await this.client.initialize();
      } catch (error) {
        this.lastError = error.message;
        console.error('[runtime] Reconnect failed:', error.stack || error);
        this.scheduleReconnect();
      }
    }, delay);
    this.reconnectTimer.unref?.();
  }

  recordError(error) {
    this.lastError = error instanceof Error ? error.message : String(error);
  }

  health() {
    return {
      ok: this.ready,
      ready: this.ready,
      recovering: this.recovering,
      startedAt: this.startedAt,
      uptimeSeconds: Math.floor(process.uptime()),
      reconnectAttempts: this.reconnectAttempts,
      lastDisconnect: this.lastDisconnect,
      lastError: this.lastError,
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024)
    };
  }

  async shutdown(signal) {
    console.log(`[runtime] Graceful shutdown requested (${signal}).`);
    await lifecycle.shutdown();
    process.exit(0);
  }
}

module.exports = { RuntimeManager };