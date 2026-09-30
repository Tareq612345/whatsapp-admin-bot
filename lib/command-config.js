const fs = require('fs');
const path = require('path');
const { normalizeCommand } = require('./admin-access');

class CommandConfig {
  constructor(file = path.join(process.env.BOT_CONFIG_DIR || path.join(__dirname, '..', 'config'), 'commands.json')) {
    this.file = file;
    this.lastModified = 0;
    this.data = { prefix: '!', commands: {} };
    this.reload(true);
  }

  reload(force = false) {
    try {
      const modified = fs.statSync(this.file).mtimeMs;
      if (!force && modified === this.lastModified) return this.data;
      this.data = { prefix: '!', commands: {}, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
      this.lastModified = modified;
    } catch (error) {
      if (force) console.error(`Could not load command settings: ${error.message}`);
    }
    return this.data;
  }

  prefix() {
    return String(this.reload().prefix || '!').slice(0, 3);
  }

  resolve(input) {
    const name = normalizeCommand(input);
    const commands = this.reload().commands || {};
    if (commands[name]) return name;
    for (const [canonical, settings] of Object.entries(commands)) {
      if ((settings.aliases || []).map(normalizeCommand).includes(name)) return canonical;
    }
    return null;
  }

  isEnabled(command) {
    return this.reload().commands?.[normalizeCommand(command)]?.enabled !== false;
  }

  replyFor(command, fallback, values = {}) {
    const data = this.reload();
    const template = data.commands?.[normalizeCommand(command)]?.reply;
    if (!template) return fallback;
    return String(template).replace(/\{\{(\w+)\}\}/g, (_, key) => {
      if (key === 'default') return fallback;
      if (key === 'prefix') return data.prefix || '!';
      if (key === 'command') return normalizeCommand(command);
      return values[key] == null ? `{{${key}}}` : String(values[key]);
    });
  }

  globalReply(key, fallback) {
    const data = this.reload();
    return String(data[key] || fallback).replace(/\{\{prefix\}\}/g, data.prefix || '!');
  }

  list() {
    return this.reload().commands || {};
  }
}

module.exports = { CommandConfig };