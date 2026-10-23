# chroma-rename

A plugin for the Claude Code CLI that gives every session a short name and its own prompt bar color, so your open sessions stay easy to tell apart. Install, settings and more: [github.com/EiSiMo/chroma-rename](https://github.com/EiSiMo/chroma-rename).

## What chroma-rename writes, runs and hooks

### Files it writes

- `~/.claude/chroma-rename/chroma-rename.log`: what chroma-rename asked the model and what it decided, kept under 256 KB by dropping the oldest lines.
- `~/.claude/chroma-rename/colors/<color>.json`: one file per color, listing the open sessions that hold it, so two sessions never share a color.
- Each session's name and color, in the plugin store Claude Code keeps for chroma-rename under `~/.claude`.

With `CLAUDE_CONFIG_DIR` set, these sit under that directory instead of `~/.claude`. chroma-rename writes no build, settings or instruction files, and nothing in your project.

### Commands it runs

Only `/color <color>`, after a turn ends, to set the prompt bar color. It runs no shell commands and no other slash commands. Names are set through the prompt hook's session title, not `/rename`.

### Hooks and what they change

- `classic.UserPromptSubmit`: reads the first prompt to pick a name and applies a waiting name as the session title. The prompt itself is never changed or blocked.
- `turn.complete`: after a turn, asks the model whether the name still fits and runs a waiting `/color`.
- `session.append` (door `command`): empties only the rows of `/color` runs chroma-rename made itself. Your own `/color` runs stay as they are, and their color is kept as yours.
- `classic.SessionStart`: starts over on `/clear` and forks, takes the color back on resume, and clears the color claims of sessions that no longer run.
- `session.end`: releases the session's color.

Every hook passes its event on unchanged when it fails. chroma-rename never changes permission decisions, permission mode, settings or Remote Control.

## Licence

[MIT](https://github.com/EiSiMo/chroma-rename/blob/main/LICENSE)
