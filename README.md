# WhatsApp Admin Bot

A local WhatsApp group-management bot with message-rate protection, reusable block/allow lists, membership-request automation, student-card OCR, review dashboards, and Excel exports.

## Windows desktop application

Version 3 introduces **WhatsApp Admin Studio**, an Electron desktop interface that can be packaged as a Windows EXE installer.

```powershell
npm install
npm run desktop
```

Build the 64-bit Windows installer with:

```powershell
npm run dist:win
```

The desktop application provides QR login, process controls, Windows auto-start, administrator and role management, per-user permissions, member commands, aliases, editable replies, activity logs, and direct access to both dashboards. See [`docs/WINDOWS-APP.md`](docs/WINDOWS-APP.md) for the complete desktop guide.

The Slim desktop build keeps Arabic/English OCR and the RapidOCR worker while removing duplicate runtimes, extra Electron locales, tests, documentation, and other development-only files from the packaged application.

> This project uses `whatsapp-web.js` and automates a normal WhatsApp account through WhatsApp Web. It is not an official WhatsApp Business API integration.

## Features

### Group administration

- Lock and unlock group messaging.
- Detect high message volume and temporarily switch a group to admins-only mode.
- Remove, promote, or demote members.
- Clear all non-admin members after explicit confirmation.
- Keep selected numbers exempt from removal.

### Block and allow lists

- Use one or more WhatsApp groups as reusable blocked-member lists.
- Scan configured target groups and remove matching members.
- Use another WhatsApp group as an allow list.
- Run automatic synchronization every minute.
- Preview destructive operations with dry-run mode.

### Membership requests

- Monitor groups that use **Approve new participants**.
- Reject requests from blocked users.
- Approve only users in an allow-list group when allow-list mode is enabled.
- Approve or reject pending requests manually.

### Student Gate

- Receive student-card images in private messages.
- Run Arabic and English OCR locally.
- Extract the student name, national ID, student code, college, program, level, cohort, and academic year.
- Match OCR text against configurable group rules.
- Approve a matching membership request automatically or send it for manual review.
- Detect an image already used by another WhatsApp account.
- Store results in SQLite and export them to Excel.

### Reliability

- Automatically reconnect after a WhatsApp disconnection with bounded exponential backoff.
- Shut down HTTP servers, SQLite, and the WhatsApp client cleanly.
- Expose a local health endpoint.
- Notify the owner after recovery and when the OCR queue is full.
- Keep a bounded local activity log.

## Requirements

- Node.js 22.13 or newer. Node.js 24 is recommended.
- Windows is recommended for the included `.cmd` helper scripts.
- Internet access for installation and the first OCR language download.
- The bot must be an admin in groups where it manages chat, members, or requests.

## Installation

```powershell
git clone https://github.com/Tareq612345/whatsapp-admin-bot.git
cd whatsapp-admin-bot
npm install
npm start
```

Alternatively, run `update-and-start.cmd`. On first launch, scan the terminal QR code. The session is saved in `.wwebjs_auth`.

## Administrator numbers

Only numbers listed in [`config/admins.json`](config/admins.json) can execute commands:

```json
{
  "numbers": ["201040224684", "201111111111"],
  "lids": ["35816386629826"]
}
```

- Use international format without `+`, spaces, or dashes.
- `numbers` contains normal WhatsApp numbers.
- `lids` contains WhatsApp Linked IDs when WhatsApp hides a sender behind an LID.
- The file reloads automatically when it changes; no restart is needed.
- Legacy `ownerNumber` and `ownerLids` values in `config.json` remain supported as fallbacks.

## First-time setup

1. Start the bot and scan the QR code.
2. Make the bot an admin in the groups it will manage.
3. Add administrators to `config/admins.json`.
4. Keep dry-run enabled.
5. Send `!ping` and `!status` from an administrator account.
6. Configure block-list, allow-list, target, and approval groups.
7. Test synchronization and approvals.
8. Disable dry-run only after checking the expected actions.

## Dashboards and health

| Service | Address | Purpose |
| --- | --- | --- |
| Admin dashboard | `http://127.0.0.1:3000` | Group controls, limits, logs, lists, and approvals |
| Student Gate | `http://127.0.0.1:3001` | OCR rules, records, review, and Excel export |
| Health endpoint | `http://127.0.0.1:3000/api/health` | Connection, memory, dashboard, and queue status |

The health endpoint returns HTTP `200` while WhatsApp is ready and `503` while disconnected or recovering.

## Command reference

All commands are restricted to configured administrators.

### General

| Command | Description |
| --- | --- |
| `!help` | Show the command list |
| `!ping` | Confirm command processing works |
| `!status` | Show bot settings and state |
| `!groups` | List known groups |
| `!logs` | Show recent activity |
| `!group-info` | Show information about the current group |

### Safety and rate limits

| Command | Description |
| --- | --- |
| `!dry-run on` | Preview destructive operations |
| `!dry-run off` | Allow configured destructive operations |
| `!rate-limit 25 60` | Lock after 25 messages inside 60 seconds |
| `!rate-limit off` | Disable rate monitoring |
| `!lock-duration 5` | Set automatic lock duration |
| `!lock` | Lock the current group |
| `!unlock` | Unlock the current group |
| `!clear-group تأكيد` | Remove all non-admin members |

### Block-list synchronization

| Command | Description |
| --- | --- |
| `!add-blocked-group` | Add the current group as a blocked-member source |
| `!remove-blocked-group` | Remove the current blocked-member source |
| `!list-blocked-groups` | List blocked-member groups |
| `!clear-blocked-groups` | Remove all blocked-member group settings |
| `!add-target` | Add the current group as a synchronization target |
| `!remove-target` | Remove the current target |
| `!sync-blocked` | Scan all targets immediately |
| `!scan-group` | Scan only the current group |
| `!auto-sync on\|off` | Toggle periodic synchronization |
| `!check-number 201234567890` | Check whether a number is blocked |
| `!exception-add 201234567890` | Exempt a number from removal |
| `!exception-remove 201234567890` | Remove an exemption |

### Membership requests

| Command | Description |
| --- | --- |
| `!set-approval-group` | Add the current group to request processing |
| `!set-allow-group` | Use the current group as the allow list |
| `!approval-on` / `!approval-off` | Toggle periodic request processing |
| `!approval-mode blacklist` | Reject blocked users and approve others |
| `!approval-mode allowlist` | Approve only allow-listed users |
| `!approve-pending` | Process requests immediately |
| `!reject-blocked` | Reject only blocked requests |

### Member management

| Command | Description |
| --- | --- |
| `!member-check 201234567890` | Check for a member |
| `!remove 201234567890` | Remove a member |
| `!promote 201234567890` | Promote a member |
| `!demote 201234567890` | Demote a member |

Commands accepting numbers also support WhatsApp mentions where available.

## Student Gate setup

1. Enable **Approve new participants** in the destination group.
2. Make the bot a group admin.
3. Send a message in the group so the bot discovers it.
4. Open `http://127.0.0.1:3001`.
5. Create a rule, select a group, and add one keyword or phrase per line.
6. Keep Student Gate dry-run enabled during testing.
7. Have a student send a card image privately to the bot.
8. Have the same account submit a membership request.
9. Review the OCR result and matching rule.
10. Disable Student Gate dry-run when the workflow is correct.

Manual review is used when OCR confidence is low, no rule matches, multiple rules match, an image was used by another sender, or no matching request exists.

## Runtime files

| Path | Description |
| --- | --- |
| `.wwebjs_auth/` | Persistent WhatsApp session |
| `.wwebjs_cache/` | WhatsApp Web cache |
| `config.json` | Group-management settings |
| `verification-config.json` | Student Gate settings and rules |
| `data/students.sqlite` | Verification records |
| `data/students-YYYY-MM-DD.xlsx` | Excel exports |

These files are excluded from Git.

## Project structure

```text
.
├── bot.js                     WhatsApp events and commands
├── student-gate.js            Private-image queue and Student Gate API
├── config/admins.json         Allowed administrator numbers and LIDs
├── lib/admin-access.js        Hot-reloaded administrator authorization
├── lib/admin-dashboard.js     Admin dashboard HTTP server and actions
├── lib/lifecycle.js           Shared cleanup and health registry
├── lib/runtime-manager.js     Reconnection, health, alerts, and shutdown
├── lib/ocr-service.js         OCR parsing and rule matching
├── lib/student-store.js       SQLite storage and Excel export
├── dashboard.html             Group administration interface
└── dashboard-v2.html          Student Gate interface
```

## Scripts

```powershell
npm start
npm run check
npm test
```

- `start` launches the complete bot.
- `check` validates JavaScript syntax.
- `test` runs unit tests without connecting to WhatsApp.

## Recovery and shutdown

- Reconnection starts five seconds after a disconnection.
- Repeated failures use exponential backoff capped at 60 seconds.
- Successful recovery resets the backoff and notifies the owner.
- `Ctrl+C`, `SIGINT`, and `SIGTERM` trigger graceful shutdown.
- Shutdown stops both dashboards, closes SQLite, cancels reconnect timers, and destroys the client.
- A full OCR queue rejects new work temporarily and alerts the owner at most once every ten minutes.

## Troubleshooting

### Commands receive no reply

- Confirm the sender is in `config/admins.json`.
- Use international format without `+`.
- Add the numeric LID to `lids` if WhatsApp exposes the account as an LID.
- Check terminal output and `!logs`.

### Group actions do not run

- Confirm the bot is an admin.
- Confirm dry-run is disabled for real operations.
- Send a message in the group so it appears in the local cache.

### Student Gate does not approve

- Confirm **Approve new participants** is enabled.
- The request and image must come from the same WhatsApp account.
- Check OCR confidence and rule matches.
- Confirm Student Gate dry-run is disabled.

### A dashboard port is busy

The admin dashboard requires port `3000`; Student Gate requires `3001`. Close the process using the port and restart.

## Operating notes

- Start in dry-run after every major update.
- Test destructive commands in a temporary group.
- Keep `.wwebjs_auth`, `config.json`, `verification-config.json`, and `data/` when updating.
- Use `git pull --ff-only` or `update-and-start.cmd`.
- Do not run `npm audit fix --force`; it may replace the required WhatsApp library revision.