# Project context and coding standards

> **Purpose:** Context, rules and constraints for AI agents working in this codebase.

## 1. Project context

- **Type:** Claude Code plugin (a 'mod': one hooks module, no skills, commands or MCP servers). The repo is also its own marketplace (`.claude-plugin/marketplace.json`, source `./`).
- **Language:** TypeScript, strict. The engine loads `hooks/register.ts` directly; there is no build step.
- **Runtime:** Claude Code's hooks environment: no DOM, no Node. Everything outside the module goes through `$`. Files are ES modules imported with `import` declarations (no `import()`).
- **API reference:** `vendor/claude-code.d.ts` is the plugin API as Claude Code wrote it (its first line names the version). It is early access and moves between releases; the declaration file is the authority, not memory. Refresh it from a newer Claude Code by loading the `plugin-authoring` skill and copying the `types/claude-code.d.ts` it names.
- **Package manager:** npm.

## 2. Architecture

- `hooks/title.ts`: the pure core. Building the title request, cleaning the reply, the check schedule and the per-session record transitions. No `claude-code` imports, so Vitest runs it without the engine.
- `hooks/register.ts`: the thin shell. Two hooks (`turn.complete` schedules a check, `classic.UserPromptSubmit` applies a pending title through `sessionTitle`) plus the `$.store` reads and writes. Functions that take `$` must be declared at the top of the file, or `claude plugin validate` refuses the module.
- Titles are applied through `sessionTitle` at the next prompt, never by running `/rename`, which writes the command into the conversation the model reads.
- A session title the plugin did not set means the person named the session; the record is marked `isUserNamed` and the plugin stops for that session.

## 3. Naming and file conventions

- Files: `kebab-case.ts`.
- Named exports; `register` is the hooks module's required export.
- Return types on exported functions.

## 4. Coding standards

- Prettier enforces formatting (no semicolons, single quotes, `printWidth: 100`, trailing commas). Run `npm run format`.
- Functional style: `const` arrow functions, immutable records, no classes.
- No `any`. `import type` for type-only imports.
- Comments: default to none. When one is warranted, a single JSDoc block stating the contract and at most one short why.

## 5. Tests

- `tests/*.spec.ts`: Vitest specs for `hooks/title.ts`. `npm test`.
- `tests/*.test.ts`: engine tests run by `claude plugin test .` (`npm run test:plugin`). They import from `claude-code/testing`; the test's `on` hooks stand in for the session, store and model beneath the plugin.
- Keep the two suffixes apart: Vitest only includes `*.spec.ts`, and `claude plugin test` only picks up `*.test.ts`.

## 6. Operation manual

- Install: `npm install`
- Everything: `npm run check` (typecheck, lint, format check, Vitest, validate, engine tests).
- Try it: `claude --plugin-dir .`
- Version bump: automated. Every PR carries one of `major`, `minor`, `patch` or `norelease`. On merge, the Release workflow runs `npm version`, whose `version` script syncs `.claude-plugin/plugin.json`, then tags `vX.Y.Z` and publishes a GitHub release. Claude Code updates installed copies only when `plugin.json`'s version changes, so never edit it by hand.
- Changelog: add entries under `## [Unreleased]` in `CHANGELOG.md` in each PR. The Release workflow stamps the heading on merge; don't rename it by hand.

## 7. Git commit convention

Conventional commits, sentence case, imperative mood (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`), optional scope. Subject under 72 characters; body explains why.

## 8. Do not

1. Do not use em dashes in prose or comments.
2. Do not leave `$.ui.log` debugging in shipped code beyond the existing failure log.
3. Do not add options, abstractions or fallbacks without a concrete use.
4. Do not open a PR without exactly one version label.
5. Do not ship user-visible changes without a `CHANGELOG.md` entry under `[Unreleased]`.
