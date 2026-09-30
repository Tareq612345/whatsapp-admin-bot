const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { AdminAccess } = require('../lib/admin-access');

test('allows configured phone numbers and LIDs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-admins-'));
  const file = path.join(dir, 'admins.json');
  fs.writeFileSync(file, JSON.stringify({ numbers: ['201111111111'], lids: ['999888777'] }));
  const access = new AdminAccess(file);
  assert.equal(await access.isAllowedMessage({ from: '201111111111@c.us' }), true);
  assert.equal(await access.isAllowedMessage({ author: '999888777@lid', from: 'group@g.us' }), true);
  assert.equal(await access.isAllowedMessage({ from: '201222222222@c.us' }), false);
});

test('supports the legacy owner fallback', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-admins-'));
  const file = path.join(dir, 'admins.json');
  fs.writeFileSync(file, JSON.stringify({ numbers: [], lids: [] }));
  const access = new AdminAccess(file);
  assert.equal(
    await access.isAllowedMessage({ from: '201333333333@c.us' }, { ownerNumber: '201333333333' }),
    true
  );
});