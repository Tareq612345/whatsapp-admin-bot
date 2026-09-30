const fs = require('fs');
const path = require('path');

function digits(value) {
  return String(value || '').replace(/\D/g, '').replace(/^00/, '');
}

function personKey(value) {
  if (!value) return '';
  const raw = typeof value === 'string' ? value : value._serialized || value.user || '';
  return digits(raw);
}

function normalizeCommand(command) {
  return String(command || '').trim().replace(/^[!/#.]+/, '').toLowerCase();
}

class AdminAccess {
  constructor(file = path.join(process.env.BOT_CONFIG_DIR || path.join(__dirname, '..', 'config'), 'admins.json')) {
    this.file = file;
    this.lastModified = 0;
    this.data = { roles: {}, admins: [], members: { enabled: false, allowedCommands: [] } };
    this.reload(true);
  }

  reload(force = false) {
    try {
      const modified = fs.statSync(this.file).mtimeMs;
      if (!force && modified === this.lastModified) return this.data;
      this.data = this.migrate(JSON.parse(fs.readFileSync(this.file, 'utf8')));
      this.lastModified = modified;
    } catch (error) {
      if (force) console.error(`Could not load administrator settings: ${error.message}`);
    }
    return this.data;
  }

  migrate(parsed) {
    if (Array.isArray(parsed.admins)) {
      return {
        roles: parsed.roles || {},
        admins: parsed.admins.map((admin, index) => ({
          id: admin.id || `admin-${index + 1}`,
          name: admin.name || admin.number || `Admin ${index + 1}`,
          number: digits(admin.number),
          lids: (admin.lids || []).map(digits).filter(Boolean),
          role: admin.role || 'admin',
          enabled: admin.enabled !== false,
          allowedCommands: (admin.allowedCommands || []).map(normalizeCommand),
          deniedCommands: (admin.deniedCommands || []).map(normalizeCommand)
        })),
        members: {
          enabled: parsed.members?.enabled === true,
          allowedCommands: (parsed.members?.allowedCommands || []).map(normalizeCommand)
        }
      };
    }
    const numbers = (parsed.numbers || []).map(digits).filter(Boolean);
    const lids = (parsed.lids || []).map(digits).filter(Boolean);
    return {
      roles: { owner: { label: 'Owner', allowedCommands: ['*'] } },
      admins: numbers.map((number, index) => ({
        id: `legacy-${index + 1}`,
        name: index === 0 ? 'Primary owner' : `Administrator ${index + 1}`,
        number,
        lids: index === 0 ? lids : [],
        role: 'owner',
        enabled: true,
        allowedCommands: [],
        deniedCommands: []
      })),
      members: { enabled: false, allowedCommands: [] }
    };
  }

  async resolveIdentity(message, fallback = {}) {
    const data = this.reload();
    const senderKeys = [message.author, message.from].filter(Boolean).map(personKey);
    try {
      const contact = await message.getContact();
      const contactNumber = digits(contact.number);
      if (contactNumber) senderKeys.push(contactNumber);
    } catch {}

    let admin = data.admins.find(item =>
      item.enabled !== false &&
      (senderKeys.includes(digits(item.number)) || item.lids.some(lid => senderKeys.includes(digits(lid))))
    );
    return admin
      ? { type: 'admin', admin, role: data.roles[admin.role] || {} }
      : { type: 'member', admin: null, role: null };
  }

  async authorizeMessage(message, command, fallback = {}) {
    const normalized = normalizeCommand(command);
    const identity = await this.resolveIdentity(message);
    if (identity.type === 'member') {
      const members = this.reload().members;
      return { ...identity, command: normalized, allowed: members.enabled && members.allowedCommands.includes(normalized) };
    }
    const roleAllowed = (identity.role.allowedCommands || []).map(normalizeCommand);
    const directAllowed = (identity.admin.allowedCommands || []).map(normalizeCommand);
    const denied = (identity.admin.deniedCommands || []).map(normalizeCommand);
    const allowed = !denied.includes(normalized) && (
      roleAllowed.includes('*') || roleAllowed.includes(normalized) ||
      directAllowed.includes('*') || directAllowed.includes(normalized)
    );
    return { ...identity, command: normalized, allowed };
  }

  async isAllowedMessage(message, fallback = {}) {
    return (await this.resolveIdentity(message)).type === 'admin';
  }

  summary() {
    const data = this.reload();
    return {
      admins: data.admins.filter(admin => admin.enabled !== false).length,
      roles: Object.keys(data.roles).length,
      memberCommands: data.members.allowedCommands.length
    };
  }
}

module.exports = { AdminAccess, digits, personKey, normalizeCommand };