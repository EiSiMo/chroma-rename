# chroma-rename

A plugin for the Claude Code CLI that gives every session a short name and its own prompt bar color, so your open sessions stay easy to tell apart.

![chroma-rename names a Rust session file-line-reading in orange, then after /clear a globe session rotating-globe in blue](docs/demo.gif)

## What sets it apart

- **A color per session, not just a name.** Open sessions get different colors, so you can tell them apart at a glance.
- **Named from the first prompt.** The name is there before the first answer and changes only when the topic really does.
- **Nothing in your conversation.** Names and colors are set without adding messages Claude reads.
- **Familiar topics look familiar.** Pick up earlier work in a new session and it gets the same name and color again.
- **Your choices win.** Rename or recolor a session yourself and chroma-rename leaves it alone.
- **Your naming style.** kebab-case, snake_case, camelCase, PascalCase, Title Case, Sentence case or free text, as you choose.
- **Runs on every system.** Linux, macOS and Windows, no extra tools.

## Install

chroma-rename is for the Claude Code CLI in the terminal only. The desktop app and IDE extensions do not show its names and colors.

```text
/plugin install chroma-rename --marketplace EiSiMo/chroma-rename
```

Pick the user scope so it runs in every project. If you use `session-titler`, turn it off.

## Settings

Change these under the plugin's Configure options in `/plugin`.

| Option  | Default      | What it does                           |
| ------- | ------------ | -------------------------------------- |
| `style` | `kebab-case` | How names are written, see below.      |
| `model` | `haiku`      | The model that picks names and colors. |

Styles: `kebab-case`, `snake_case`, `camelCase`, `PascalCase`, `Title Case`, `Sentence case` and `free text`, a short natural phrase.

## Your own name or color

Name a session with `/rename` and chroma-rename leaves its name alone. Set a color with `/color` and chroma-rename keeps it. `/clear` starts over with a fresh name and color.

## Same topic, same look

When a new session obviously continues one of your last ten, chroma-rename gives it that session's name, and its color while no open session holds it. A session you renamed is offered under your name, written as you wrote it.

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

## Privacy

chroma-rename runs only on your computer. It sends your conversation to Claude through Claude Code to pick a name, stores no prompts and shares nothing with anyone. See the [privacy policy](https://github.com/EiSiMo/chroma-rename/blob/main/PRIVACY.md).

## Licence

[MIT](LICENSE)
