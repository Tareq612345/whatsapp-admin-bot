const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { AdminAccess } = require('../lib/admin-access');

function accessWith(data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-permissions-'));
  const file = path.join(dir, 'admins.json');
  fs.writeFileSync(file, JSON.stringify(data));
  return new AdminAccess(file);
}

test('applies role, direct grant, and explicit deny permissions', async () => {
  const access = accessWith({
    roles: { moderator: { allowedCommands: ['ping', 'lock'] } },
    admins: [{
      id: 'mod', name: 'Mod', number: '201111111111', role: 'moderator',
      enabled: true, allowedCommands: ['status'], deniedCommands: ['lock']
    }],
    members: { enabled: true, allowedCommands: ['help'] }
  });
  const message = { from: '201111111111@c.us' };
  assert.equal((await access.authorizeMessage(message, 'ping')).allowed, true);
  assert.equal((await access.authorizeMessage(message, 'status')).allowed, true);
  assert.equal((await access.authorizeMessage(message, 'lock')).allowed, false);
  assert.equal((await access.authorizeMessage(message, 'clear-group')).allowed, false);
});

test('allows only configured commands for regular members', async () => {
  const access = accessWith({
    roles: {},
    admins: [],
    members: { enabled: true, allowedCommands: ['help', 'ping'] }
  });
  const message = { from: '201999999999@c.us' };
  assert.equal((await access.authorizeMessage(message, 'ping')).allowed, true);
  assert.equal((await access.authorizeMessage(message, 'lock')).allowed, false);
});