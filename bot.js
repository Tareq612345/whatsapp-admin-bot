const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('./lib/whatsapp-library');
const qrcode = require('qrcode-terminal');
const { AdminAccess } = require('./lib/admin-access');
const { CommandConfig } = require('./lib/command-config');
const { RuntimeManager } = require('./lib/runtime-manager');
const { startAdminDashboard } = require('./lib/admin-dashboard');

const RUNTIME_DIR = process.env.BOT_DATA_DIR || __dirname;
fs.mkdirSync(RUNTIME_DIR, { recursive: true });
const CONFIG_PATH = path.join(RUNTIME_DIR, 'config.json');

function desktopEvent(type, payload = {}) {
  if (process.env.BOT_DESKTOP_EVENTS === '1') {
    console.log(`[desktop-event] ${JSON.stringify({ type, ...payload })}`);
  }
}
const DEFAULT_CONFIG = {
  ownerNumber: '201040224684',
  // WhatsApp is currently exposing this account as a LID.
  ownerLids: ['35816386629826'],
  dryRun: true,
  blockedGroupId: null,
  allowGroupId: null,
  targetGroupIds: [],
  approvalGroupIds: [],
  exceptions: [],
  approvalEnabled: false,
  approvalMode: 'blacklist',
  autoSyncEnabled: false,
  rateLimit: {
    enabled: true,
    limit: 25,
    windowSeconds: 60,
    lockDurationMinutes: 5
  },
  logs: []
};

function loadConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return {
      ...DEFAULT_CONFIG,
      ...saved,
      rateLimit: { ...DEFAULT_CONFIG.rateLimit, ...(saved.rateLimit || {}) },
      ownerLids: saved.ownerLids || DEFAULT_CONFIG.ownerLids,
      targetGroupIds: saved.targetGroupIds || [],
      approvalGroupIds: saved.approvalGroupIds || [],
      exceptions: saved.exceptions || [],
      logs: saved.logs || []
    };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}

let config = loadConfig();
const adminAccess = new AdminAccess();
const commandConfig = new CommandConfig();

// MULTI_BLOCKED_GROUPS_PATCH
config.blockedGroupIds = Array.from(new Set([
  ...(Array.isArray(config.blockedGroupIds) ? config.blockedGroupIds : []),
  ...(config.blockedGroupId ? [config.blockedGroupId] : [])
].filter(Boolean)));
function saveBlockedGroupIds() {
  config.blockedGroupIds = Array.from(new Set((config.blockedGroupIds || []).filter(Boolean)));
  config.blockedGroupId = config.blockedGroupIds[0] || null;
  saveConfig();
}


function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function digits(value) {
  return String(value || '').replace(/\D/g, '').replace(/^00/, '');
}

function jidFromNumber(value) {
  const number = digits(value);
  return number ? `${number}@c.us` : null;
}

function personKey(value) {
  if (!value) return '';
  const raw = typeof value === 'string' ? value : value._serialized || value.user || '';
  return digits(raw);
}

function participantJid(participant) {
  return participant?.id?._serialized || participant?.id || null;
}

function addLog(action, details) {
  config.logs.push({ at: new Date().toISOString(), action, details });
  config.logs = config.logs.slice(-100);
  saveConfig();
  console.log(`[${action}] ${details}`);
}

const clientOptions = {
  authStrategy: new LocalAuth({ clientId: 'admin-bot', dataPath: path.join(RUNTIME_DIR, '.wwebjs_auth') }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
};
if (process.env.BOT_ELECTRON_HOST === '1' && global.__BOT_ELECTRON_TARGET) {
  clientOptions.electron = { window: global.__BOT_ELECTRON_TARGET };
}
const client = new Client(clientOptions);

const messageBuckets = new Map();
const dashboardGroupCache = new Map();
async function getKnownChats() {
  return Array.from(dashboardGroupCache.values()).map(group => ({
    isGroup: true,
    name: group.name || group.id,
    id: { _serialized: group.id },
    participants: []
  }));
}

const lockedGroups = new Map();
let maintenanceStarted = false;
const processedMessageIds = new Set();

async function isOwner(message) {
  return adminAccess.isAllowedMessage(message, config);
}

async function reply(message, text) {
  try {
    await message.reply(text);
  } catch (error) {
    console.error('Reply failed:', error.stack || error);
  }
}

async function getChatFromMessage(message, mustBeGroup = true) {
  const chat = await message.getChat();
  if (mustBeGroup && !chat.isGroup) {
    await reply(message, 'هذا الأمر يجب إرساله داخل جروب.');
    return null;
  }
  return chat;
}

function botId() {
  return client.info?.wid?._serialized || null;
}

async function isBotAdmin(chat) {
  const currentBotId = botId();
  if (!currentBotId || !chat?.participants) return false;
  const currentBotKey = personKey(currentBotId);

  return chat.participants.some(participant => {
    const id = participantJid(participant);
    return (id === currentBotId || personKey(id) === currentBotKey) &&
      Boolean(participant.isAdmin || participant.isSuperAdmin);
  });
}

function participantIds(chat) {
  return (chat.participants || []).map(participantJid).filter(Boolean);
}

function hasKey(set, id) {
  return set.has(personKey(id));
}

async function groupById(id) {
  if (!id) return null;
  try {
    const chat = await client.getChatById(id);
    return chat?.isGroup ? chat : null;
  } catch (error) {
    console.error(`Could not load group ${id}:`, error.stack || error);
    return null;
  }
}


async function blockedKeys() {
  const blocked = new Set();
  const groupIds = Array.from(new Set([
    ...(Array.isArray(config.blockedGroupIds) ? config.blockedGroupIds : []),
    ...(config.blockedGroupId ? [config.blockedGroupId] : [])
  ].filter(Boolean)));
  for (const groupId of groupIds) {
    try {
      const group = await groupById(groupId);
      if (!group) continue;
      for (const id of participantIds(group)) blocked.add(personKey(id));
    } catch (error) {
      console.error('Blacklist group skipped:', groupId, error.stack || error);
    }
  }
  return blocked;
}

async function allowedKeys() {
  const source = await groupById(config.allowGroupId);
  if (!source) return new Set();
  return new Set(participantIds(source).map(personKey));
}

function isException(id) {
  return config.exceptions.map(digits).includes(personKey(id));
}

async function lockGroup(chat, reason = 'manual') {
  const groupId = chat.id._serialized;
  if (lockedGroups.has(groupId)) return true;

  if (!(await isBotAdmin(chat))) {
    addLog('lock_skipped', `${chat.name}: bot is not admin`);
    console.error('[lock] skipped: bot is not admin in', chat.name || groupId);
    return false;
  }

  const success = await chat.setMessagesAdminsOnly(true);
  if (!success) {
    addLog('lock_failed', chat.name);
    console.error('[lock] setMessagesAdminsOnly returned false for', chat.name || groupId);
    return false;
  }

  addLog('locked', `${chat.name} (${reason})`);
  await chat.sendMessage('تم قفل الكتابة مؤقتًا بسبب نشاط مرتفع في الجروب.');

  const duration = Number(config.rateLimit.lockDurationMinutes || 5);
  if (duration > 0) {
    const timer = setTimeout(async () => {
      lockedGroups.delete(groupId);
      try {
        await chat.setMessagesAdminsOnly(false);
        addLog('unlocked', `${chat.name} (automatic)`);
        await chat.sendMessage('تم فتح الكتابة مرة أخرى.');
      } catch (error) {
        addLog('unlock_failed', `${chat.name}: ${error.message}`);
      }
    }, duration * 60 * 1000);
    timer.unref?.();
    lockedGroups.set(groupId, timer);
  }

  return true;
}

async function unlockGroup(chat) {
  const groupId = chat.id._serialized;
  if (!(await isBotAdmin(chat))) return false;

  const success = await chat.setMessagesAdminsOnly(false);
  if (success) {
    const timer = lockedGroups.get(groupId);
    if (timer) clearTimeout(timer);
    lockedGroups.delete(groupId);
    addLog('unlocked', `${chat.name} (manual)`);
  }
  return success;
}

async function observeRate(message) {
  if (
    !config.rateLimit.enabled ||
    typeof message.from !== 'string' ||
    !message.from.endsWith('@g.us')
  ) {
    return;
  }

  // WhatsApp can refresh a chat while events are arriving. Do not let that
  // background refresh block command processing.
  let chat = await message.getChat().catch(error => {
    console.error('Rate monitor message.getChat failed:', error.stack || error);
    return null;
  });
  if (!chat) {
    chat = await client.getChatById(message.from).catch(error => {
      console.error('Rate monitor getChatById failed:', error.stack || error);
      return null;
    });
  }
  if (!chat || !chat.isGroup) {
    console.error('Rate monitor skipped: group chat unavailable for', message.from);
    return;
  }

  const groupId = chat.id._serialized;
  const now = Date.now();
  const windowMs = Number(config.rateLimit.windowSeconds) * 1000;
  const previous = messageBuckets.get(groupId) || [];
  const current = previous.filter(time => now - time < windowMs);
  current.push(now);
  messageBuckets.set(groupId, current);

  const limit = Number(config.rateLimit.limit);
  if (current.length >= limit) {
    console.log('[rate] threshold reached:', current.length + '/' + limit, message.from);
    await lockGroup(chat, `rate ${current.length}/${config.rateLimit.windowSeconds}s`);
  }
}

async function syncBlocked(targetOnly = null) {
  const blocked = await blockedKeys();
  const targets = targetOnly ? [targetOnly] : config.targetGroupIds;
  const result = { scanned: 0, removed: 0, wouldRemove: 0 };

  if (!config.blockedGroupId) return result;

  for (const targetId of targets) {
    const target = await groupById(targetId);
    if (!target) continue;
    result.scanned++;

    const adminKeys = new Set(
      (target.participants || [])
        .filter(person => person && (person.isAdmin || person.isSuperAdmin))
        .map(person => personKey(person.id || person))
    );

    const victims = participantIds(target).filter(id => {
      const key = personKey(id);
      const isBot = key === personKey(botId());
      const isAdmin = adminKeys.has(key);
      return !isBot && !isAdmin && !isException(id) && hasKey(blocked, id);
    });

    if (!victims.length) continue;

    if (config.dryRun) {
      result.wouldRemove += victims.length;
      addLog('dry_run_remove', `${target.name}: ${victims.join(', ')}`);
      continue;
    }

    if (!(await isBotAdmin(target))) {
      addLog('remove_skipped', `${target.name}: bot is not admin`);
      continue;
    }

    await target.removeParticipants(victims);
    result.removed += victims.length;
    addLog('removed_blocked', `${target.name}: ${victims.join(', ')}`);
  }

  return result;
}

async function clearGroup(chat) {
  const result = { total: 0, removed: 0, wouldRemove: 0, kept: 0 };
  if (!chat) return result;
  const ownerKey = digits(config.ownerNumber);
  const botKey = personKey(botId());
  const ownerLids = (config.ownerLids || []).map(digits);
  const adminKeys = new Set(
    (chat.participants || [])
      .filter(person => person && (person.isAdmin || person.isSuperAdmin))
      .map(person => personKey(person.id || person))
  );
  const all = participantIds(chat);
  result.total = all.length;
  const victims = all.filter(id => {
    const key = personKey(id);
    if (key === botKey) return false;
    if (ownerKey && key === ownerKey) return false;
    if (ownerLids.includes(key)) return false;
    if (adminKeys.has(key)) return false;
    return true;
  });
  result.kept = result.total - victims.length;
  if (!victims.length) return result;

  if (config.dryRun) {
    result.wouldRemove = victims.length;
    addLog('dry_run_clear_group', `${chat.name}: ${victims.length} member(s)`);
    return result;
  }

  if (!(await isBotAdmin(chat))) {
    addLog('clear_group_skipped', `${chat.name}: bot is not admin`);
    return result;
  }

  for (let i = 0; i < victims.length; i += 25) {
    const batch = victims.slice(i, i + 25);
    try {
      await chat.removeParticipants(batch);
      result.removed += batch.length;
    } catch (error) {
      addLog('clear_group_error', `${chat.name}: ${error.message}`);
    }
  }
  addLog('cleared_group', `${chat.name}: removed ${result.removed}/${result.total}`);
  return result;
}

function requestJid(request) {
  const raw = request?.requesterId || request?.id || request?.requester;
  if (!raw) return null;
  return typeof raw === 'string' ? raw : raw._serialized || raw.user || null;
}

async function processMembershipRequests({ onlyBlocked = false } = {}) {
  const blocked = await blockedKeys();
  const allowed = await allowedKeys();
  const result = { approved: 0, rejected: 0, wouldApprove: 0, wouldReject: 0 };

  for (const groupId of config.approvalGroupIds) {
    const group = await groupById(groupId);
    if (!group) continue;

    const requests = await group.getGroupMembershipRequests();
    for (const request of requests) {
      const requester = requestJid(request);
      if (!requester) continue;

      const blockedUser = hasKey(blocked, requester);
      const notAllowed = config.approvalMode === 'allowlist' && !hasKey(allowed, requester);
      const shouldReject = blockedUser || (!onlyBlocked && notAllowed);

      if (onlyBlocked && !blockedUser) continue;

      if (config.dryRun) {
        if (shouldReject) result.wouldReject++;
        else result.wouldApprove++;
        addLog(
          shouldReject ? 'dry_run_reject_request' : 'dry_run_approve_request',
          `${group.name}: ${requester}`
        );
        continue;
      }

      if (!(await isBotAdmin(group))) {
        addLog('approval_skipped', `${group.name}: bot is not admin`);
        continue;
      }

      if (shouldReject) {
        await group.rejectGroupMembershipRequests({ requesterIds: requester });
        result.rejected++;
        addLog('rejected_request', `${group.name}: ${requester}`);
      } else {
        await group.approveGroupMembershipRequests({ requesterIds: requester });
        result.approved++;
        addLog('approved_request', `${group.name}: ${requester}`);
      }
    }
  }

  return result;
}

async function resolvePeople(message, args) {
  try {
    const mentions = await message.getMentions();
    if (mentions.length) return mentions.map(contact => contact.id._serialized);
  } catch {}

  return args.slice(1)
    .map(value => jidFromNumber(value.replace(/[^0-9+]/g, '')))
    .filter(Boolean);
}

function helpText(authorization) {
  const prefix = commandConfig.prefix();
  const full = `Commands:

General:
${prefix}help  ${prefix}ping  ${prefix}status  ${prefix}groups  ${prefix}logs  ${prefix}group-info

Group:
${prefix}lock  ${prefix}unlock  ${prefix}lock-duration 5
${prefix}rate-limit 25 60  |  ${prefix}rate-limit off
${prefix}clear-group تأكيد

Blocked members:
${prefix}add-blocked-group  ${prefix}remove-blocked-group
${prefix}sync-blocked  ${prefix}auto-sync on|off
${prefix}check-number 201234567890
${prefix}exception-add 201234567890
${prefix}exception-remove 201234567890
${prefix}dry-run on|off

Membership requests:
${prefix}set-approval-group  ${prefix}set-allow-group
${prefix}approval-on  ${prefix}approval-off
${prefix}approval-mode blacklist|allowlist
${prefix}approve-pending  ${prefix}reject-blocked

Members:
${prefix}scan-group  ${prefix}member-check 201234567890
${prefix}remove 201234567890  ${prefix}promote 201234567890  ${prefix}demote 201234567890`;
  const roleCommands = authorization.type === 'member'
    ? adminAccess.reload().members.allowedCommands
    : [...(authorization.role.allowedCommands || []), ...(authorization.admin.allowedCommands || [])];
  if (roleCommands.includes('*')) return full;
  const denied = new Set((authorization.admin?.deniedCommands || []).map(value => String(value).replace(/^!/, '')));
  const available = [...new Set(roleCommands)]
    .map(value => String(value).replace(/^!/, ''))
    .filter(value => value && !denied.has(value) && commandConfig.isEnabled(value));
  return `Available commands:

${available.map(value => `${prefix}${value}`).join('  ') || 'No commands are available for this account.'}`;
}

async function handleCommand(message) {
  const body = String(message.body || '').trim();
  const prefix = commandConfig.prefix();
  if (!body.startsWith(prefix)) return;

  const args = body.split(/\s+/);
  const requested = args[0].slice(prefix.length);
  const resolved = commandConfig.resolve(requested);
  if (!resolved) return reply(message, commandConfig.globalReply('unknownCommandReply', `Unknown command. Use ${prefix}help.`));
  if (!commandConfig.isEnabled(resolved)) return reply(message, commandConfig.globalReply('disabledReply', 'This command is currently disabled.'));
  const authorization = await adminAccess.authorizeMessage(message, resolved, config);
  if (!authorization.allowed) return reply(message, commandConfig.globalReply('forbiddenReply', 'You do not have permission to use this command.'));
  const command = `!${resolved}`;
  const respond = (text, values) => reply(message, commandConfig.replyFor(resolved, text, values));

  try {
    switch (command) {
      case '!help':
        return respond(helpText(authorization));
      case '!ping':
        return respond( 'pong - البوت يعمل.');
      case '!status':
        return respond( `الحالة:
المالك: ${config.ownerNumber}
Dry-run: ${config.dryRun ? 'ON' : 'OFF'}
الموافقة: ${config.approvalEnabled ? 'ON' : 'OFF'}
وضع الموافقة: ${config.approvalMode}
المزامنة التلقائية: ${config.autoSyncEnabled ? 'ON' : 'OFF'}
حد الرسائل: ${config.rateLimit.enabled ? `${config.rateLimit.limit}/${config.rateLimit.windowSeconds}s` : 'OFF'}
الجروبات المستهدفة: ${config.targetGroupIds.length}`);
      case '!groups': {
        const chats = (await getKnownChats()).filter(chat => chat.isGroup);
        return respond(
          chats.map((chat, i) => `${i + 1}. ${chat.name}\n${chat.id._serialized}`).join('\n\n') || 'لا توجد جروبات.'
        );
      }
      case '!logs':
        return respond(
          config.logs.slice(-15).map(item => `${item.at} | ${item.action} | ${item.details}`).join('\n') || 'لا توجد سجلات.'
        );
      case '!group-info': {
        const chat = await getChatFromMessage(message);
        if (!chat) return;
        return respond( `${chat.name}\nID: ${chat.id._serialized}\nالأعضاء: ${chat.participants.length}\nالبوت Admin: ${await isBotAdmin(chat) ? 'نعم' : 'لا'}`);
      }
      case '!dry-run':
        if (!args[1]) return respond( `Dry-run: ${config.dryRun ? 'ON' : 'OFF'}`);
        config.dryRun = args[1].toLowerCase() === 'on';
        saveConfig();
        return respond( `Dry-run أصبح ${config.dryRun ? 'ON' : 'OFF'}.`);
      case '!set-blocked-group':
      case '!add-blocked-group': {
        const groupId = typeof message.from === 'string' && message.from.endsWith('@g.us') ? message.from : null;
        if (!groupId) return respond( 'استخدم الأمر من داخل جروب.');
        if (!config.blockedGroupIds.includes(groupId)) config.blockedGroupIds.push(groupId);
        saveBlockedGroupIds();
        return respond( 'تمت إضافة هذا الجروب للبلاك ليست. عدد الجروبات: ' + config.blockedGroupIds.length);
      }
      case '!remove-blocked-group': {
        const groupId = typeof message.from === 'string' && message.from.endsWith('@g.us') ? message.from : null;
        if (!groupId) return respond( 'استخدم الأمر من داخل جروب.');
        config.blockedGroupIds = config.blockedGroupIds.filter(id => id !== groupId);
        saveBlockedGroupIds();
        return respond( 'تمت إزالة هذا الجروب من البلاك ليست. المتبقي: ' + config.blockedGroupIds.length);
      }
      case '!list-blocked-groups':
        return respond( config.blockedGroupIds.length ? config.blockedGroupIds.map((id, i) => (i + 1) + '. ' + id).join('\n') : 'لا توجد جروبات بلاك ليست.');
      case '!clear-blocked-groups':
        config.blockedGroupIds = [];
        saveBlockedGroupIds();
        return respond( 'تم تصفير جروبات البلاك ليست.');
      case '!add-target': {
        const chat = await getChatFromMessage(message);
        if (!chat) return;
        if (!config.targetGroupIds.includes(chat.id._serialized)) config.targetGroupIds.push(chat.id._serialized);
        saveConfig();
        return respond( `تمت إضافة ${chat.name} للجروبات المستهدفة.`);
      }
      case '!remove-target': {
        const chat = await getChatFromMessage(message);
        if (!chat) return;
        config.targetGroupIds = config.targetGroupIds.filter(id => id !== chat.id._serialized);
        saveConfig();
        return respond( `تم حذف ${chat.name} من الجروبات المستهدفة.`);
      }
      case '!set-approval-group': {
        const chat = await getChatFromMessage(message);
        if (!chat) return;
        if (!config.approvalGroupIds.includes(chat.id._serialized)) config.approvalGroupIds.push(chat.id._serialized);
        saveConfig();
        return respond( `تم تحديد ${chat.name} لجروب طلبات الانضمام.`);
      }
      case '!set-allow-group': {
        const chat = await getChatFromMessage(message);
        if (!chat) return;
        config.allowGroupId = chat.id._serialized;
        saveConfig();
        return respond( `تم تحديد ${chat.name} كمصدر لقائمة السماح.`);
      }
      case '!sync-blocked': {
        const result = await syncBlocked();
        return respond( `اكتمل الفحص. تم فحص ${result.scanned} جروب. تمت إزالة ${result.removed}. المتوقّع في dry-run: ${result.wouldRemove}.`);
      }
      case '!auto-sync':
        config.autoSyncEnabled = args[1]?.toLowerCase() === 'on';
        saveConfig();
        return respond( `المزامنة التلقائية أصبحت ${config.autoSyncEnabled ? 'ON' : 'OFF'}.`);
      case '!check-number': {
        const number = args[1];
        if (!number) return respond( 'اكتب الرقم بعد الأمر.');
        const blocked = await blockedKeys();
        return respond( hasKey(blocked, jidFromNumber(number)) ? 'الرقم موجود في قائمة المحظورين.' : 'الرقم غير موجود في قائمة المحظورين.');
      }
      case '!exception-add':
        if (!args[1]) return respond( 'اكتب الرقم بعد الأمر.');
        if (!config.exceptions.includes(digits(args[1]))) config.exceptions.push(digits(args[1]));
        saveConfig();
        return respond( 'تمت إضافة الرقم للاستثناءات.');
      case '!exception-remove':
        config.exceptions = config.exceptions.filter(number => number !== digits(args[1]));
        saveConfig();
        return respond( 'تم حذف الرقم من الاستثناءات.');
      case '!lock': {
        const chat = await getChatFromMessage(message);
        if (!chat) return;
        if (config.dryRun) return respond( 'Dry-run مفعّل؛ لم يتم القفل فعليًا.');
        return respond( await lockGroup(chat, 'manual') ? 'تم قفل الجروب.' : 'تعذر قفل الجروب.');
      }
      case '!unlock': {
        const chat = await getChatFromMessage(message);
        if (!chat) return;
        if (config.dryRun) return respond( 'Dry-run مفعّل؛ لم يتم الفتح فعليًا.');
        return respond( await unlockGroup(chat) ? 'تم فتح الجروب.' : 'تعذر فتح الجروب.');
      }
      case '!lock-duration':
        if (!Number(args[1])) return respond( `المدة الحالية: ${config.rateLimit.lockDurationMinutes} دقيقة.`);
        config.rateLimit.lockDurationMinutes = Number(args[1]);
        saveConfig();
        return respond( `تم تحديد مدة القفل إلى ${args[1]} دقيقة.`);
      case '!rate-limit':
        if (args[1]?.toLowerCase() === 'off') {
          config.rateLimit.enabled = false;
        } else {
          config.rateLimit.enabled = true;
          config.rateLimit.limit = Number(args[1]) || 25;
          config.rateLimit.windowSeconds = Number(args[2]) || 60;
        }
        saveConfig();
        return respond( config.rateLimit.enabled ? `تم ضبط الحد إلى ${config.rateLimit.limit} رسالة خلال ${config.rateLimit.windowSeconds} ثانية.` : 'تم إيقاف حد السرعة.');
      case '!approval-on':
        config.approvalEnabled = true;
        saveConfig();
        return respond( 'تم تشغيل الموافقة التلقائية.');
      case '!approval-off':
        config.approvalEnabled = false;
        saveConfig();
        return respond( 'تم إيقاف الموافقة التلقائية.');
      case '!approval-mode':
        if (!['blacklist', 'allowlist'].includes(args[1])) return respond( 'استخدم blacklist أو allowlist.');
        config.approvalMode = args[1];
        saveConfig();
        return respond( `وضع الموافقة: ${config.approvalMode}.`);
      case '!approve-pending': {
        const result = await processMembershipRequests();
        return respond( `طلبات الموافقة: تم قبول ${result.approved}. في dry-run: ${result.wouldApprove}. تم رفض ${result.rejected}.`);
      }
      case '!reject-blocked': {
        const result = await processMembershipRequests({ onlyBlocked: true });
        return respond( `تم رفض ${result.rejected} طلب. في dry-run: ${result.wouldReject}.`);
      }
      case '!scan-group': {
        const chat = await getChatFromMessage(message);
        if (!chat) return;
        const result = await syncBlocked(chat.id._serialized);
        return respond( `تم فحص ${chat.name}. تمت إزالة ${result.removed}. في dry-run: ${result.wouldRemove}.`);
      }
      case '!member-check':
      case '!check-member': {
        const number = args[1];
        const chat = await getChatFromMessage(message);
        if (!chat || !number) return;
        const found = participantIds(chat).some(id => personKey(id) === digits(number));
        return respond( found ? 'العضو موجود في الجروب.' : 'العضو غير موجود في الجروب.');
      }
      case '!clear-group':
      case '!purge-group': {
        const chat = await getChatFromMessage(message);
        if (!chat) return;
        if (!(await isBotAdmin(chat))) return respond( 'رقم البوت ليس Admin في هذا الجروب.');
        if ((args[1] || '') !== 'تأكيد') {
          return respond( `⚠️ سيتم طرد كل الأعضاء (عدا الأدمن والمالك والبوت) من "${chat.name}".\nعدد الأعضاء الحاليين: ${chat.participants.length}\nللتأكيد اكتب:\n!clear-group تأكيد`);
        }
        const result = await clearGroup(chat);
        if (config.dryRun) return respond( `Dry-run مفعّل؛ المتوقّع طرده: ${result.wouldRemove} من ${result.total}. لم يتم تنفيذ شيء فعليًا.`);
        return respond( `تم تصفية الجروب. تم طرد ${result.removed} من ${result.total}. تم الإبقاء على ${result.kept} (أدمن/مالك/بوت).`);
      }
      case '!remove':
      case '!promote':
      case '!demote': {
        const chat = await getChatFromMessage(message);
        if (!chat) return;
        const people = await resolvePeople(message, args);
        if (!people.length) return respond( 'اذكر العضو أو اكتب الرقم بعد الأمر.');
        if (!(await isBotAdmin(chat))) return respond( 'رقم البوت ليس Admin في هذا الجروب.');
        if (config.dryRun) return respond( 'Dry-run مفعّل؛ لم يتم تنفيذ العملية.');
        if (command === '!remove') await chat.removeParticipants(people);
        if (command === '!promote') await chat.promoteParticipants(people);
        if (command === '!demote') await chat.demoteParticipants(people);
        addLog(command.slice(1), `${chat.name}: ${people.join(', ')}`);
        return respond( 'تم تنفيذ العملية.');
      }
      default:
        return respond( 'أمر غير معروف. استخدم !help.');
    }
  } catch (error) {
    console.error('Command error:', error.stack || error);
    await respond( `حدث خطأ: ${error.message}`);
  }
}

client.on('qr', qr => {
  desktopEvent('qr', { value: qr });
  console.log('امسح QR من رقم البوت:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  desktopEvent('ready');
  console.log('WhatsApp Admin Bot جاهز.');
  if (maintenanceStarted) return;
  maintenanceStarted = true;

  setInterval(async () => {
    try {
      if (config.approvalEnabled) await processMembershipRequests();
      if (config.autoSyncEnabled) await syncBlocked();
    } catch (error) {
      console.error('Maintenance error:', error.stack || error);
    }
  }, 60 * 1000);
});

client.on('auth_failure', message => {
  desktopEvent('auth-failure', { message: String(message) });
  console.error('Auth failure:', message);
});
client.on('disconnected', reason => {
  desktopEvent('disconnected', { reason: String(reason) });
  console.log('Disconnected:', reason);
});

async function processIncomingMessage(message) {
  if (typeof message.from === 'string' && message.from.endsWith('@g.us')) {
    dashboardGroupCache.set(message.from, { id: message.from, name: message.from, participants: null });
    try {
      const group = await message.getChat();
      if (group && group.isGroup) dashboardGroupCache.set(group.id._serialized, { id: group.id._serialized, name: group.name, participants: group.participants ? group.participants.length : null });
    } catch (_) {}
  }
  const messageId = message.id?._serialized;
  if (messageId && processedMessageIds.has(messageId)) return;
  if (messageId) {
    processedMessageIds.add(messageId);
    setTimeout(() => processedMessageIds.delete(messageId), 60 * 1000).unref?.();
  }

  console.log(`[incoming] from=${message.from || ''} author=${message.author || ''} body=${JSON.stringify(message.body || '')}`);

  // Commands run first. A WhatsApp chat refresh must not block !ping.
  try {
    await handleCommand(message);
  } catch (error) {
    console.error('Command handler error:', error.stack || error);
  }

  // Rate monitoring is isolated from command handling.
  try {
    await observeRate(message);
  } catch (error) {
    console.error('Rate monitor error:', error.stack || error);
  }
}

// Use one event only to avoid duplicate replies.
client.on('message', processIncomingMessage);

const runtime = new RuntimeManager(client, {
  ownerChatId: () => jidFromNumber(config.ownerNumber)
});

saveConfig();
client.initialize().catch(error => {
  runtime.recordError(error);
  console.error('Initialization failed:', error.stack || error);
  runtime.scheduleReconnect();
});

// WA_COMPAT_SERIALIZED_PATCH
// Temporary compatibility patch for WhatsApp Web changing MsgKey._serialized to MsgKey.$1.
async function installWhatsAppCompatibilityPatch() {
  try {
    if (!client.pupPage) return;
    await client.pupPage.evaluate(() => {
      const prototype = window.Store && window.Store.MsgKey && window.Store.MsgKey.prototype;
      if (prototype && !Object.prototype.hasOwnProperty.call(prototype, '_serialized')) {
        Object.defineProperty(prototype, '_serialized', {
          configurable: true,
          get() { return this.$1; }
        });
      }
    });
    console.log('WhatsApp compatibility patch installed.');
  } catch (error) {
    console.error('WhatsApp compatibility patch failed:', error.stack || error);
  }
}
client.on('ready', installWhatsAppCompatibilityPatch);



// LOCAL_DASHBOARD_BRIDGE
startAdminDashboard({
  client,
  getConfig: () => config,
  saveConfig,
  saveBlockedGroupIds,
  dashboardGroupCache,
  syncBlocked,
  processMembershipRequests,
  clearGroup,
  groupById,
  runtime
});
