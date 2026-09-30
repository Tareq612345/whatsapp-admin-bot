const fs = require('fs');
const path = require('path');

function whatsappSessionPaths(dataRoot) {
  return {
    auth: path.join(dataRoot, '.wwebjs_auth'),
    cache: path.join(dataRoot, '.wwebjs_cache')
  };
}

function removeWhatsAppSession(dataRoot) {
  const paths = whatsappSessionPaths(dataRoot);
  fs.rmSync(paths.auth, { recursive: true, force: true });
  fs.rmSync(paths.cache, { recursive: true, force: true });
  return paths;
}

module.exports = { removeWhatsAppSession, whatsappSessionPaths };