# AI change ledger

This append-only file records AI-assisted repository changes, their validation, and their real outcome. Follow the template and rules in `AGENTS.md`. Never add credentials, phone numbers, personal messages, or large logs.

## 2026-09-30 — Add cross-agent repository instructions

- **Agent/tool:** Notion AI with GitHub MCP
- **Request:** Create enforceable guidance for future AI agents and require every change to be logged with its validation result.
- **Branch/PR:** `docs/ai-agent-instructions` / pending when this entry was written
- **Scope:** Added one canonical rule file, an append-only ledger, and compatibility pointers for Copilot, Claude Code, and Gemini; no application or packaging behavior changed.
- **Files:** `AGENTS.md`, `AI-CHANGELOG.md`, `.github/copilot-instructions.md`, `CLAUDE.md`, `GEMINI.md`
- **Behavior:** Supported coding agents are directed to the same repository-specific workflow, anti-slop UI rules, validation matrix, and change-record format.
- **Validation:**
  - `git diff --check --no-index /dev/null <file>` for each new file: PASS — no whitespace errors
  - Reference/path review: PASS — compatibility files point to root `AGENTS.md`
  - Runtime tests: NOT RUN — documentation/instruction-only change
- **Result:** SUCCESS
- **Known limitations/follow-up:** Instruction compliance still depends on each external agent reading the supported repository instruction file.

## 2026-09-30 — Add reliable in-app WhatsApp sign-in

- **Agent/tool:** Notion AI with GitHub MCP and local validation
- **Request:** Show a professional first-run WhatsApp QR login, preserve the session across updates, and clearly communicate connection state.
- **Branch/PR:** `feature/in-app-whatsapp-login` / #12
- **Scope:** Added buffered desktop-event parsing, authentication lifecycle events, cached QR state, a guided in-app login panel/dialog, session persistence documentation, and regression tests; no command, permission, or OCR behavior changed.
- **Files:** `bot.js`, `desktop/main.js`, `desktop/renderer.js`, `desktop/index.html`, `desktop/styles.css`, `lib/desktop-events.js`, `test/desktop-events.test.js`, `package.json`, `docs/WINDOWS-APP.md`, `AI-CHANGELOG.md`
- **Behavior:** First-time users are prompted to scan a QR inside Studio; existing users reuse the LocalAuth session stored in the Windows user-data directory after restarts and version updates.
- **Validation:**
  - `npm run check`: PASS — all application and desktop JavaScript passed syntax validation
  - `npm test`: PASS — 14 tests passed, including split and multi-line desktop-event regression tests
  - `git diff --check`: PASS — no whitespace errors
  - Desktop visual QA at 1440×900: PASS — QR dialog is centered, readable, and free of clipping or overlap
  - Minimum-window visual QA at 1040×680: PASS — QR instructions and controls remain readable within the supported window
  - GitHub `validate-windows` workflow: PASS — packaged Windows smoke and validation job completed successfully
  - Real WhatsApp QR scan and update reuse: NOT RUN — requires a human WhatsApp account
- **Result:** PARTIAL
- **Known limitations/follow-up:** The Windows workflow must validate the packaged application. A human must complete one real WhatsApp scan and upgrade test because CI cannot authenticate a WhatsApp account.

## 2026-09-30 — Make automatic LID handling a mandatory rule

- **Agent/tool:** Notion AI with GitHub MCP
- **Request:** Make the WhatsApp LID and ownership rule prominent so future AI changes never ask ordinary users to find an internal identifier.
- **Branch/PR:** `docs/important-whatsapp-identity-rule` / pending when this entry was written
- **Scope:** Added a highlighted GitHub `IMPORTANT` callout covering removal of hardcoded identities, automatic LID capture, one-time ownership claims, and privileged-command gating; no runtime behavior changed.
- **Files:** `AGENTS.md`, `AI-CHANGELOG.md`
- **Behavior:** Future supported coding agents receive an explicit, visually prominent requirement to keep LIDs internal and automate owner verification.
- **Validation:**
  - `git diff --check -- AGENTS.md AI-CHANGELOG.md`: PASS — no whitespace errors
  - Runtime tests: NOT RUN — documentation/instruction-only change
- **Result:** SUCCESS
- **Known limitations/follow-up:** The rule is documented, but the one-time ownership claim workflow still needs to be implemented in the application.

## 2026-09-30 — Remove seeded identity and add first-run owner claim

- **Agent/tool:** Notion AI with GitHub MCP and local validation
- **Request:** Remove the hardcoded owner identity, start with no administrators, add automatic one-time ownership claim, support WhatsApp account reset, and validate the upgrade-safe behavior before release.
- **Branch/PR:** `feature/owner-claim-and-session-reset` / #14
- **Scope:** Removed all current-file occurrences of the previously seeded phone/LID; disabled legacy runtime owner fallback; added automatic number/LID capture from a verified claim message; migrated the old seeded placeholder to an unclaimed state; added claim expiry, renewal, single-use behavior, privileged-command gating, connected-account display, and session reset that preserves settings; updated desktop, CLI, dashboards, documentation, and tests. OCR and command behavior were otherwise unchanged.
- **Files:** `.env.example`, `README.md`, `BOT-UNDERSTANDING.md`, `bot.js`, `student-gate.js`, `config/admins.json`, `connect-dashboard.js`, `dashboard.html`, `desktop/index.html`, `desktop/main.js`, `desktop/preload.js`, `desktop/renderer.js`, `desktop/styles.css`, `docs/WINDOWS-APP.md`, `lib/admin-access.js`, `lib/admin-dashboard.js`, `lib/owner-claim.js`, `lib/session-data.js`, `package.json`, `test/admin-access.test.js`, `test/owner-claim.test.js`, `test/session-data.test.js`, `AI-CHANGELOG.md`
- **Behavior:** A fresh or migrated installation requires the intended owner to send a short-lived `!claim` command. The bot records usable WhatsApp identifiers automatically, never logs the claim command, and allows changing or repairing the bot account without deleting configuration.
- **Validation:**
  - `npm run check`: PASS — all application and desktop JavaScript passed syntax validation
  - `npm test`: PASS — 18 tests passed, including claim, migration, legacy-fallback denial, and session-preservation tests
  - `git diff --check`: PASS — no whitespace errors
  - Personal-identifier scan: PASS — no current-file occurrence of the removed phone number or LID outside the append-only historical ledger
  - Desktop visual QA at 1440×900: PASS — owner claim is visually prominent and readable
  - Minimum-window visual QA at 1040×680: PASS — Studio automatically focuses the required setup panel without clipping or horizontal overflow
  - Settings visual QA at 1440×900: PASS — connected account and session-reset controls are clear
  - GitHub `validate-windows` workflow: PASS — packaged Windows smoke and validation job completed successfully
  - Real WhatsApp claim and update test: NOT RUN — requires a human WhatsApp account
- **Result:** PARTIAL
- **Known limitations/follow-up:** A human must complete one real QR, claim, restart, and upgrade test before publishing the installer.
