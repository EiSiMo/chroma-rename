# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog v1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

### Changed

### Fixed

### Removed

## [0.1.0] - 2026-10-11

### Added

- Names each session after its main piece of work, checking after prompts 1, 2, 4, 8, 16 and every 8 after that, and applies the title at the next prompt.
- Keeps the current title unless the main work has moved on.
- Stops titling a session once you name it yourself with `/rename` or `claude --name`.
- A `model` option for the model that writes the titles (default `haiku`).
