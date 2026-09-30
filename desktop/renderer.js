const state = {
  admins: null,
  commands: null,
  bot: { status: 'starting' },
  logs: []
};

if (!window.studio) {
  const sampleAdmins = {
    roles: {
      owner: { label: 'Owner', description: 'Full access to every command', allowedCommands: ['*'] },
      admin: { label: 'Administrator', description: 'Daily group operations', allowedCommands: ['help', 'ping', 'status', 'lock'] },
      moderator: { label: 'Moderator', description: 'Basic moderation', allowedCommands: ['help', 'ping'] }
    },
    admins: [{ id: 'preview', name: 'Primary owner', number: '201040224684', role: 'owner', enabled: true, lids: [], allowedCommands: [], deniedCommands: [] }],
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
    getState: async () => ({ bot: { status: 'ready', pid: 3184 }, logs: [{ at: new Date().toISOString(), source: 'bot', text: 'WhatsApp Admin Bot is ready.' }], autoStart: true }),
    readConfig: async name => structuredClone(name === 'admins' ? sampleAdmins : sampleCommands),
    saveConfig: async (_, value) => value,
    startBot: async () => {}, stopBot: async () => {}, restartBot: async () => {},
    setAutoStart: async value => value, openDashboard: async () => {}, openDataFolder: async () => {},
    onStatus: () => {}, onLog: () => {}, onBotEvent: () => {}
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
  $('#sidebarDetail').textContent = ready ? `Process ${bot.pid || ''}` : status === 'reconnecting' ? 'Trying to reconnect' : 'WhatsApp engine';
  $('#heroBadge').textContent = titleCase(status);
  $('#heroBadge').className = `status-badge ${ready ? 'ready' : ''}`;
  $('#connectionPercent').textContent = ready ? '✓' : '···';
  $('#connectionTitle').textContent = ready ? 'Connected' : titleCase(status);
  $('#connectionHint').textContent = ready ? 'WhatsApp is ready' : 'Waiting for WhatsApp';
  $('#metricConnection').textContent = titleCase(status);
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
      <div class="tags"><span class="tag role">${escapeHtml(role.label || admin.role)}</span><span class="tag">${(admin.lids || []).length} LID</span><span class="tag">${(admin.allowedCommands || []).length} custom grants</span></div>
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
  $('#adminLids').value = (admin.lids || []).join(', ');
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
      role: $('#adminRole').value, lids: $('#adminLids').value.split(',').map(value => value.replace(/\D/g, '')).filter(Boolean),
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
      $('#qrImage').src = event.dataUrl;
      if (!$('#qrDialog').open) $('#qrDialog').showModal();
    }
    if (event.type === 'ready' && $('#qrDialog').open) $('#qrDialog').close();
  });
}

initialize().catch(error => {
  console.error(error);
  toast(`Could not initialize Studio: ${error.message}`);
});