const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const DEFAULT_CONFIG = {
  ownerNumber: '201040224684',
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

function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function digits(value) {
  return String(value || '').replace(/\\D/g, '').replace(/^00/, '');
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
  config.logs.push({
    at: new Date().toISOString(),
    action,
    details
  });
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
const lockedGroups = new Map();
let maintenanceStarted = false;

async function isOwner(message) {
  const owner = digits(config.ownerNumber);
  const senderIds = [message.author, message.from].filter(Boolean);

  if (senderIds.some(id => personKey(id) === owner)) return true;

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
    console.error('Reply failed:', error.message);
  }
}

async function notifyOwner(text) {
  const ownerJid = jidFromNumber(config.ownerNumber);
  if (!ownerJid) return;
  try {
    await client.sendMessage(ownerJid, text);
  } catch (error) {
    console.error('Owner notification failed:', error.message);
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
  return (chat.participants || [])
    .map(participantJid)
    .filter(Boolean);
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
    console.error(`Could not load group ${id}:`, error.message);
    return null;
  }
}

async function blockedKeys() {
  const source = await groupById(config.blockedGroupId);
  if (!source) return new Set();
  return new Set(participantIds(source).map(personKey));
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
    return false;
  }

  const success = await chat.setMessagesAdminsOnly(true);
  if (!success) {
    addLog('lock_failed', chat.name);
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
  if (!(await isBotAdmin(chat))) {
    await reply({ reply: t => t }, '');
    return false;
  }

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
  if (!config.rateLimit.enabled || !message.from?.endsWith('@g.us')) return;

  const chat = await message.getChat();
  if (!chat.isGroup) return;

  const groupId = chat.id._serialized;
  const now = Date.now();
  const windowMs = Number(config.rateLimit.windowSeconds) * 1000;
  const previous = messageBuckets.get(groupId) || [];
  const current = previous.filter(time => now - time < windowMs);
  current.push(now);
  messageBuckets.set(groupId, current);

  if (current.length >= Number(config.rateLimit.limit)) {
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

    const victims = participantIds(target).filter(id => {
      const isBot = personKey(id) === personKey(botId());
      return !isBot && !isException(id) && hasKey(blocked, id);
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
        addLog(shouldReject ? 'dry_run_reject_request' : 'dry_run_approve_request', `${group.name}: ${requester}`);
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

  const args = body.split(/\\s+/);
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
        const chats = (await client.getChats()).filter(chat => chat.isGroup);
        return reply(message, chats.map((chat, i) => `${i + 1}. ${chat.name}\n${chat.id._serialized}`).join('\n\n') || 'لا توجد جروبات.');
      }
      case '!logs':
        return reply(message, config.logs.slice(-15).map(item => `${item.at} | ${item.action} | ${item.details}`).join('\n') || 'لا توجد سجلات.');
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
      case '!set-blocked-group': {
        const chat = await getChatFromMessage(message);
        if (!chat) return;
        config.blockedGroupId = chat.id._serialized;
        saveConfig();
        return reply(message, `تم تحديد ${chat.name} كمصدر للمحظورين.`);
      }
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
        return reply(message, `تم تحديد ${chat.name} لجـهزة طلبات الانضمام.`);
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
    console.error('Command error:', error);
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
      console.error('Maintenance error:', error.message);
    }
  }, 60 * 1000);
});

client.on('auth_failure', message => console.error('Auth failure:', message));
client.on('disconnected', reason => console.log('Disconnected:', reason));

client.on('message', async message => {
  try {
    await observeRate(message);
    await handleCommand(message);
  } catch (error) {
    console.error('Message error:', error.message);
  }
});

saveConfig();
client.initialize();
