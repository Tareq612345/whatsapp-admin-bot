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

class AdminAccess {
  constructor(file = path.join(__dirname, '..', 'config', 'admins.json')) {
    this.file = file;
    this.lastModified = 0;
    this.admins = { numbers: [], lids: [] };
    this.reload(true);
  }

  reload(force = false) {
    try {
      const modified = fs.statSync(this.file).mtimeMs;
      if (!force && modified === this.lastModified) return this.admins;
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.admins = {
        numbers: [...new Set((data.numbers || []).map(digits).filter(Boolean))],
        lids: [...new Set((data.lids || []).map(digits).filter(Boolean))]
      };
      this.lastModified = modified;
    } catch (error) {
      if (force) console.error(`Could not load admin list: ${error.message}`);
    }
    return this.admins;
  }

  async isAllowedMessage(message, fallback = {}) {
    const admins = this.reload();
    const numbers = new Set([
      ...admins.numbers,
      digits(fallback.ownerNumber)
    ].filter(Boolean));
    const lids = new Set([
      ...admins.lids,
      ...(fallback.ownerLids || []).map(digits)
    ].filter(Boolean));
    const senderIds = [message.author, message.from].filter(Boolean);
    if (senderIds.some(id => numbers.has(personKey(id)) || lids.has(personKey(id)))) return true;

    try {
      const contact = await message.getContact();
      return numbers.has(digits(contact.number));
    } catch {
      return false;
    }
  }

  summary() {
    const admins = this.reload();
    return { numbers: admins.numbers.length, lids: admins.lids.length };
  }
}

module.exports = { AdminAccess, digits, personKey };