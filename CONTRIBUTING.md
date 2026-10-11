# Contributing to Session titler

Bug reports, ideas and pull requests are welcome. The issue tracker is at [github.com/paulchiu/claude-session-titler/issues](https://github.com/paulchiu/claude-session-titler/issues).

## Reporting bugs

Please include your Claude Code version (`claude --version`), the plugin version (`claude plugin list`), and the title you got next to the one you expected. The prompts that led to a bad title help most; trim anything private first.

## Development setup

Run `npm install`, then `claude --plugin-dir plugin` from the repo root to start a session with your working copy loaded. Saving a file under `plugin/hooks/` reloads the plugin in that session.

## Coding standards

[AGENTS.md](AGENTS.md) holds the conventions for this repo. The main ones: logic lives in `plugin/hooks/title.ts` as pure functions with Vitest specs, `plugin/hooks/register.ts` stays a thin shell over the engine, and only shipped files go in `plugin/`.

## Tests and the local gate

`npm run check` must pass before pushing. It runs the typecheck, lint, format check, Vitest specs, `claude plugin validate` and `claude plugin test`.

## Pull requests

Use a conventional commit style for the PR title (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`, with an optional scope), and keep one logical change per PR.

Every PR needs one release label: `major`, `minor`, `patch` or `norelease`. On merge to `main`, the Release workflow bumps the version in `package.json` and `plugin/.claude-plugin/plugin.json` to match, rolls the `[Unreleased]` section of `CHANGELOG.md` into the new version, tags it `vX.Y.Z` and publishes a GitHub release. Installed copies with auto-update on pick up the new version from there. `norelease` skips all of that, so use it only for changes with no effect on the plugin's behaviour.

Add user-visible changes under `## [Unreleased]` in `CHANGELOG.md` as part of the PR.

## Licence

By contributing, you agree that your contribution is licensed under this repository's MIT licence.
