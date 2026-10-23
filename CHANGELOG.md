# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog v1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- A new session that obviously continues one of the last ten sessions gets its name and color again.
- A log of what tintname asked and decided, in `tintname/tintname.log` under the config directory, kept under 256 KB.

### Changed

### Fixed

### Removed

## [0.2.2] - 2026-10-23

### Added

### Changed

### Fixed

- A session that crashed no longer holds its color for good: once its file has gone 2 hours without an update, its color can be shared like an idle session's.

### Removed

## [0.2.1] - 2026-10-23

### Added

### Changed

### Fixed

- Works on Windows: the plugin no longer runs `sh`, `mkdir` or `rmdir`. Colors are shared through one small file per color instead of a locked file.

### Removed

## [0.2.0] - 2026-10-23

### Added

- A `style` setting for how names are written: kebab-case, snake_case, camelCase, PascalCase, Title Case, Sentence case or free text.
- A `/color` you run yourself is respected: the plugin claims that color for the session and never changes it.
- The colors file is written under a lock, so sessions starting together never pick the same color.
- With all 8 colors held, a new session shares the color of a session idle for 2 hours or more.
- Each session gets a prompt bar color picked by the model to fit its subject, coordinated across open sessions so no two share one.
- `/clear` gives the session a fresh name and color at its next prompt.
- The first prompt is named before it is sent, silently through `sessionTitle`; later renames apply at the next prompt.
- The `/color` run leaves no row in the transcript: it runs once the first turn ends, and its rows are emptied as they are stored.

### Changed

- The README covers only install, settings and how to keep your own name or color.
- Forked from session-titler and renamed to tintname.
- Names are 1 to 3 words of lowercase kebab-case, in the chat's language, umlauts kept.
- Renames only on a clear topic switch; the model answers `KEEP` otherwise.
- Names follow what the person asks, not topics Claude's reply mentions.
- A session's color never changes once set, until `/clear`.

### Fixed

- A name that starts with "keep", such as `keep-alive-fix`, is no longer read as `KEEP`.
- A forked session gets its own name and color instead of keeping its parent's; a color the person set on the parent stays.
- A resumed session claims its color again, so a session started meanwhile does not take the same one.

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
