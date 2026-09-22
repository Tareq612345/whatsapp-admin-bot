# WhatsApp Admin Bot — Living Documentation

> This is the living source of truth for understanding, operating, reviewing, and modifying the WhatsApp bot. Any future code change, bug fix, feature, configuration change, or architectural decision must be reflected in this file in the same change whenever practical.

- Repository: `Tareq612345/whatsapp-admin-bot`
- Document created: 2026-09-23
- Document scope: active code in the repository root on `main`
- Important: the nested `whatsapp-admin-bot/` directory is a legacy copy and is not the active runtime used by the root `package.json`.

---

## 1. What the project does

This is a local WhatsApp Web administration bot with two related systems:

1. **Group administration**
   - Owner-only WhatsApp commands.
   - Group message-rate protection.
   - Temporary group locking and unlocking.
   - Blacklist synchronization across target groups.
   - Allowlist/blacklist membership-request handling.
   - Member removal, promotion, demotion, exceptions, and logs.

2. **Student Gate**
   - Receives student-card images in private chats.
   - Processes images locally with Arabic OCR.
   - Extracts structured student fields.
   - Matches OCR text against configured group rules.
   - Can approve a matching group-membership request automatically.
   - Sends uncertain or failed cases to manual review.
   - Stores verification records in SQLite and exports them to Excel.

The bot is local-first: WhatsApp session data, configuration, OCR data, and verification records are intended to remain on the bot machine.

---

## 2. Active runtime and startup order

The active root `package.json` starts:

```text
node --require ./port-guard.js \
     --require ./phone-resolver.js \
     --require ./rapid-ocr.js \
     --require ./student-gate.js \
     bot.js
```

The load order matters because several files patch shared runtime behavior before `bot.js` creates/initializes the WhatsApp client:

1. `port-guard.js`
   - Wraps `http.createServer`.
   - Logs a friendly message when a dashboard port is already in use.

2. `phone-resolver.js`
   - Resolves WhatsApp LIDs to normal phone numbers when possible.
   - Caches resolved numbers.
   - Patches `StudentStore.prototype.insert` so a resolved phone number is saved when available.
   - Adds a message listener before client initialization to start LID resolution.

3. `rapid-ocr.js`
   - Replaces `ocr-service.recognizeImage` with RapidOCR first and Tesseract fallback.
   - Starts a Python worker lazily when the first image is processed.

4. `student-gate.js`
   - Patches `Client.prototype.initialize`.
   - Installs the Student Gate message listener and the port-3001 dashboard before the original WhatsApp initialization runs.

5. `bot.js`
   - Creates the `whatsapp-web.js` client.
   - Registers the main commands, rate monitor, QR handler, lifecycle handlers, and port-3000 dashboard.
   - Calls `client.initialize()`.

---

## 3. Main data flow

```text
WhatsApp event
  -> bot.js receives message/message_create
      -> deduplicate message ID
      -> owner command handling
      -> rate-limit observation

Private image message
  -> student-gate.js
      -> media download
      -> SHA-256 calculation
      -> duplicate check
      -> queue
      -> RapidOCR
          -> fallback to Tesseract if RapidOCR is unavailable/fails
      -> Arabic normalization and field parsing
      -> rule matching
      -> SQLite record
      -> automatic approval OR manual review
      -> owner notification for review cases
      -> dashboard visibility
```

The active `bot.js` deliberately runs commands before rate monitoring so a slow WhatsApp chat refresh cannot prevent an owner command such as `!ping` from being handled.

The current message pipeline listens to both `message` and `message_create`; `processedMessageIds` prevents the same message from being processed twice.

---

## 4. Configuration and persistence

### Main bot configuration

- File: `config.json`
- Ignored by Git.
- Created/updated by `bot.js`.
- Contains owner identity, dry-run state, group IDs, exceptions, approval settings, rate-limit settings, and recent logs.

Important current configuration concepts:

- `ownerNumber`
- `ownerLids`
- `dryRun`
- `blockedGroupId` and/or `blockedGroupIds`
- `allowGroupId`
- `targetGroupIds`
- `approvalGroupIds`
- `exceptions`
- `approvalEnabled`
- `approvalMode`: `blacklist` or `allowlist`
- `autoSyncEnabled`
- `rateLimit.enabled`
- `rateLimit.limit`
- `rateLimit.windowSeconds`
- `rateLimit.lockDurationMinutes`
- `logs`

### Student Gate configuration

- File: `verification-config.json`
- Ignored by Git.
- Created/updated by `student-gate.js`.

Main fields:

- `enabled`
- `autoApprove`
- `dryRun`
- `minConfidence`
- `maxQueue`
- `rules`
- `logs`

Each rule connects a WhatsApp group to one or more keywords. A single matching rule can produce a verified result; multiple matches are sent for review because the correct target group is ambiguous.

### WhatsApp session

- Directory: `.wwebjs_auth`
- Managed by `LocalAuth` with client ID `admin-bot`.
- Must never be shared or committed; it contains login/session material.

### Student database

- Directory: `data/`
- Database: `data/students.sqlite`
- Created by `lib/student-store.js`.
- Uses SQLite WAL mode and a busy timeout.
- Schema includes verification status, sender identity, file hash, OCR text/confidence, extracted student fields, matched rule/group, decision reason, and review time.

### Ignored files

`.gitignore` excludes:

```text
node_modules/
.ocr-venv/
.wwebjs_auth/
.wwebjs_cache/
config.json
verification-config.json
data/
*.log
.env
```

---

## 5. Group administration behavior in `bot.js`

### Owner authorization

`isOwner()` compares the sender against the configured owner number and configured LIDs, and also attempts a contact lookup as a fallback. Commands that do not pass this check are ignored.

### Rate protection

`observeRate()` keeps an in-memory timestamp bucket per group. When the configured message count is reached inside the configured time window, `lockGroup()` tries to switch the group to admin-only messaging.

`lockGroup()`:

- Checks that the bot is an admin.
- Calls `setMessagesAdminsOnly(true)`.
- Logs the lock.
- Sends a notification to the group.
- Schedules automatic reopening after `lockDurationMinutes`.

### Blacklist synchronization

`syncBlocked()`:

- Reads members from configured blocked-source group(s).
- Scans configured target groups.
- Does not remove the bot itself.
- The active version also protects target-group admins and super-admins.
- Respects configured exceptions.
- In `dryRun`, records what would be removed without changing membership.
- In live mode, requires the bot to be an admin before removal.

### Membership requests

`processMembershipRequests()` reads pending requests from configured approval groups.

- Blacklisted users are rejected.
- In allowlist mode, users not found in the allowlist are rejected.
- In dry-run, actions are logged as would-approve/would-reject.
- In live mode, the bot must be an admin.

### Member commands

The owner can issue commands for:

- `!remove`
- `!promote`
- `!demote`
- `!member-check`
- `!scan-group`
- `!group-info`

Mentions are preferred; numeric phone arguments are also accepted.

---

## 6. Student Gate behavior

### Accepted input

The active Student Gate only processes media from private users. Group messages are used to populate the group list but are not treated as student-card submissions.

### Queue

`student-gate.js` maintains an in-memory queue and processes one image at a time. `maxQueue` protects the process from unbounded pending work.

The queue itself is not durable across a process restart. The SQLite records are durable, but jobs still waiting in memory are lost if the process exits before processing them.

### Duplicate detection

The image is hashed with SHA-256. A matching hash from a different sender is recorded as a review case. The duplicate check is not a complete content-moderation or identity system; it only compares the stored file hash and sender identity.

### OCR and parsing

`lib/ocr-service.js` provides:

- Arabic/English Tesseract worker support.
- Arabic character normalization.
- Arabic and Persian digit conversion.
- Student-card field extraction.
- National-ID extraction when a 14-digit value is found.
- Keyword normalization and matching.
- SHA-256 helper.

The currently active OCR wrapper is `rapid-ocr.js`:

- Uses `.ocr-venv` Python when available.
- Starts `ocr/rapid_worker.py`.
- Uses Arabic PP-OCRv5 through RapidOCR/ONNX Runtime.
- Falls back to Tesseract when the Python environment, worker, or OCR request fails.

### High-accuracy OCR status

`high-accuracy-ocr.js` contains an optional local Ollama fallback using `qwen2.5vl:3b`. However, the current `npm start` preload chain uses `rapid-ocr.js`, not `high-accuracy-ocr.js`. Installing Ollama alone does not activate that file; the startup chain must be changed deliberately if the high-accuracy path is to become active.

### Verification decision

The normal decision path is:

- Low OCR confidence -> review.
- More than one matching group rule -> review.
- No matching rule -> review.
- Exactly one match -> verified candidate.
- If `autoApprove` is enabled, find a pending membership request from the same sender identity and approve it unless Student Gate `dryRun` is enabled.
- If approval cannot be completed, keep the record in review and notify the owner.
- Failed OCR -> failed record plus owner review notification.

---

## 7. Storage and privacy

The system stores sensitive data locally, including names, phone numbers, national IDs, OCR text, decisions, and exported Excel files.

Current privacy assumptions:

- Data is not intentionally uploaded to GitHub.
- `config.json`, `verification-config.json`, and `data/` are ignored.
- The bot machine and its backups still need access control.
- `data/students-YYYY-MM-DD.xlsx` exports contain sensitive student data and must be protected or deleted according to the project’s retention policy.

Do not commit:

- `.wwebjs_auth/`
- `.wwebjs_cache/`
- `config.json`
- `verification-config.json`
- `data/`
- `.env`
- OCR virtual environments
- exported Excel files

---

## 8. Dashboards and local API

### Admin dashboard: port 3000

Implemented by the dashboard bridge in the active `bot.js`.

Main endpoints:

- `GET /`
- `GET /api/status`
- `GET /api/groups`
- `GET /api/logs`
- `POST /api/action`

It controls dry-run, rate settings, approval settings, auto-sync, group selections, blacklist sync, and request actions.

### Student Gate dashboard: port 3001

Implemented in `student-gate.js`.

Main endpoints:

- `GET /`
- `GET /api/status`
- `GET /api/groups`
- `GET /api/records`
- `GET /api/export`
- `POST /api/action`

It controls OCR settings, rules, review decisions, and Excel export.

Both dashboards bind to `127.0.0.1`, which limits normal network exposure to the local machine. They currently do not implement user authentication, CSRF protection, or a separate authorization layer.

---

## 9. Important risks and known limitations

1. **Hardcoded identity defaults**
   - Owner number and an owner LID are present in source defaults.
   - Future work should move identity configuration to a clear, validated configuration path.

2. **`.env.example` is not wired into runtime**
   - The repository documents environment variables, but the active code does not currently load them through `dotenv`.
   - Do not assume editing `.env` changes runtime behavior until this is implemented.

3. **Unauthenticated local dashboards**
   - Any process/user able to access local ports can call mutating API endpoints.
   - Keep the bot machine trusted and do not expose these ports through a proxy without authentication.

4. **Sensitive local records**
   - SQLite and Excel are not encrypted by this project.
   - Add retention, encryption, or access-control work before using this for a larger student population.

5. **Auto-approval false positives**
   - OCR and keyword matching can produce false matches.
   - Keep both dry-run settings enabled during testing and consider requiring stronger identity/request validation before live approval.

6. **In-memory queue**
   - Pending image jobs disappear on restart.
   - A future durable queue should persist pending jobs before OCR starts.

7. **Configuration split**
   - Main moderation settings and Student Gate settings live in separate JSON files.
   - Any feature spanning both systems must update both configuration paths consistently.

8. **Legacy duplicate code**
   - The nested `whatsapp-admin-bot/` copy is older and can confuse maintenance.
   - Future changes should target the root runtime unless the legacy copy is intentionally being removed or migrated.

9. **Optional OCR files can be inactive**
   - Presence of `high-accuracy-ocr.js` does not mean it is loaded.
   - Always verify the actual `npm start` preload chain before changing OCR behavior.

10. **Windows-oriented setup**
    - The `.cmd` scripts target Windows (`py`, `.ocr-venv\\Scripts\\python.exe`, `start` commands).
    - Cross-platform support needs separate scripts and path handling.

---

## 10. Operating instructions

### Standard start

```powershell
npm install
npm start
```

Or on Windows:

```text
start-bot.cmd
```

### Update and start

```text
update-and-start.cmd
```

This performs a fast-forward-only pull, installs dependencies, and starts the bot.

### RapidOCR setup

```text
setup-light-ocr.cmd
```

This creates `.ocr-venv`, installs RapidOCR/ONNX Runtime/Arabic support, and warms up the Arabic OCR worker.

### Optional Ollama setup

```text
setup-high-accuracy-ocr.cmd
```

This downloads `qwen2.5vl:3b`, but the high-accuracy wrapper is not active in the current start command unless the preload chain is changed.

### Safety rule

Start in dry-run. Verify the configured groups and logs. Only then consider disabling dry-run, and record that decision in this file’s change log.

---

## 11. Maintenance protocol for future changes

Before modifying code:

1. Read this document first.
2. Confirm whether the change targets the active root runtime or the legacy nested copy.
3. Trace all affected startup patches and configuration files.
4. Check whether the change affects privacy, moderation, OCR accuracy, auto-approval, or dashboard authorization.
5. Update relevant tests/checks or add a manual verification procedure.

When modifying code:

1. Keep the active runtime behavior and this document synchronized.
2. Update the file list, data flow, configuration, risks, or operating instructions when they change.
3. Add an entry to the change log below.
4. Run the project syntax check where possible:

```powershell
npm run check
```

5. If behavior changes, document the expected before/after behavior and how it was verified.

When reviewing a proposed change, explicitly check:

- Is `dryRun` still safe by default?
- Can a non-owner trigger a mutating action?
- Can a local dashboard caller bypass intended safety controls?
- Are national IDs, images, or exports exposed or retained unnecessarily?
- Does the change affect LID/phone matching?
- Does the change alter the actual preload order?
- Is the legacy nested copy being changed accidentally?
- Are both `config.json` and `verification-config.json` handled if needed?

---

## 12. Change log

### 2026-09-23 — Initial living documentation

- Reviewed the active root runtime and its startup preload chain.
- Documented group administration behavior.
- Documented Student Gate, OCR, queue, approval, SQLite, dashboards, and exports.
- Identified the active RapidOCR path and the inactive-by-default Ollama high-accuracy path.
- Identified the nested legacy copy.
- Recorded privacy, authentication, auto-approval, queue durability, configuration, and maintenance risks.

### Future entries

Add every code/configuration/architecture change here using:

```text
### YYYY-MM-DD — Short change title

- What changed.
- Why it changed.
- Files affected.
- How it was tested.
- Any new risk or operational instruction.
```
