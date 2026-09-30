const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { removeWhatsAppSession } = require('../lib/session-data');

test('session reset removes only WhatsApp auth and cache', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-session-'));
  const auth = path.join(root, '.wwebjs_auth');
  const cache = path.join(root, '.wwebjs_cache');
  const config = path.join(root, 'config', 'admins.json');
  fs.mkdirSync(auth);
  fs.mkdirSync(cache);
  fs.mkdirSync(path.dirname(config));
  fs.writeFileSync(path.join(auth, 'session'), 'auth');
  fs.writeFileSync(path.join(cache, 'cache'), 'cache');
  fs.writeFileSync(config, '{"admins":[]}');

  removeWhatsAppSession(root);

  assert.equal(fs.existsSync(auth), false);
  assert.equal(fs.existsSync(cache), false);
  assert.equal(fs.readFileSync(config, 'utf8'), '{"admins":[]}');
});