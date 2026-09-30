# Repository instructions for AI agents

This file is the canonical instruction set for every AI coding agent working in this repository. Read it before planning, editing, reviewing, committing, or releasing. If another agent-specific file conflicts with this file, this file wins unless a human maintainer explicitly says otherwise.

## 1. Mission

Maintain **WhatsApp Admin Studio** as a reliable Windows desktop control center and preserve the classic CLI edition. Make the smallest complete change that solves the stated problem. Do not trade working behavior for a broad rewrite, visual novelty, or speculative architecture.

## 2. Non-negotiable product invariants

- OCR is a core feature. Do not remove or silently weaken Arabic/English OCR, Tesseract language data, the required OCR engines, or current fallbacks without explicit maintainer approval.
- Keep `classic-cli` available as the preserved command-line edition. Desktop work belongs on `main` and its feature branches.
- Only one Studio/bot-host lifecycle may run at a time. Preserve restart serialization, process cleanup, and message-event deduplication.
- Commands and replies must respect the configured owner/admin/moderator/member permissions.
- Existing user configuration and local data must continue to load after an update, or a documented migration must be supplied.
- Never commit WhatsApp sessions, credentials, phone lists, national IDs, databases, logs containing personal data, or local runtime configuration.

## 3. Repository map

Inspect the current tree before relying on this summary.

- `desktop/`: Electron desktop application, UI, lifecycle, packaging, and assets.
- `lib/`: reusable bot/runtime modules.
- `config/`: safe defaults and configuration examples.
- `ocr/`: OCR workers, models, scripts, and related support files.
- `.github/workflows/`: validation, packaging, and release automation.
- `README.md`: public project landing page.
- `docs/WINDOWS-APP.md`: desktop installation and operating guide.
- `BOT-UNDERSTANDING.md`: behavior and architecture notes.
- `AI-CHANGELOG.md`: append-only record of AI-assisted changes and validation.

If the tree differs, update this map in the same pull request.

## 4. Required workflow

### Before editing

1. Read this file, the latest entries in `AI-CHANGELOG.md`, and the documentation relevant to the task.
2. Inspect the implementation and its callers. Do not infer behavior from filenames or screenshots alone.
3. Check recent commits, issues, and pull requests when they may explain an existing workaround or regression.
4. State the smallest functional scope and its verification plan.
5. Reuse existing patterns, dependencies, components, and terminology before introducing new ones.

### While editing

- Keep one pull request focused on one functional outcome.
- Avoid unrelated cleanup, mass formatting, file renames, or opportunistic refactors.
- Modify the smallest coherent surface. Do not rewrite a working module merely to match a preferred style.
- Keep source, tests, documentation, schemas, and examples synchronized.
- Preserve backward compatibility unless the maintainer explicitly approves a breaking change.
- Never claim that code, UI, a package, or a workflow works without performing the required validation.
- If a requirement is ambiguous and choosing wrongly could lose data or change behavior, ask before implementing.

### Before finishing

1. Review the complete diff for accidental, generated, personal, or secret data.
2. Run the applicable checks in section 9.
3. Update user-facing documentation when behavior, setup, configuration, or packaging changes.
4. Append an honest entry to `AI-CHANGELOG.md` using section 11.
5. Report failures, skipped checks, and known limitations explicitly.

## 5. Change discipline

- Do not add or replace a production dependency without maintainer approval. Document the runtime, installer-size, licensing, maintenance, and security impact.
- Do not use `npm audit fix --force` or make unrelated dependency upgrades.
- Do not hand-edit generated artifacts. Regenerate them from their source:
  - `package-lock.json` through npm.
  - desktop icons/assets through the repository asset script.
  - installers, checksums, and releases through the documented workflow.
- Do not commit `node_modules`, build output, unpacked applications, local databases, authentication sessions, or ad-hoc test media.
- Do not disable a failing test, validation rule, deduplication guard, or safety check merely to make CI green.
- Do not hide errors with empty catch blocks, unconditional success states, or fabricated fallback data.
- Do not leave dead code, commented-out alternatives, placeholder TODOs, or speculative abstractions.

## 6. Code rules

- Follow the repository's existing Node.js/CommonJS conventions and supported Node version.
- Prefer clear functions with explicit inputs, outputs, and failure behavior.
- Validate external input at boundaries. Normalize phone numbers, command names, paths, and persisted settings once.
- Treat process control and message handling as concurrent systems: use idempotent operations, bounded waits, cleanup, deduplication, and clear terminal states.
- Keep event listeners balanced. Prevent duplicate registration across reloads, reconnects, and restarts.
- Preserve atomic writes and recovery behavior for user configuration.
- Log actionable context without secrets or personal message content. Do not swallow the original error.
- Comments explain **why** a non-obvious constraint exists, not what the next line does.
- Extract a module only when it has a stable responsibility; do not create layers that only rename existing calls.

## 7. UI and copy rules: avoid generic “AI-made” output

The existing Admin Studio visual language is the source of truth.

- Use the current typography, spacing scale, colors, navigation, form controls, and card treatment. Do not introduce a second design system.
- Prefer hierarchy, alignment, whitespace, and borders before decoration.
- Avoid gratuitous gradients, glass effects, glowing shadows, excessive pills, oversized hero text, nested cards, emoji as interface icons, and decorative charts with no operational value.
- Do not add placeholder metrics, fake activity, sample administrators, or controls that do not perform their advertised action. Hide unfinished features.
- Keep copy short, specific, and human. Avoid generic marketing phrases such as “revolutionary,” “powerful,” “seamless,” “next-generation,” and similar filler.
- Use one term consistently for each concept. Match the wording already used in the application and documentation.
- Every state-changing action needs visible success/failure feedback. Destructive actions need a clear confirmation and consequence.
- Preserve keyboard access, visible focus, readable contrast, labels, error text, and practical hit targets.
- Check long names, empty states, error states, loading states, and narrow windows—not only the happy path.
- Visually inspect the real rendered UI at approximately 1360×860 and at the supported narrow-window size. A code-only review is not visual QA.

## 8. OCR-specific rules

- Treat Arabic and English recognition as release-critical.
- Keep required language/model files packaged and verify their installed paths, not only development paths.
- Preserve the documented primary engine and fallback behavior.
- Test at least one Arabic sample, one English sample, and one failure/unsupported-input path when OCR code or packaging changes.
- Record accuracy tradeoffs and installer-size changes. Do not call a smaller package “slim” if it removes the promised OCR capability.

## 9. Validation matrix

Run the strongest applicable level. A lower level never substitutes for a required higher level.

### Documentation or instruction-only change

- `git diff --check`
- Verify referenced paths and commands against the current repository.

### JavaScript behavior or configuration change

- `npm run check`
- `npm test`
- Add or update a regression test for the changed behavior where practical.

### Desktop lifecycle, packaging, dependency, restart, or OCR change

- Run the JavaScript checks above.
- Run or trigger the Windows validation workflow.
- Verify the packaged application launches, stops, restarts, and exits without orphan processes.
- For OCR changes, run the OCR checks in section 8.

### UI change

- Run applicable automated checks.
- Capture and inspect desktop and narrow-window screenshots.
- Exercise every changed control and relevant empty/loading/error state.

### Release

- All required pull-request validation must pass.
- Verify installer launch, first-run behavior, restart, shutdown, OCR files, and one functional OCR sample.
- Confirm package version and lockfile version match.
- Generate and publish the checksum with the installer.
- Use semantic versioning. Keep early releases in the `0.x` series until the maintainer declares a stable `1.0.0`.

Record each check as `PASS`, `FAIL`, or `NOT RUN` with a reason. Never convert `NOT RUN` into “passed.”

## 10. Pull request and release expectations

- Use a descriptive branch and commit message.
- Explain the problem, the chosen fix, user-visible effects, and exact validation.
- Keep generated binaries out of normal commits; publish them as release assets.
- Do not merge a functional change with required checks failing.
- Do not create duplicate releases or rerun publication without checking existing tags and assets.
- Keep release notes concise and include known limitations such as unsigned Windows installer warnings when applicable.

## 11. Mandatory AI change ledger

Every AI-assisted change must append one entry to `AI-CHANGELOG.md` in the same pull request. The ledger is append-only. Do not rewrite prior entries; correct a factual error with a new dated correction.

Use this template:

```markdown
## YYYY-MM-DD — Short change title

- **Agent/tool:** Name and model/tool when known
- **Request:** One-sentence user goal
- **Branch/PR:** Branch name and PR number or `not created`
- **Scope:** What changed and what intentionally did not
- **Files:** List of changed paths
- **Behavior:** User-visible or runtime effect
- **Validation:**
  - `command or manual check`: PASS | FAIL | NOT RUN — evidence or reason
- **Result:** SUCCESS | PARTIAL | FAILED
- **Known limitations/follow-up:** `None` or a concrete item
```

Rules for the ledger:

- Include failed attempts that changed the implementation direction, generated an artifact, or revealed a defect.
- Never fabricate commands, screenshots, CI results, reviews, or test output.
- A successful commit with incomplete required validation is `PARTIAL`, not `SUCCESS`.
- Do not paste secrets, tokens, phone numbers, personal messages, or large logs.
- Keep each entry factual and concise.

## 12. Definition of done

A change is done only when it is scoped, implemented, reviewed against these instructions, validated at the required level, documented, free of secret/personal data, and recorded in `AI-CHANGELOG.md`. “Code was written” is not done.

## 13. Compatibility files

`CLAUDE.md`, `GEMINI.md`, and `.github/copilot-instructions.md` only route other assistants to this canonical file. Keep them short and non-conflicting. Put durable repository rules here.

## 14. References used to build these rules

These rules synthesize, rather than copy, guidance from:

- OpenAI Codex guidance for `AGENTS.md`: https://developers.openai.com/codex/guides/agents-md
- The open `AGENTS.md` convention: https://agents.md/
- GitHub Copilot repository instructions: https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions
- Anthropic Claude Code memory files: https://docs.anthropic.com/en/docs/claude-code/memory
- Established repository patterns: focused PRs, exact verification commands, generated-file warnings, and explicit completion criteria.
