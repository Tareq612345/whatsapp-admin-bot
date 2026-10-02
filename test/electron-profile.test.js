'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { botHostProfileRoot, runtimeDataRoot } = require('../lib/electron-profile');

test('the bot host keeps using the shared Studio data root', () => {
  const sharedRoot = path.join('C:', 'Users', 'Example', 'AppData', 'Roaming', 'WhatsApp Admin Studio');
  const isolatedElectronRoot = botHostProfileRoot(sharedRoot);

  assert.equal(runtimeDataRoot(sharedRoot, isolatedElectronRoot), sharedRoot);
});

test('the bot host uses a separate Electron debugging profile', () => {
  const sharedRoot = path.join('C:', 'Users', 'Example', 'AppData', 'Roaming', 'WhatsApp Admin Studio');

  assert.equal(botHostProfileRoot(sharedRoot), path.join(sharedRoot, 'electron-bot-host'));
  assert.notEqual(botHostProfileRoot(sharedRoot), sharedRoot);
});

test('the Studio root remains the Electron user-data root when no override exists', () => {
  const studioRoot = path.join('C:', 'Users', 'Example', 'AppData', 'Roaming', 'WhatsApp Admin Studio');

  assert.equal(runtimeDataRoot('', studioRoot), studioRoot);
});