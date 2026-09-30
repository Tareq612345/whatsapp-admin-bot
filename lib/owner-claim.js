const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { digits } = require('./admin-access');

const DEFAULT_TTL_MS = 10 * 60 * 1000;

function serialized(value) {
  if (!value) return '';
  return typeof value === 'string' ? value : value._serialized || '';
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function loadAdminFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function hasConfiguredOwner(data) {
  return (data.admins || []).some(admin => admin.enabled !== false && admin.role === 'owner');
}

function removeLegacySeededOwner(data) {
  if (data.setup?.ownerClaimedAt) return false;
  const previous = data.admins || [];
  const filtered = previous.filter(admin => !(
    admin.id === 'primary-owner' &&
    admin.name === 'Primary owner' &&
    admin.role === 'owner'
  ));
  if (filtered.length === previous.length) return false;
  data.admins = filtered;
  data.schemaVersion = Math.max(2, Number(data.schemaVersion) || 0);
  data.setup = { ...(data.setup || {}), requiresOwnerClaim: true };
  return true;
}

async function identityFromMessage(message) {
  let contact = null;
  try {
    contact = await message.getContact();
  } catch {}

  const candidates = [
    serialized(message.author),
    typeof message.from === 'string' && !message.from.endsWith('@g.us') ? message.from : '',
    serialized(contact?.id)
  ].filter(Boolean);
  const numbers = new Set();
  const lids = new Set();

  for (const candidate of candidates) {
    const key = digits(candidate);
    if (!key) continue;
    if (candidate.endsWith('@lid')) lids.add(key);
    if (candidate.endsWith('@c.us')) numbers.add(key);
  }
  const contactNumber = digits(contact?.number);
  if (contactNumber) numbers.add(contactNumber);

  return {
    name: contact?.pushname || contact?.name || contact?.shortName || 'Primary owner',
    number: [...numbers][0] || '',
    lids: [...lids]
  };
}

class OwnerClaimManager {
  constructor({
    file,
    ttlMs = DEFAULT_TTL_MS,
    now = () => Date.now(),
    randomInt = crypto.randomInt,
    onIssued = () => {},
    onClaimed = () => {}
  }) {
    this.file = file;
    this.ttlMs = ttlMs;
    this.now = now;
    this.randomInt = randomInt;
    this.onIssued = onIssued;
    this.onClaimed = onClaimed;
    this.active = null;
    this.prepare();
  }

  prepare() {
    const data = loadAdminFile(this.file);
    if (removeLegacySeededOwner(data)) atomicWriteJson(this.file, data);
  }

  ownerConfigured() {
    return hasConfiguredOwner(loadAdminFile(this.file));
  }

  issue() {
    if (this.ownerConfigured()) {
      this.active = null;
      return null;
    }
    const code = String(this.randomInt(100000, 1000000));
    this.active = {
      code,
      expiresAt: new Date(this.now() + this.ttlMs).toISOString()
    };
    this.onIssued({ ...this.active });
    return { ...this.active };
  }

  current() {
    if (this.ownerConfigured()) return { ownerConfigured: true, claim: null };
    if (!this.active || Date.parse(this.active.expiresAt) <= this.now()) this.issue();
    return { ownerConfigured: false, claim: { ...this.active } };
  }

  validCode(received) {
    if (!this.active || Date.parse(this.active.expiresAt) <= this.now()) return false;
    const candidate = String(received || '');
    if (!/^\d{6}$/.test(candidate)) return false;
    return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(this.active.code));
  }

  async claim(message, received) {
    if (this.ownerConfigured()) return { ok: false, reason: 'already-configured' };
    if (!this.active || Date.parse(this.active.expiresAt) <= this.now()) {
      this.issue();
      return { ok: false, reason: 'expired' };
    }
    if (!this.validCode(received)) return { ok: false, reason: 'invalid' };

    const identity = await identityFromMessage(message);
    if (!identity.number && !identity.lids.length) return { ok: false, reason: 'identity-unavailable' };

    const data = loadAdminFile(this.file);
    if (hasConfiguredOwner(data)) return { ok: false, reason: 'already-configured' };
    const owner = {
      id: `owner-${Date.now()}`,
      name: identity.name,
      number: identity.number,
      lids: identity.lids,
      role: 'owner',
      enabled: true,
      allowedCommands: [],
      deniedCommands: []
    };
    data.schemaVersion = Math.max(2, Number(data.schemaVersion) || 0);
    data.admins = [...(data.admins || []), owner];
    data.setup = {
      ...(data.setup || {}),
      requiresOwnerClaim: false,
      ownerClaimedAt: new Date(this.now()).toISOString()
    };
    atomicWriteJson(this.file, data);
    this.active = null;
    this.onClaimed(owner);
    return { ok: true, owner };
  }
}

module.exports = {
  OwnerClaimManager,
  atomicWriteJson,
  hasConfiguredOwner,
  identityFromMessage,
  removeLegacySeededOwner
};