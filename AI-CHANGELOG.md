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
- **Branch/PR:** `feature/in-app-whatsapp-login` / pending when this entry was written
- **Scope:** Added buffered desktop-event parsing, authentication lifecycle events, cached QR state, a guided in-app login panel/dialog, session persistence documentation, and regression tests; no command, permission, or OCR behavior changed.
- **Files:** `bot.js`, `desktop/main.js`, `desktop/renderer.js`, `desktop/index.html`, `desktop/styles.css`, `lib/desktop-events.js`, `test/desktop-events.test.js`, `package.json`, `docs/WINDOWS-APP.md`, `AI-CHANGELOG.md`
- **Behavior:** First-time users are prompted to scan a QR inside Studio; existing users reuse the LocalAuth session stored in the Windows user-data directory after restarts and version updates.
- **Validation:**
  - `npm run check`: PASS — all application and desktop JavaScript passed syntax validation
  - `npm test`: PASS — 14 tests passed, including split and multi-line desktop-event regression tests
  - `git diff --check`: PASS — no whitespace errors
  - Desktop visual QA at 1440×900: PASS — QR dialog is centered, readable, and free of clipping or overlap
  - Minimum-window visual QA at 1040×680: PASS — QR instructions and controls remain readable within the supported window
  - Packaged Windows QR login and update reuse: NOT RUN — requires the Windows workflow and a real WhatsApp account
- **Result:** PARTIAL
- **Known limitations/follow-up:** The Windows workflow must validate the packaged application. A human must complete one real WhatsApp scan and upgrade test because CI cannot authenticate a WhatsApp account.
