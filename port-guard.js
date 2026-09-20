const http = require('http');

const originalCreateServer = http.createServer;

http.createServer = function guardedCreateServer(...args) {
  const server = originalCreateServer.apply(this, args);
  server.on('error', error => {
    if (error && error.code === 'EADDRINUSE') {
      const address = typeof server.address === 'function' ? server.address() : null;
      const port = address && address.port ? address.port : 'المطلوب';
      console.error(`[dashboard] البورت ${port} مستخدم بالفعل. غالبًا توجد نسخة أخرى من البوت تعمل.`);
      console.error('[dashboard] اقفل نسخة البوت القديمة ثم شغّل start-bot.cmd من جديد.');
      return;
    }
    console.error('[dashboard] Server error:', error && error.message ? error.message : error);
  });
  return server;
};
