const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { OwnerClaimManager } = require('../lib/owner-claim');

function fixture(admins = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-claim-'));
  const file = path.join(directory, 'admins.json');
  fs.writeFileSync(file, JSON.stringify({
    roles: { owner: { label: 'Owner', allowedCommands: ['*'] } },
    admins,
    members: { enabled: true, allowedCommands: ['help', 'ping'] }
  }));
  return file;
}

test('issues one-time claim and stores number plus LID automatically', async () => {
  const file = fixture();
  let now = Date.parse('2026-09-30T12:00:00Z');
  const manager = new OwnerClaimManager({
    file,
    now: () => now,
    randomInt: () => 482917
  });

  assert.equal(manager.current().claim.code, '482917');
  const result = await manager.claim({
    author: '998877665544@lid',
    from: '1234567890@g.us',
    getContact: async () => ({
      number: '201234567890',
      pushname: 'Group owner',
      id: { _serialized: '998877665544@lid' }
    })
  }, '482917');

  assert.equal(result.ok, true);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.admins[0].number, '201234567890');
  assert.deepEqual(saved.admins[0].lids, ['998877665544']);
  assert.equal(manager.active, null);
  assert.equal(saved.setup.requiresOwnerClaim, false);
});

test('rejects invalid and expired codes without creating an owner', async () => {
  const file = fixture();
  let now = 1000;
  const manager = new OwnerClaimManager({
    file,
    ttlMs: 100,
    now: () => now,
    randomInt: () => 123456
  });
  manager.issue();
  assert.deepEqual(await manager.claim({}, '000000'), { ok: false, reason: 'invalid' });
  now = 1200;
  assert.equal((await manager.claim({}, '123456')).reason, 'expired');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).admins.length, 0);
});

test('removes the previously seeded placeholder owner', () => {
  const file = fixture([{
    id: 'primary-owner',
    name: 'Primary owner',
    number: '201234567890',
    lids: ['998877665544'],
    role: 'owner',
    enabled: true
  }]);
  const manager = new OwnerClaimManager({ file, randomInt: () => 111111 });

  assert.equal(manager.ownerConfigured(), false);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(saved.admins, []);
  assert.equal(saved.setup.requiresOwnerClaim, true);
});