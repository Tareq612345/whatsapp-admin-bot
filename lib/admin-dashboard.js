const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');
const lifecycle = require('./lifecycle');

function startAdminDashboard(options) {
  const {
    client, getConfig, saveConfig, saveBlockedGroupIds, dashboardGroupCache,
    syncBlocked, processMembershipRequests, clearGroup, groupById, runtime
  } = options;
  const dashboardPath = path.join(__dirname, '..', 'dashboard.html');
  const send = (res, code, data) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  const body = req => new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 100000) reject(new Error('Request too large'));
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
  const groups = async () => {
    const config = getConfig();
    const ids = [
      ...(config.blockedGroupIds || []), config.allowGroupId,
      ...(config.targetGroupIds || []), ...(config.approvalGroupIds || [])
    ].filter(Boolean);
    for (const id of ids) {
      if (!dashboardGroupCache.has(id)) dashboardGroupCache.set(id, { id, name: 'Saved group', participants: null });
    }
    return Array.from(dashboardGroupCache.values());
  };
  const action = async data => {
    const config = getConfig();
    if (data.action === 'dryRun') { config.dryRun = !!data.value; saveConfig(); return 'Dry-run updated'; }
    if (data.action === 'rateEnabled') { config.rateLimit.enabled = !!data.value; saveConfig(); return 'Rate monitoring updated'; }
    if (data.action === 'approvalEnabled') { config.approvalEnabled = !!data.value; saveConfig(); return 'Automatic approval updated'; }
    if (data.action === 'autoSync') { config.autoSyncEnabled = !!data.value; saveConfig(); return 'Automatic sync updated'; }
    if (data.action === 'settings') {
      config.rateLimit.limit = Math.max(1, Number(data.limit) || 25);
      config.rateLimit.windowSeconds = Math.max(5, Number(data.windowSeconds) || 60);
      config.rateLimit.lockDurationMinutes = Math.max(0, Number(data.lockDurationMinutes) || 5);
      if (['blacklist', 'allowlist'].includes(data.approvalMode)) config.approvalMode = data.approvalMode;
      saveConfig();
      return 'Settings saved';
    }
    if (data.action === 'setBlockedGroup') {
      if (data.groupId && !config.blockedGroupIds.includes(data.groupId)) config.blockedGroupIds.push(data.groupId);
      saveBlockedGroupIds();
      return 'Blocked-members group added';
    }
    if (data.action === 'setAllowGroup') { config.allowGroupId = data.groupId || null; saveConfig(); return 'Allow-list group selected'; }
    if (data.action === 'setApprovalGroup') {
      if (data.groupId && !config.approvalGroupIds.includes(data.groupId)) config.approvalGroupIds.push(data.groupId);
      saveConfig();
      return 'Approval group selected';
    }
    if (data.action === 'addTarget') {
      if (data.groupId && !config.targetGroupIds.includes(data.groupId)) config.targetGroupIds.push(data.groupId);
      saveConfig();
      return 'Monitoring target added';
    }
    if (data.action === 'removeTarget') {
      config.targetGroupIds = config.targetGroupIds.filter(id => id !== data.groupId);
      saveConfig();
      return 'Monitoring target removed';
    }
    if (data.action === 'syncBlocked') {
      const result = await syncBlocked();
      return `Scan complete: ${result.removed} removed, ${result.wouldRemove} in dry-run`;
    }
    if (data.action === 'approvePending') {
      const result = await processMembershipRequests();
      return `Requests: ${result.approved} approved, ${result.rejected} rejected`;
    }
    if (data.action === 'rejectBlocked') {
      const result = await processMembershipRequests({ onlyBlocked: true });
      return `${result.rejected} blocked request(s) rejected`;
    }
    if (data.action === 'clearGroup') {
      const group = await groupById(data.groupId);
      if (!group) return 'Could not load group';
      const result = await clearGroup(group);
      return config.dryRun
        ? `Dry-run: ${result.wouldRemove} of ${result.total} would be removed`
        : `${result.removed} of ${result.total} removed (${result.kept} kept)`;
    }
    throw new Error('Unknown action');
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(fs.readFileSync(dashboardPath));
      }
      const config = getConfig();
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return send(res, runtime.health().ok ? 200 : 503, { ...runtime.health(), services: lifecycle.healthSnapshot() });
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        return send(res, 200, {
          ready: !!client.info?.wid, ownerNumber: config.ownerNumber, dryRun: config.dryRun,
          approvalEnabled: config.approvalEnabled, approvalMode: config.approvalMode,
          autoSyncEnabled: config.autoSyncEnabled, targetCount: config.targetGroupIds.length,
          rateLimit: config.rateLimit
        });
      }
      if (req.method === 'GET' && url.pathname === '/api/groups') return send(res, 200, { groups: await groups() });
      if (req.method === 'GET' && url.pathname === '/api/logs') return send(res, 200, { logs: config.logs.slice(-50) });
      if (req.method === 'POST' && url.pathname === '/api/action') return send(res, 200, { message: await action(await body(req)) });
      return send(res, 404, { error: 'Not found' });
    } catch (error) {
      runtime.recordError(error);
      if (!res.headersSent) send(res, 500, { error: error.message });
    }
  });
  server.listen(3000, '127.0.0.1', () => console.log('Admin dashboard: http://127.0.0.1:3000'));
  lifecycle.registerCleanup('admin-dashboard', () => new Promise(resolve => server.close(resolve)));
  lifecycle.registerHealth('admin-dashboard', () => ({ ok: server.listening, port: 3000 }));
  return server;
}

module.exports = { startAdminDashboard };