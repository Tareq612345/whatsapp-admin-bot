'use strict';

const path = require('path');

function runtimeDataRoot(environmentRoot, electronUserDataRoot) {
  return environmentRoot || electronUserDataRoot;
}

function botHostProfileRoot(sharedDataRoot) {
  return path.join(sharedDataRoot, 'electron-bot-host');
}

module.exports = {
  runtimeDataRoot,
  botHostProfileRoot
};