const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { CommandConfig } = require('../lib/command-config');

function commandConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-commands-'));
  const file = path.join(dir, 'commands.json');
  fs.writeFileSync(file, JSON.stringify({
    prefix: '#',
    unknownCommandReply: 'Use {{prefix}}help',
    commands: {
      ping: { enabled: true, aliases: ['alive'], reply: 'Custom — {{default}}' },
      lock: { enabled: false, aliases: [], reply: '' }
    }
  }));
  return new CommandConfig(file);
}

test('resolves aliases and disabled commands', () => {
  const config = commandConfig();
  assert.equal(config.prefix(), '#');
  assert.equal(config.resolve('alive'), 'ping');
  assert.equal(config.resolve('#ping'), 'ping');
  assert.equal(config.isEnabled('lock'), false);
});

test('supports reply templates and global prefix placeholders', () => {
  const config = commandConfig();
  assert.equal(config.replyFor('ping', 'pong'), 'Custom — pong');
  assert.equal(config.globalReply('unknownCommandReply', 'fallback'), 'Use #help');
});