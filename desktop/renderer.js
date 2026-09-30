const state = {
  admins: null,
  commands: null,
  bot: { status: 'starting' },
  auth: { status: 'starting', qrDataUrl: null },
  setup: { ownerConfigured: false, claimCode: null, expiresAt: null, owner: null },
  setupFocused: false,
  lastShownQr: null,
  logs: []
};

if (!window.studio) {
  const sampleAdmins = {
    roles: {
      owner: { label: 'Owner', description: 'Full access to every command', allowedCommands: ['*'] },
      admin: { label: 'Administrator', description: 'Daily group operations', allowedCommands: ['help', 'ping', 'status', 'lock'] },
      moderator: { label: 'Moderator', description: 'Basic moderation', allowedCommands: ['help', 'ping'] }
    },
    admins: [],
    members: { enabled: true, allowedCommands: ['help', 'ping'] }
  };
  const sampleCommands = {
    prefix: '!',
    unknownCommandReply: 'Unknown command. Use {{prefix}}help.',
    forbiddenReply: 'You do not have permission to use this command.',
    disabledReply: 'This command is currently disabled.',
    commands: {
      help: { enabled: true, aliases: ['commands'], reply: '' },
      ping: { enabled: true, aliases: ['alive'], reply: '{{default}}' },
      status: { enabled: true, aliases: [], reply: '{{default}}' },
      lock: { enabled: true, aliases: [], reply: '{{default}}' },
      unlock: { enabled: true, aliases: [], reply: '{{default}}' }
    }
  };
  window.studio = {
    getState: async () => ({
      bot: { status: 'ready', pid: 3184 },
      auth: { status: 'ready', account: { name: 'Connected account', number: '201234567890' }, message: 'WhatsApp is connected.' },
      setup: { ownerConfigured: false, claimCode: '482917', expiresAt: new Date(Date.now() + 600000).toISOString(), owner: null },
      logs: [{ at: new Date().toISOString(), source: 'bot', text: 'WhatsApp Admin Bot is ready.' }],
      autoStart: true
    }),
    readConfig: async name => structuredClone(name === 'admins' ? sampleAdmins : sampleCommands),
    saveConfig: async (_, value) => value,
    startBot: async () => {}, stopBot: async () => {}, restartBot: async () => {},
    renewOwnerClaim: async () => {}, resetWhatsAppSession: async () => {},
    setAutoStart: async value => value, openDashboard: async () => {}, openDataFolder: async () => {},
    onStatus: () => {}, onLog: () => {}, onBotEvent: () => {}, onSetup: () => {}
  };
}

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 2400);
}

function navigate(view) {
  $$('.view').forEach(node => node.classList.toggle('active', node.id === `view-${view}`));
  $$('.nav-item').forEach(node => node.classList.toggle('active', node.dataset.view === view));
  const titles = { overview: 'Overview', admins: 'Administrators', permissions: 'Permissions', commands: 'Commands & replies', activity: 'Activity', settings: 'Settings' };
  $('#pageTitle').textContent = titles[view] || 'Overview';
}

function titleCase(value) {
  return String(value).replace(/[-_]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function renderStatus(bot) {
  state.bot = bot;
  const status = bot.status || 'stopped';
  const ready = status === 'ready';
  const error = ['error', 'stopped'].includes(status);
  $('#sidebarDot').className = `status-dot ${ready ? 'ready' : error ? 'error' : ''}`;
  $('#sidebarStatus').textContent = titleCase(status);
  $('#sidebarDetail').textContent = ready
    ? `Process ${bot.pid || ''}`
    : status === 'waiting-login'
      ? 'Login required'
      : status === 'reconnecting'
        ? 'Trying to reconnect'
        : 'WhatsApp engine';
  $('#heroBadge').textContent = titleCase(status);
  $('#heroBadge').className = `status-badge ${ready ? 'ready' : ''}`;
  $('#connectionPercent').textContent = ready ? '✓' : '···';
  $('#connectionTitle').textContent = ready ? 'Connected' : titleCase(status);
  $('#connectionHint').textContent = ready ? 'WhatsApp is ready' : 'Waiting for WhatsApp';
  $('#metricConnection').textContent = titleCase(status);
}

function showQrDialog() {
  if (!state.auth?.qrDataUrl) return;
  $('#qrImage').src = state.auth.qrDataUrl;
  if (!$('#qrDialog').open) $('#qrDialog').showModal();
}

function renderAuth(auth = {}) {
  state.auth = { ...state.auth, ...auth };
  const status = state.auth.status || 'starting';
  const ready = status === 'ready';
  const failed = ['auth-failure', 'stopped'].includes(status);
  const hasQr = status === 'qr' && Boolean(state.auth.qrDataUrl);
  const titles = {
    starting: 'Checking your saved session',
    qr: 'WhatsApp login required',
    authenticated: 'Login accepted',
    loading: 'Loading your WhatsApp account',
    ready: 'WhatsApp connected',
    disconnected: 'Connection interrupted',
    'auth-failure': 'Could not use the saved session',
    stopped: 'WhatsApp engine stopped'
  };

  $('#loginPanel').className = `login-panel${ready ? ' connected' : ''}${failed ? ' error' : ''}`;
  $('#loginEyebrow').textContent = ready ? 'CONNECTION' : 'WHATSAPP SETUP';
  $('#loginTitle').textContent = titles[status] || titleCase(status);
  $('#loginMessage').textContent = state.auth.message || 'Waiting for WhatsApp…';
  const accountLabel = state.auth.account
    ? [state.auth.account.name, state.auth.account.number ? `+${state.auth.account.number}` : ''].filter(Boolean).join(' · ')
    : 'Not connected';
  $('#connectedAccount').textContent = accountLabel;
  $('#showQr').disabled = !hasQr;
  $('#showQr').textContent = hasQr ? 'Show QR code' : ready ? 'Connected' : 'Waiting for QR…';
  $('#retryLogin').hidden = ready || hasQr || ['authenticated', 'loading'].includes(status);
  $('#retryLogin').textContent = status === 'auth-failure' ? 'Reset session and show new QR' : 'Retry connection';

  if (hasQr && state.lastShownQr !== state.auth.qrDataUrl) {
    state.lastShownQr = state.auth.qrDataUrl;
    showQrDialog();
  }
  if (ready && $('#qrDialog').open) $('#qrDialog').close();
}

function renderSetup(setup = {}) {
  state.setup = { ...state.setup, ...setup };
  const panel = $('#ownerSetup');
  panel.hidden = state.setup.ownerConfigured;
  $('#ownerStatus').textContent = state.setup.ownerConfigured
    ? `${state.setup.owner?.name || 'Owner'} configured`
    : 'Owner not configured';
  $('#claimCode').textContent = state.setup.claimCode || '------';
  $('#claimCommand').textContent = state.setup.claimCode ? `!claim ${state.setup.claimCode}` : '!claim ------';
  $('#copyClaim').disabled = !state.setup.claimCode;
  $('#addAdmin').disabled = !state.setup.ownerConfigured;
  $('#addAdmin').title = state.setup.ownerConfigured ? '' : 'Claim the Owner account first';
  updateClaimCountdown();
  if (!state.setup.ownerConfigured && state.setup.claimCode && !state.setupFocused) {
    state.setupFocused = true;
    requestAnimationFrame(() => panel.scrollIntoView({ block: 'start' }));
  }
}

function updateClaimCountdown() {
  const node = $('#claimExpiry');
  if (!node || state.setup.ownerConfigured) return;
  const remaining = Date.parse(state.setup.expiresAt || '') - Date.now();
  if (!state.setup.claimCode || !Number.isFinite(remaining) || remaining <= 0) {
    node.textContent = 'Code expired. Generate a new one.';
    node.classList.add('expired');
    return;
  }
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  node.textContent = `Expires in ${minutes}:${String(seconds).padStart(2, '0')}`;
  node.classList.remove('expired');
}

function renderMetrics(autoStart) {
  const admins = state.admins?.admins?.filter(item => item.enabled !== false).length || 0;
  const commands = Object.values(state.commands?.commands || {}).filter(item => item.enabled !== false).length;
  $('#metricAdmins').textContent = admins;
  $('#metricCommands').textContent = commands;
  $('#metricAutoStart').textContent = autoStart ? 'Enabled' : 'Disabled';
  $('#autoStart').checked = autoStart;
}

function renderAdmins() {
  const roles = state.admins.roles || {};
  $('#adminRole').innerHTML = Object.entries(roles).map(([key, role]) => `<option value="${key}">${role.label || titleCase(key)}</option>`).join('');
  $('#adminList').innerHTML = state.admins.admins.map(admin => {
    const role = roles[admin.role] || {};
    const initials = (admin.name || admin.number || '?').split(/\s+/).map(value => value[0]).slice(0,2).join('').toUpperCase();
    return `<article class="admin-card">
      <div class="admin-card-head"><div class="avatar">${initials}</div><span class="tag ${admin.enabled === false ? '' : 'role'}">${admin.enabled === false ? 'Disabled' : 'Active'}</span></div>
      <h3>${escapeHtml(admin.name || 'Unnamed')}</h3>
      <p>${escapeHtml(admin.number || 'No number')}</p>
      <div class="tags"><span class="tag role">${escapeHtml(role.label || admin.role)}</span><span class="tag">${(admin.allowedCommands || []).length} custom grants</span></div>
      <div class="card-actions"><button data-edit-admin="${admin.id}">Edit</button><button class="danger" data-delete-admin="${admin.id}">Delete</button></div>
    </article>`;
  }).join('') || '<div class="empty panel">No administrators configured.</div>';
}

function allCommandNames() {
  return Object.keys(state.commands?.commands || {});
}

function permissionChips(selected, scope, all = false) {
  const names = all ? ['*', ...allCommandNames()] : allCommandNames();
  return names.map(name => `<label class="permission-chip"><input type="checkbox" data-permission-scope="${scope}" value="${name}" ${selected.includes(name) ? 'checked' : ''}><span>${name === '*' ? 'All commands' : `!${name}`}</span></label>`).join('');
}

function renderPermissions() {
  $('#membersEnabled').checked = state.admins.members?.enabled === true;
  $('#memberPermissions').innerHTML = permissionChips(state.admins.members?.allowedCommands || [], 'members');
  $('#roleGrid').innerHTML = Object.entries(state.admins.roles || {}).map(([key, role]) => `
    <article class="role-card">
      <p class="eyebrow">${escapeHtml(key.toUpperCase())}</p>
      <h3>${escapeHtml(role.label || titleCase(key))}</h3>
      <p>${escapeHtml(role.description || 'Custom role')}</p>
      <div class="permission-chips">${permissionChips(role.allowedCommands || [], `role:${key}`, true)}</div>
    </article>`).join('');
}

function renderCommands(filter = '') {
  const query = filter.trim().toLowerCase();
  const entries = Object.entries(state.commands.commands || {}).filter(([name, command]) =>
    name.includes(query) || (command.aliases || []).some(alias => alias.includes(query))
  );
  $('#commandPrefix').value = state.commands.prefix || '!';
  $('#enabledCommandCount').textContent = Object.values(state.commands.commands || {}).filter(command => command.enabled !== false).length;
  $('#commandList').innerHTML = entries.map(([name, command]) => `
    <article class="command-card" data-command="${name}">
      <div class="command-name"><code>${escapeHtml((state.commands.prefix || '!') + name)}</code><label class="switch-row" title="Enable command"><input type="checkbox" data-command-enabled ${command.enabled !== false ? 'checked' : ''}><i></i></label></div>
      <label>Aliases<input data-command-aliases value="${escapeHtml((command.aliases || []).join(', '))}" placeholder="comma separated"></label>
      <label>Reply override<textarea data-command-reply placeholder="{{default}} keeps the original response">${escapeHtml(command.reply || '')}</textarea></label>
    </article>`).join('');
}

function logRow(entry) {
  const time = new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `<div class="log-row ${entry.source === 'error' ? 'error' : ''}"><time>${time}</time><span>${escapeHtml(entry.source)}</span><code>${escapeHtml(entry.text)}</code></div>`;
}

function renderLogs() {
  const html = state.logs.length ? state.logs.map(logRow).join('') : '<div class="empty">No output yet.</div>';
  $('#terminal').innerHTML = html;
  $('#miniLog').innerHTML = state.logs.length ? state.logs.slice(-8).map(logRow).join('') : '<div class="empty">Activity will appear here.</div>';
  $('#terminal').scrollTop = $('#terminal').scrollHeight;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
}

function openAdmin(admin = {}) {
  $('#adminDialogTitle').textContent = admin.id ? 'Edit administrator' : 'Add administrator';
  $('#adminId').value = admin.id || '';
  $('#adminName').value = admin.name || '';
  $('#adminNumber').value = admin.number || '';
  $('#adminRole').value = admin.role || Object.keys(state.admins.roles)[0] || 'owner';
  $('#adminAllowed').value = (admin.allowedCommands || []).join(', ');
  $('#adminDenied').value = (admin.deniedCommands || []).join(', ');
  $('#adminEnabled').checked = admin.enabled !== false;
  $('#adminDialog').showModal();
}

async function saveAdmins() {
  await window.studio.saveConfig('admins', state.admins);
  renderAdmins();
  renderPermissions();
  renderMetrics($('#autoStart').checked);
  toast('Administrator settings saved');
}

function bindEvents() {
  $$('.nav-item').forEach(button => button.addEventListener('click', () => navigate(button.dataset.view)));
  $$('[data-jump]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.jump)));
  $('#openDashboard').addEventListener('click', () => window.studio.openDashboard(3000));
  $('#openStudentGate').addEventListener('click', () => window.studio.openDashboard(3001));
  $('#restartBot').addEventListener('click', async () => { await window.studio.restartBot(); toast('Bot restarted'); });
  $('#showQr').addEventListener('click', showQrDialog);
  $('#retryLogin').addEventListener('click', async () => {
    if (state.auth.status === 'auth-failure') {
      if (!confirm('The saved WhatsApp session was rejected. Remove it and connect again? Bot settings will be kept.')) return;
      renderAuth({ status: 'starting', account: null, message: 'Removing the rejected session…', qrDataUrl: null });
      await window.studio.resetWhatsAppSession();
      return;
    }
    renderAuth({ status: 'starting', message: 'Restarting the WhatsApp connection…', qrDataUrl: null });
    await window.studio.restartBot();
  });
  $('#copyClaim').addEventListener('click', async () => {
    if (!state.setup.claimCode) return;
    await navigator.clipboard.writeText(`!claim ${state.setup.claimCode}`);
    toast('Owner command copied');
  });
  $('#renewClaim').addEventListener('click', async () => {
    await window.studio.renewOwnerClaim();
    toast('Generating a new owner code…');
  });
  $('#resetSession').addEventListener('click', async () => {
    if (!confirm('Disconnect this WhatsApp account and generate a new QR code? Your bot settings will be kept.')) return;
    renderAuth({ status: 'starting', account: null, message: 'Removing the saved session…', qrDataUrl: null });
    await window.studio.resetWhatsAppSession();
  });
  $('#startBot').addEventListener('click', () => window.studio.startBot());
  $('#stopBot').addEventListener('click', () => window.studio.stopBot());
  $('#openData').addEventListener('click', () => window.studio.openDataFolder());
  $('#autoStart').addEventListener('change', async event => {
    const enabled = await window.studio.setAutoStart(event.target.checked);
    renderMetrics(enabled);
    toast(enabled ? 'Auto start enabled' : 'Auto start disabled');
  });
  $('#addAdmin').addEventListener('click', () => openAdmin());
  $('#adminList').addEventListener('click', async event => {
    const editId = event.target.dataset.editAdmin;
    const deleteId = event.target.dataset.deleteAdmin;
    if (editId) openAdmin(state.admins.admins.find(admin => admin.id === editId));
    if (deleteId && confirm('Delete this administrator?')) {
      state.admins.admins = state.admins.admins.filter(admin => admin.id !== deleteId);
      await saveAdmins();
    }
  });
  $('#confirmAdmin').addEventListener('click', async event => {
    event.preventDefault();
    if (!$('#adminForm').reportValidity()) return;
    const id = $('#adminId').value || `admin-${Date.now()}`;
    const previous = state.admins.admins.find(admin => admin.id === id) || {};
    const admin = {
      ...previous, id, name: $('#adminName').value.trim(), number: $('#adminNumber').value.replace(/\D/g, ''),
      role: $('#adminRole').value, lids: previous.lids || [],
      enabled: $('#adminEnabled').checked,
      allowedCommands: $('#adminAllowed').value.split(',').map(value => value.trim().replace(/^[!/#.]+/, '')).filter(Boolean),
      deniedCommands: $('#adminDenied').value.split(',').map(value => value.trim().replace(/^[!/#.]+/, '')).filter(Boolean)
    };
    const index = state.admins.admins.findIndex(item => item.id === id);
    if (index < 0) state.admins.admins.push(admin); else state.admins.admins[index] = admin;
    await saveAdmins();
    $('#adminDialog').close();
  });
  $('#savePermissions').addEventListener('click', async () => {
    state.admins.members = {
      enabled: $('#membersEnabled').checked,
      allowedCommands: $$('[data-permission-scope="members"]:checked').map(input => input.value)
    };
    for (const key of Object.keys(state.admins.roles)) {
      state.admins.roles[key].allowedCommands = $$(`[data-permission-scope="role:${key}"]:checked`).map(input => input.value);
    }
    await saveAdmins();
  });
  $('#commandSearch').addEventListener('input', event => renderCommands(event.target.value));
  $('#saveCommands').addEventListener('click', async () => {
    state.commands.prefix = $('#commandPrefix').value || '!';
    $$('.command-card').forEach(card => {
      const command = state.commands.commands[card.dataset.command];
      command.enabled = card.querySelector('[data-command-enabled]').checked;
      command.aliases = card.querySelector('[data-command-aliases]').value.split(',').map(value => value.trim().replace(/^[!/#.]+/, '')).filter(Boolean);
      command.reply = card.querySelector('[data-command-reply]').value;
    });
    await window.studio.saveConfig('commands', state.commands);
    renderCommands($('#commandSearch').value);
    renderMetrics($('#autoStart').checked);
    toast('Command settings saved');
  });
  $('#saveGlobals').addEventListener('click', async () => {
    state.commands.unknownCommandReply = $('#unknownReply').value;
    state.commands.forbiddenReply = $('#forbiddenReply').value;
    state.commands.disabledReply = $('#disabledReply').value;
    await window.studio.saveConfig('commands', state.commands);
    toast('Global messages saved');
  });
  $('#clearLogs').addEventListener('click', () => { state.logs = []; renderLogs(); });
  $('#closeQr').addEventListener('click', () => $('#qrDialog').close());
}

async function initialize() {
  const [desktopState, admins, commands] = await Promise.all([
    window.studio.getState(),
    window.studio.readConfig('admins'),
    window.studio.readConfig('commands')
  ]);
  state.admins = admins;
  state.commands = commands;
  state.logs = desktopState.logs || [];
  renderStatus(desktopState.bot);
  renderAuth(desktopState.auth);
  renderSetup(desktopState.setup);
  renderMetrics(desktopState.autoStart);
  renderAdmins();
  renderPermissions();
  renderCommands();
  renderLogs();
  $('#unknownReply').value = commands.unknownCommandReply || '';
  $('#forbiddenReply').value = commands.forbiddenReply || '';
  $('#disabledReply').value = commands.disabledReply || '';
  bindEvents();
  if (location.hash) navigate(location.hash.slice(1));

  window.studio.onStatus(renderStatus);
  window.studio.onLog(entry => {
    state.logs.push(entry);
    if (state.logs.length > 1000) state.logs.shift();
    renderLogs();
  });
  window.studio.onBotEvent(event => {
    if (event.type === 'qr' && event.dataUrl) {
      renderAuth({ status: 'qr', qrDataUrl: event.dataUrl, message: 'Scan the QR code with the WhatsApp account that will run the bot.' });
    }
    if (event.type === 'authenticated') renderAuth({ status: 'authenticated', qrDataUrl: null, message: 'Login accepted. Loading your WhatsApp account…' });
    if (event.type === 'loading') renderAuth({ status: 'loading', qrDataUrl: null, message: event.message || 'Loading WhatsApp…' });
    if (event.type === 'ready') renderAuth({ status: 'ready', account: event.account || null, qrDataUrl: null, message: 'WhatsApp is connected. Your saved session will be reused automatically.' });
    if (event.type === 'auth-failure') renderAuth({ status: 'auth-failure', qrDataUrl: null, message: event.message || 'WhatsApp rejected the saved session. Try connecting again.' });
    if (event.type === 'disconnected') renderAuth({ status: 'disconnected', qrDataUrl: null, message: 'Connection lost. Studio is trying to reconnect…' });
  });
  window.studio.onSetup(async setup => {
    renderSetup(setup);
    if (setup.ownerConfigured) {
      state.admins = await window.studio.readConfig('admins');
      renderAdmins();
      renderPermissions();
      renderMetrics($('#autoStart').checked);
      toast('Owner setup completed');
    }
  });
  setInterval(updateClaimCountdown, 1000);
}

initialize().catch(error => {
  console.error(error);
  toast(`Could not initialize Studio: ${error.message}`);
});