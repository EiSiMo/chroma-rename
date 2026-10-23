# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog v1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Each session gets a prompt bar color picked by the model to fit its subject, coordinated across open sessions so no two share one.
- `/clear` gives the session a fresh name and color at its next prompt.
- The first prompt is named before it is sent, silently through `sessionTitle`; later renames apply at the next prompt.
- The `/color` run leaves no row in the transcript: it runs once the first turn ends, and its rows are emptied as they are stored.

### Changed

- Forked from session-titler and renamed to tintname.
- Names are 1 to 3 words of lowercase kebab-case, in the chat's language, umlauts kept.
- Renames only on a clear topic switch; the model answers `KEEP` otherwise.
- Names follow what the person asks, not topics Claude's reply mentions.
- A session's color never changes once set, until `/clear`.

### Fixed

### Removed

## [0.1.2] - 2026-10-11

### Added

- A plugin icon.

### Changed

- The plugin now ships from the `plugin/` folder, so installs and the Claude directory only see the manifest, icon, hooks and engine tests, not the development files.
- The README says what the hooks change.

### Fixed

### Removed

## [0.1.1] - 2026-10-11

### Added

### Changed

### Fixed

- A `model` setting that names no model (a typo, or a display name such as `Haiku 5.5` instead of `haiku`) now shows a toast once per session instead of silently leaving sessions untitled.

### Removed

## [0.1.0] - 2026-10-11

### Added

- Names each session after its main piece of work, checking after prompts 1, 2, 4, 8, 16 and every 8 after that, and applies the title at the next prompt.
- Keeps the current title unless the main work has moved on.
- Stops titling a session once you name it yourself with `/rename` or `claude --name`.
- A `model` option for the model that writes the titles (default `haiku`).
