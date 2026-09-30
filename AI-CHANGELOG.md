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
