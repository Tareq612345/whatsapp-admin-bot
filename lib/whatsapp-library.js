module.exports = require(
  process.env.BOT_ELECTRON_HOST === '1'
    ? 'wwebjs-electron'
    : 'whatsapp-web.js'
);