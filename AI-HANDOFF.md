# AI handoff — WhatsApp Admin Studio

**Last updated:** 2026-10-02  
**Repository:** `Tareq612345/whatsapp-admin-bot`  
**Default branch:** `main`  
**Latest published build:** `v0.2.0-beta.3`

Read `AGENTS.md` first. Its rules are mandatory. Then read the newest entries in `AI-CHANGELOG.md`, this file, `README.md`, `docs/WINDOWS-APP.md`, and the implementation being changed. Every future AI agent must update `AI-CHANGELOG.md` honestly in the same pull request.

## 1. Current state

- `main` contains the desktop application and the QR startup fix merged through PR #19.
- Release PR #20 published `v0.2.0-beta.3` as a GitHub pre-release.
- Published assets:
  - `WhatsApp-Admin-Studio-Setup-0.2.0-beta.3.exe`
  - `SHA256SUMS.txt`
- Installer size: 93,891,819 bytes (about 89.5 MiB / 93.9 MB).
- Installer SHA-256: `1444bcc5ee455c9428361fe55ce8cfc473d39afee4a0cfd530ca25be0892c0b4`.
- Windows validation, installer build, packaged restart smoke test, and OCR packaging checks passed in GitHub Actions.
- The Node test suite has 23 passing tests.
- The release is intentionally marked pre-release and is not Authenticode-signed because no trusted signing identity is connected.

## 2. Immediate human test required

The next maintainer or AI must not call QR login fully verified until the user tests `v0.2.0-beta.3` on Windows with a real WhatsApp account.

Test in this order:

1. Install `v0.2.0-beta.3` over the previous beta without deleting application data.
2. Open Studio once and wait for either a QR code or the connected state.
3. If a QR appears, link it through WhatsApp → Linked devices → Link a device.
4. Close and reopen Studio; the saved session should reconnect without another QR.
5. Press Restart bot once; verify one bot host returns to Ready and no duplicate reply is sent.
6. Complete Owner Claim by sending the exact displayed command, including `!claim` and the six digits, from the intended owner account inside a group containing the bot.
7. Confirm the Owner appears under Administrators and privileged commands remain unavailable to unapproved senders.
8. Run one Arabic OCR case and one English OCR case through Student Gate.
9. Install a later build over beta.3 and confirm the WhatsApp session and settings remain available.

If startup still remains on **Starting**, collect:

`%APPDATA%\WhatsApp Admin Studio\logs\admin-studio.log`

The Settings page has **Open logs folder**. Never commit the user's log or session because it can contain device paths or personal identifiers. Ask for the smallest sanitized excerpt needed.

## 3. QR startup defect and implemented fix

### User-observed beta.2 behavior

The visible Studio started, the hidden bot host printed its dashboard URLs, but no `qr`, `authenticated`, or `ready` event arrived. After 45 seconds Studio logged `WhatsApp startup timed out before QR or ready state`.

### Root cause

`wwebjs-electron` discovers Electron through the `DevToolsActivePort` file under Electron's `userData` directory. The visible Studio process and the spawned `--bot-host` process were sharing the same Electron `userData` directory and both loaded the bridge. Puppeteer could therefore attach to the visible Studio Chromium target instead of the hidden WhatsApp target.

### Fix in PR #19

- `desktop/main.js` detects `--bot-host` before loading `wwebjs-electron`.
- Only the bot-host process loads the bridge.
- The bot host uses `%APPDATA%\WhatsApp Admin Studio\electron-bot-host` as its isolated Electron debugging profile.
- A stale `DevToolsActivePort` file is removed before the bot host starts.
- `BOT_DATA_DIR` remains the shared Studio application-data root, so this isolation does **not** move or reset config, logs, database data, or WhatsApp authentication state.
- `lib/electron-profile.js` owns the path calculation.
- `test/electron-profile.test.js` protects the separation and shared-data behavior.

Do not collapse these two roots back together. Do not load `wwebjs-electron` in the visible parent Studio process.

## 4. Process architecture and important files

- `desktop/main.js`: visible Studio lifecycle, child bot-host lifecycle, IPC, QR conversion, timeout, restart/stop, file paths, and Windows signature diagnostics.
- `desktop/renderer.js`, `desktop/index.html`, `desktop/styles.css`: desktop UI and all user-visible states.
- `bot.js`: WhatsApp client, message events, Claim flow, command execution, and desktop events.
- `lib/whatsapp-library.js`: single import point for `wwebjs-electron`.
- `lib/electron-profile.js`: separates the bot-host Electron debugging profile from shared runtime data.
- `lib/owner-claim.js`: short-lived one-time ownership claim; never log codes.
- `lib/message-deduper.js`: prevents duplicate command handling and repeated replies.
- `lib/session-data.js`: WhatsApp authentication/cache paths and targeted disconnect cleanup.
- `lib/file-logger.js`: rotating, sanitized persistent diagnostic log.
- `config/admins.json`: safe administrator defaults; never add a real number or LID.
- `config/commands.json`: command, alias, reply, and permission defaults.
- `rapid-ocr.js`, `ocr/`, `lib/ocr-service.js`: OCR primary/fallback behavior and packaged assets.
- `.github/workflows/windows-release.yml`: required Windows package/lifecycle validation (`validate-windows` job).
- `.github/workflows/publish-v0.2.0-beta.3.yml`: one-version publication workflow used for beta.3.

## 5. Persistent data contract

Normal user data stays below:

`%APPDATA%\WhatsApp Admin Studio`

This includes configuration, logs, database/export data, and WhatsApp authentication/cache paths selected by `lib/session-data.js`. The installer has `deleteAppDataOnUninstall: false`, so normal updates should preserve data. Disconnecting the WhatsApp account must remove only the WhatsApp auth/cache targets, not administrators, commands, logs, or database records.

The following directory is internal Electron host state, not the shared data root:

`%APPDATA%\WhatsApp Admin Studio\electron-bot-host`

## 6. Owner, phone number, and LID rules

- No real owner number is hardcoded.
- LID is an internal WhatsApp identifier and ordinary users must never be asked to find or enter it.
- First-time Owner setup begins only after WhatsApp reaches ready state.
- Studio displays a short-lived one-time code and the exact command: `!claim 123456`.
- The user must send the whole command, not only the digits.
- A successful claim stores every verified sender identifier observed by the bot, including phone identity and LID when available.
- Privileged commands remain blocked until Claim succeeds.
- Claim codes expire, work once, and are redacted from persistent logs.

## 7. Restart and duplicate-reply constraints

Previous work added process serialization, a bot-host lock, orphan cleanup, balanced lifecycle handling, and message-event deduplication. Preserve all of it. A restart must not leave multiple bot hosts, multiple event listeners, or three replies to one command. Any lifecycle change requires a regression test plus the packaged Windows restart smoke test.

## 8. OCR and package-size constraints

OCR is release-critical. Do not remove Arabic/English OCR, Tesseract SIMD/fallback support, RapidOCR fallback behavior, or packaged model/language files merely to reduce installer size. The current beta.3 installer is about 93.9 MB. A future “slim” build is acceptable only if the promised OCR behavior remains present and tested.

For OCR or packaging changes, verify:

- one Arabic sample;
- one English sample;
- one failure/unsupported-input path;
- installed asset paths, not only source-tree paths;
- resulting installer size and any accuracy tradeoff.

## 9. Windows signing status

The current installer is unsigned. The app's signature diagnostic can report this, but a runtime check is not a digital signature and cannot prevent SmartScreen. Do not claim signing is complete merely because the signature-check code exists.

To remove the warning properly:

1. obtain a trusted Authenticode code-signing certificate or approved cloud signing service;
2. store credentials only in GitHub Actions secrets or OIDC-backed signing configuration;
3. sign both executable and installer as appropriate;
4. timestamp the signatures;
5. verify the final downloaded artifact with `Get-AuthenticodeSignature` and require `Status = Valid`;
6. record signer subject, timestamp result, and SHA-256 in `AI-CHANGELOG.md` without recording secrets.

Until then, every release note must explicitly say the installer is unsigned and SmartScreen may warn.

## 10. Required development and release flow

For a functional change:

1. branch from current `main`;
2. make the smallest coherent change;
3. add/update regression tests;
4. run `npm run check`;
5. run `npm test`;
6. run `git diff --check`;
7. append a truthful `AI-CHANGELOG.md` entry;
8. open a focused pull request;
9. require `validate-windows` to pass for lifecycle, packaging, restart, dependency, or OCR changes;
10. merge only with required checks passing.

For a release:

1. use `npm version <version> --no-git-tag-version` so package and lockfile stay synchronized;
2. add release notes and a reviewed publication workflow or deliberately replace the version-specific workflow strategy;
3. build through GitHub Actions, not by committing binaries;
4. publish the installer and `SHA256SUMS.txt`;
5. verify tag, asset names, sizes, and checksum;
6. append a publication-confirmation ledger entry.

Never create a duplicate tag/release without checking existing releases first.

## 11. Honest validation boundary

Automated validation proves syntax, unit behavior, packaging, file presence, launch/restart smoke behavior, and release generation. It does not prove that WhatsApp's live web protocol accepted a QR, that a phone linked successfully, or that real cards were recognized accurately. Record those as `NOT RUN` until a human performs them.

## 12. Useful references

- Latest release: `https://github.com/Tareq612345/whatsapp-admin-bot/releases/tag/v0.2.0-beta.3`
- QR fix: PR #19
- beta.3 release: PR #20
- `wwebjs-electron`: `https://github.com/AndyTargino/wwebjs-electron`
