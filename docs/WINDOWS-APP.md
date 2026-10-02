# WhatsApp Admin Studio for Windows

WhatsApp Admin Studio is the desktop control center for the bot. It packages the existing Node.js runtime with Electron and provides an NSIS installer for 64-bit Windows.

## Included in the first desktop release

- Guided QR login inside the application.
- Start, stop, and restart controls for the bot process.
- Live connection state and process output.
- Windows auto-start.
- Buttons for the Admin Dashboard and Student Gate.
- Administrator management without editing JSON by hand.
- Built-in roles: Owner, Administrator, and Moderator.
- Per-administrator command grants and restrictions.
- Commands available to regular members.
- Custom command prefix.
- Enable or disable any command.
- Multiple aliases for every command.
- Reply override for every command.
- Editable global replies for unknown, disabled, and unauthorized commands.
- Local configuration and runtime data stored under Electron's user-data directory.
- One-time owner claim with automatic phone/LID capture.
- Safe WhatsApp session reset for changing accounts or recovering from an invalid session.

## Development

Install dependencies:

```powershell
npm install
```

Start the desktop application:

```powershell
npm run desktop
```

The desktop main process starts the bot in a separate Electron-as-Node child process. Closing the application requests a graceful shutdown and force-stops the process only if it does not exit within eight seconds.

## Build the EXE installer

On a 64-bit Windows machine:

```powershell
npm install
npm run dist:win
```

The installer is written to:

```text
release/WhatsApp-Admin-Studio-Setup-0.2.0-beta.1.exe
```

The NSIS installer:

- lets the user choose the installation directory;
- creates Desktop and Start Menu shortcuts;
- keeps local application data when the program is uninstalled;
- installs only the 64-bit build.

## Portable build for testing

```powershell
npm run pack:win
```

This creates an unpacked application under `release/win-unpacked`. Run the executable from that folder before distributing an installer.

## Local data

The packaged application does not write runtime data into its installation folder. It uses Electron's user-data directory for:

```text
config/admins.json
config/commands.json
config.json
verification-config.json
.wwebjs_auth/
data/students.sqlite
data/*.xlsx
```

Use **Settings → Open folder** to open the exact directory.

## Administrator and role model

`config/admins.json` contains:

- `roles`: reusable command permission sets;
- `admins`: WhatsApp numbers, LIDs, role assignments, direct grants, and explicit restrictions;
- `members`: commands available to users who are not administrators.

Permission order:

1. A disabled account is treated as a member.
2. Explicit `deniedCommands` always wins.
3. A role can grant one command or `*` for every command.
4. `allowedCommands` on an administrator grants extra commands.
5. Non-administrators receive only `members.allowedCommands`.

## Command customization

`config/commands.json` controls:

- `prefix`: up to three characters;
- `enabled`: whether the command can run;
- `aliases`: alternate names without the prefix;
- `reply`: optional response override.

Use `{{default}}` in an override to keep the original dynamic reply:

```text
✅ Completed

{{default}}
```

Available common placeholders:

- `{{default}}`: the original runtime response;
- `{{prefix}}`: the current command prefix;
- `{{command}}`: the canonical command name.

Changes to administrators and commands are reloaded by the running bot automatically.

## QR and process events

When launched by Studio, the bot writes structured events to standard output. Studio recognizes QR, ready, disconnected, and authentication-failure events. The QR value is rendered locally and is not sent to an external service.

On first launch, Studio displays a guided QR sign-in panel and opens the QR dialog when the code is ready. In WhatsApp, open **Linked devices → Link a device** and scan the code. The desktop status changes from login required, to loading, to connected.

The authenticated WhatsApp session is stored under Electron's stable user-data directory in `.wwebjs_auth/`. It is outside the installation directory, and the NSIS configuration keeps application data during uninstall. Installing a newer version over the existing version therefore reuses the same session automatically. A new QR is needed only when WhatsApp invalidates the linked device, the user logs it out, or the application-data folder is removed.

## First owner setup

New installations start with no owner identity. Studio generates a six-digit command that expires after ten minutes:

```text
!claim 482917
```

Send the command from the intended owner's WhatsApp account in a group containing the bot. The bot captures the sender's verified phone identity and internal WhatsApp LID automatically. The LID is never requested from the user or shown in the interface. The claim works once, is invalidated immediately after success, and is excluded from the activity log.

Privileged commands remain blocked until the owner claim succeeds. A previously seeded placeholder owner from an older desktop build is removed during migration and must be claimed properly.

## Change or repair the WhatsApp account

Use **Settings → WhatsApp account → Disconnect and show new QR** to stop the bot, remove only the saved WhatsApp session/cache, and start a fresh QR login. Administrators, commands, Student Gate data, and other settings are preserved.

## Before public distribution

The application can be built and tested without signing, but Windows may display a SmartScreen warning. For broad distribution:

1. Obtain a Windows code-signing certificate.
2. Configure electron-builder signing credentials through environment variables.
3. Build the installer in a controlled release workflow.
4. Sign each published installer.
5. Add automatic updates only after signed release artifacts are available.

NSIS is the selected installer format because it supports the intended Windows installation and later auto-update path.

## Slim packaging and OCR

The `0.2.0-beta.1` build uses a production allow-list, ASAR packaging, maximum compression, and only the `en-US` Electron runtime locale. Documentation, tests, development files, duplicate WhatsApp runtimes, and unused application files are not packaged.

OCR remains part of the Slim build:

- Tesseract.js and `tesseract.js-core` stay bundled as the dependable local fallback.
- Arabic and English recognition remain enabled.
- The RapidOCR Python worker remains available in the unpacked OCR resources.
- RapidOCR uses a virtual environment under the writable application-data directory when one is installed.
- If RapidOCR is unavailable, image processing automatically falls back to Tesseract instead of disabling Student Gate.

The first Tesseract recognition may download Arabic and English language data and cache it locally. Later recognition reuses that cache.