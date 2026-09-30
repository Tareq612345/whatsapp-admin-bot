class MessageDeduper {
  constructor({ idTtlMs = 60_000, fingerprintTtlMs = 15_000, now = () => Date.now() } = {}) {
    this.idTtlMs = idTtlMs;
    this.fingerprintTtlMs = fingerprintTtlMs;
    this.now = now;
    this.ids = new Map();
    this.fingerprints = new Map();
  }

  messageId(message) {
    return message?.id?._serialized || message?.id?.$1 || message?.id?.id || '';
  }

  fingerprint(message, messageId) {
    const timeBucket = Math.floor(Number(message?.timestamp || this.now() / 1000) / 3);
    return [
      message?.from || '',
      message?.author || '',
      messageId || String(message?.body || '').trim(),
      timeBucket
    ].join('|');
  }

  isDuplicate(message) {
    const now = this.now();
    const messageId = this.messageId(message);
    if (messageId && (this.ids.get(messageId) || 0) > now) return true;
    const fingerprint = this.fingerprint(message, messageId);
    if ((this.fingerprints.get(fingerprint) || 0) > now) return true;
    if (messageId) this.ids.set(messageId, now + this.idTtlMs);
    this.fingerprints.set(fingerprint, now + this.fingerprintTtlMs);
    if (this.ids.size + this.fingerprints.size > 5000) this.prune(now);
    return false;
  }

  prune(now = this.now()) {
    for (const [key, expires] of this.ids) if (expires <= now) this.ids.delete(key);
    for (const [key, expires] of this.fingerprints) if (expires <= now) this.fingerprints.delete(key);
  }
}

module.exports = { MessageDeduper };