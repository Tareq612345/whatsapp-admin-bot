const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const CONFIG_PATH = path.join(__dirname, 'config.json');
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

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'admin-bot' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

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
  const owner = digits(config.ownerNumber);
  const ownerJid = jidFromNumber(config.ownerNumber);
  const senderIds = [message.author, message.from].filter(Boolean);

  const ownerLids = (config.ownerLids || []).map(digits);
  if (message.from === ownerJid) return true;
  if (senderIds.some(id => personKey(id) === owner)) return true;
  if (senderIds.some(id => ownerLids.includes(personKey(id)))) return true;

  // This fallback helps with group messages where WhatsApp uses a LID.
  try {
    const contact = await message.getContact();
    return digits(contact.number) === owner;
  } catch {
    return false;
  }
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

function helpText() {
  return `أوامر المالك فقط:

عام:
!help  !ping  !status  !groups  !logs  !group-info

الجروب:
!lock  !unlock  !lock-duration 5
!rate-limit 25 60  |  !rate-limit off

المحظورون:
!set-blocked-group  !add-target  !remove-target
!sync-blocked  !auto-sync on|off
!check-number 201234567890
!exception-add 201234567890
!exception-remove 201234567890
!dry-run on|off

طلبات الانضمام:
!set-approval-group  !set-allow-group
!approval-on  !approval-off
!approval-mode blacklist|allowlist
!approve-pending  !reject-blocked

الأعضاء:
!scan-group  !member-check 201234567890
!remove 201234567890  !promote 201234567890  !demote 201234567890`;
}

async function handleCommand(message) {
  if (!(await isOwner(message))) return;

  const body = String(message.body || '').trim();
  if (!body.startsWith('!')) return;

  const args = body.split(/\s+/);
  const command = args[0].toLowerCase();

  try {
    switch (command) {
      case '!help':
        return reply(message, helpText());
      case '!ping':
        return reply(message, 'pong - البوت يعمل.');
      case '!status':
        return reply(message, `الحالة:
المالك: ${config.ownerNumber}
Dry-run: ${config.dryRun ? 'ON' : 'OFF'}
الموافقة: ${config.approvalEnabled ? 'ON' : 'OFF'}
وضع الموافقة: ${config.approvalMode}
المزامنة التلقائية: ${config.autoSyncEnabled ? 'ON' : 'OFF'}
حد الرسائل: ${config.rateLimit.enabled ? `${config.rateLimit.limit}/${config.rateLimit.windowSeconds}s` : 'OFF'}
الجروبات المستهدفة: ${config.targetGroupIds.length}`);
      case '!groups': {
        const chats = (await getKnownChats()).filter(chat => chat.isGroup);
        return reply(
          message,
          chats.map((chat, i) => `${i + 1}. ${chat.name}\n${chat.id._serialized}`).join('\n\n') || 'لا توجد جروبات.'
        );
      }
      case '!logs':
        return reply(
          message,
          config.logs.slice(-15).map(item => `${item.at} | ${item.action} | ${item.details}`).join('\n') || 'لا توجد سجلات.'
        );
      case '!group-info': {
        const chat = await getChatFromMessage(message);
        if (!chat) return;
        return reply(message, `${chat.name}\nID: ${chat.id._serialized}\nالأعضاء: ${chat.participants.length}\nالبوت Admin: ${await isBotAdmin(chat) ? 'نعم' : 'لا'}`);
      }
      case '!dry-run':
        if (!args[1]) return reply(message, `Dry-run: ${config.dryRun ? 'ON' : 'OFF'}`);
        config.dryRun = args[1].toLowerCase() === 'on';
        saveConfig();
        return reply(message, `Dry-run أصبح ${config.dryRun ? 'ON' : 'OFF'}.`);
      case '!set-blocked-group':
      case '!add-blocked-group': {
        const groupId = typeof message.from === 'string' && message.from.endsWith('@g.us') ? message.from : null;
        if (!groupId) return reply(message, 'استخدم الأمر من داخل جروب.');
        if (!config.blockedGroupIds.includes(groupId)) config.blockedGroupIds.push(groupId);
        saveBlockedGroupIds();
        return reply(message, 'تمت إضافة هذا الجروب للبلاك ليست. عدد الجروبات: ' + config.blockedGroupIds.length);
      }
      case '!remove-blocked-group': {
        const groupId = typeof message.from === 'string' && message.from.endsWith('@g.us') ? message.from : null;
        if (!groupId) return reply(message, 'استخدم الأمر من داخل جروب.');
        config.blockedGroupIds = config.blockedGroupIds.filter(id => id !== groupId);
        saveBlockedGroupIds();
        return reply(message, 'تمت إزالة هذا الجروب من البلاك ليست. المتبقي: ' + config.blockedGroupIds.length);
      }
      case '!list-blocked-groups':
        return reply(message, config.blockedGroupIds.length ? config.blockedGroupIds.map((id, i) => (i + 1) + '. ' + id).join('\n') : 'لا توجد جروبات بلاك ليست.');
      case '!clear-blocked-groups':
        config.blockedGroupIds = [];
        saveBlockedGroupIds();
        return reply(message, 'تم تصفير جروبات البلاك ليست.');
      case '!add-target': {
        const chat = await getChatFromMessage(message);
        if (!chat) return;
        if (!config.targetGroupIds.includes(chat.id._serialized)) config.targetGroupIds.push(chat.id._serialized);
        saveConfig();
        return reply(message, `تمت إضافة ${chat.name} للجروبات المستهدفة.`);
      }
      case '!remove-target': {
        const chat = await getChatFromMessage(message);
        if (!chat) return;
        config.targetGroupIds = config.targetGroupIds.filter(id => id !== chat.id._serialized);
        saveConfig();
        return reply(message, `تم حذف ${chat.name} من الجروبات المستهدفة.`);
      }
      case '!set-approval-group': {
        const chat = await getChatFromMessage(message);
        if (!chat) return;
        if (!config.approvalGroupIds.includes(chat.id._serialized)) config.approvalGroupIds.push(chat.id._serialized);
        saveConfig();
        return reply(message, `تم تحديد ${chat.name} لجروب طلبات الانضمام.`);
      }
      case '!set-allow-group': {
        const chat = await getChatFromMessage(message);
        if (!chat) return;
        config.allowGroupId = chat.id._serialized;
        saveConfig();
        return reply(message, `تم تحديد ${chat.name} كمصدر لقائمة السماح.`);
      }
      case '!sync-blocked': {
        const result = await syncBlocked();
        return reply(message, `اكتمل الفحص. تم فحص ${result.scanned} جروب. تمت إزالة ${result.removed}. المتوقّع في dry-run: ${result.wouldRemove}.`);
      }
      case '!auto-sync':
        config.autoSyncEnabled = args[1]?.toLowerCase() === 'on';
        saveConfig();
        return reply(message, `المزامنة التلقائية أصبحت ${config.autoSyncEnabled ? 'ON' : 'OFF'}.`);
      case '!check-number': {
        const number = args[1];
        if (!number) return reply(message, 'اكتب الرقم بعد الأمر.');
        const blocked = await blockedKeys();
        return reply(message, hasKey(blocked, jidFromNumber(number)) ? 'الرقم موجود في قائمة المحظورين.' : 'الرقم غير موجود في قائمة المحظورين.');
      }
      case '!exception-add':
        if (!args[1]) return reply(message, 'اكتب الرقم بعد الأمر.');
        if (!config.exceptions.includes(digits(args[1]))) config.exceptions.push(digits(args[1]));
        saveConfig();
        return reply(message, 'تمت إضافة الرقم للاستثناءات.');
      case '!exception-remove':
        config.exceptions = config.exceptions.filter(number => number !== digits(args[1]));
        saveConfig();
        return reply(message, 'تم حذف الرقم من الاستثناءات.');
      case '!lock': {
        const chat = await getChatFromMessage(message);
        if (!chat) return;
        if (config.dryRun) return reply(message, 'Dry-run مفعّل؛ لم يتم القفل فعليًا.');
        return reply(message, await lockGroup(chat, 'manual') ? 'تم قفل الجروب.' : 'تعذر قفل الجروب.');
      }
      case '!unlock': {
        const chat = await getChatFromMessage(message);
        if (!chat) return;
        if (config.dryRun) return reply(message, 'Dry-run مفعّل؛ لم يتم الفتح فعليًا.');
        return reply(message, await unlockGroup(chat) ? 'تم فتح الجروب.' : 'تعذر فتح الجروب.');
      }
      case '!lock-duration':
        if (!Number(args[1])) return reply(message, `المدة الحالية: ${config.rateLimit.lockDurationMinutes} دقيقة.`);
        config.rateLimit.lockDurationMinutes = Number(args[1]);
        saveConfig();
        return reply(message, `تم تحديد مدة القفل إلى ${args[1]} دقيقة.`);
      case '!rate-limit':
        if (args[1]?.toLowerCase() === 'off') {
          config.rateLimit.enabled = false;
        } else {
          config.rateLimit.enabled = true;
          config.rateLimit.limit = Number(args[1]) || 25;
          config.rateLimit.windowSeconds = Number(args[2]) || 60;
        }
        saveConfig();
        return reply(message, config.rateLimit.enabled ? `تم ضبط الحد إلى ${config.rateLimit.limit} رسالة خلال ${config.rateLimit.windowSeconds} ثانية.` : 'تم إيقاف حد السرعة.');
      case '!approval-on':
        config.approvalEnabled = true;
        saveConfig();
        return reply(message, 'تم تشغيل الموافقة التلقائية.');
      case '!approval-off':
        config.approvalEnabled = false;
        saveConfig();
        return reply(message, 'تم إيقاف الموافقة التلقائية.');
      case '!approval-mode':
        if (!['blacklist', 'allowlist'].includes(args[1])) return reply(message, 'استخدم blacklist أو allowlist.');
        config.approvalMode = args[1];
        saveConfig();
        return reply(message, `وضع الموافقة: ${config.approvalMode}.`);
      case '!approve-pending': {
        const result = await processMembershipRequests();
        return reply(message, `طلبات الموافقة: تم قبول ${result.approved}. في dry-run: ${result.wouldApprove}. تم رفض ${result.rejected}.`);
      }
      case '!reject-blocked': {
        const result = await processMembershipRequests({ onlyBlocked: true });
        return reply(message, `تم رفض ${result.rejected} طلب. في dry-run: ${result.wouldReject}.`);
      }
      case '!scan-group': {
        const chat = await getChatFromMessage(message);
        if (!chat) return;
        const result = await syncBlocked(chat.id._serialized);
        return reply(message, `تم فحص ${chat.name}. تمت إزالة ${result.removed}. في dry-run: ${result.wouldRemove}.`);
      }
      case '!member-check':
      case '!check-member': {
        const number = args[1];
        const chat = await getChatFromMessage(message);
        if (!chat || !number) return;
        const found = participantIds(chat).some(id => personKey(id) === digits(number));
        return reply(message, found ? 'العضو موجود في الجروب.' : 'العضو غير موجود في الجروب.');
      }
      case '!remove':
      case '!promote':
      case '!demote': {
        const chat = await getChatFromMessage(message);
        if (!chat) return;
        const people = await resolvePeople(message, args);
        if (!people.length) return reply(message, 'اذكر العضو أو اكتب الرقم بعد الأمر.');
        if (!(await isBotAdmin(chat))) return reply(message, 'رقم البوت ليس Admin في هذا الجروب.');
        if (config.dryRun) return reply(message, 'Dry-run مفعّل؛ لم يتم تنفيذ العملية.');
        if (command === '!remove') await chat.removeParticipants(people);
        if (command === '!promote') await chat.promoteParticipants(people);
        if (command === '!demote') await chat.demoteParticipants(people);
        addLog(command.slice(1), `${chat.name}: ${people.join(', ')}`);
        return reply(message, 'تم تنفيذ العملية.');
      }
      default:
        return reply(message, 'أمر غير معروف. استخدم !help.');
    }
  } catch (error) {
    console.error('Command error:', error.stack || error);
    await reply(message, `حدث خطأ: ${error.message}`);
  }
}

client.on('qr', qr => {
  console.log('امسح QR من رقم البوت:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
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

client.on('auth_failure', message => console.error('Auth failure:', message));
client.on('disconnected', reason => console.log('Disconnected:', reason));

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

saveConfig();
client.initialize();

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
function startLocalDashboard() {
  const path = require('path');
  const dashboardPath = path.join(__dirname, 'dashboard.html');
  const http = require('http');
  const { URL } = require('url');
  const send = (res, code, data) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };
  const body = req => new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 100000) reject(new Error('Request too large')); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
  const groups = async () => {
    const ids = [config.blockedGroupId, config.allowGroupId, ...(config.targetGroupIds || []), ...(config.approvalGroupIds || [])].filter(Boolean);
    for (const id of ids) {
      if (!dashboardGroupCache.has(id)) dashboardGroupCache.set(id, { id, name: 'جروب محفوظ', participants: null });
    }
    return Array.from(dashboardGroupCache.values());
  };
  const action = async data => {
    if (data.action === 'dryRun') { config.dryRun = !!data.value; saveConfig(); return 'تم تحديث Dry-run'; }
    if (data.action === 'rateEnabled') { config.rateLimit.enabled = !!data.value; saveConfig(); return 'تم تحديث مراقبة السرعة'; }
    if (data.action === 'approvalEnabled') { config.approvalEnabled = !!data.value; saveConfig(); return 'تم تحديث الموافقة التلقائية'; }
    if (data.action === 'autoSync') { config.autoSyncEnabled = !!data.value; saveConfig(); return 'تم تحديث المزامنة التلقائية'; }
    if (data.action === 'settings') { config.rateLimit.limit = Math.max(1, Number(data.limit) || 25); config.rateLimit.windowSeconds = Math.max(5, Number(data.windowSeconds) || 60); config.rateLimit.lockDurationMinutes = Math.max(0, Number(data.lockDurationMinutes) || 5); if (['blacklist','allowlist'].includes(data.approvalMode)) config.approvalMode = data.approvalMode; saveConfig(); return 'تم حفظ الإعدادات'; }
    if (data.action === 'setBlockedGroup') { if (data.groupId && !config.blockedGroupIds.includes(data.groupId)) config.blockedGroupIds.push(data.groupId); saveBlockedGroupIds(); return 'تمت إضافة جروب محظورين'; }
    if (data.action === 'setAllowGroup') { config.allowGroupId = data.groupId || null; saveConfig(); return 'تم تحديد جروب السماح'; }
    if (data.action === 'setApprovalGroup') { if (data.groupId && !config.approvalGroupIds.includes(data.groupId)) config.approvalGroupIds.push(data.groupId); saveConfig(); return 'تم تحديد جروب الطلبات'; }
    if (data.action === 'addTarget') { if (data.groupId && !config.targetGroupIds.includes(data.groupId)) config.targetGroupIds.push(data.groupId); saveConfig(); return 'تمت إضافة الجروب للمراقبة'; }
    if (data.action === 'removeTarget') { config.targetGroupIds = config.targetGroupIds.filter(id => id !== data.groupId); saveConfig(); return 'تمت إزالة الجروب من المراقبة'; }
    if (data.action === 'syncBlocked') { const r = await syncBlocked(); return 'اكتمل الفحص: ' + r.removed + ' إزالة، ' + r.wouldRemove + ' في Dry-run'; }
    if (data.action === 'approvePending') { const r = await processMembershipRequests(); return 'الطلبات: ' + r.approved + ' قبول، ' + r.rejected + ' رفض'; }
    if (data.action === 'rejectBlocked') { const r = await processMembershipRequests({ onlyBlocked: true }); return 'تم رفض ' + r.rejected + ' طلب محظور'; }
    throw new Error('إجراء غير معروف');
  };
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/dashboard.html')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(dashboardPath)); }
      if (req.method === 'GET' && u.pathname === '/api/status') return send(res, 200, { ready: !!(client.info && client.info.wid), ownerNumber: config.ownerNumber, dryRun: config.dryRun, approvalEnabled: config.approvalEnabled, approvalMode: config.approvalMode, autoSyncEnabled: config.autoSyncEnabled, targetCount: config.targetGroupIds.length, rateLimit: config.rateLimit });
      if (req.method === 'GET' && u.pathname === '/api/groups') return send(res, 200, { groups: await groups() });
      if (req.method === 'GET' && u.pathname === '/api/logs') return send(res, 200, { logs: config.logs.slice(-50) });
      if (req.method === 'POST' && u.pathname === '/api/action') return send(res, 200, { message: await action(await body(req)) });
      return send(res, 404, { error: 'Not found' });
    } catch (e) { console.error('Dashboard error:', e.stack || e); if (res.headersSent) return; return send(res, 500, { error: e.message }); }
  });
  server.listen(3000, '127.0.0.1', () => console.log('لوحة التحكم: http://127.0.0.1:3000'));
}
startLocalDashboard();
