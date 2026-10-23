# tintname

A plugin for the Claude Code CLI that gives every session a short name and its own prompt bar color, so your open sessions stay easy to tell apart.

![tintname names a Rust session file-line-reading in orange, then after /clear a globe session rotating-globe in blue](docs/demo.gif)

## What sets it apart

- **A color per session, not just a name.** Open sessions get different colors, so you can tell them apart at a glance.
- **Named from the first prompt.** The name is there before the first answer and changes only when the topic really does.
- **Nothing in your conversation.** Names and colors are set without adding messages Claude reads.
- **Familiar topics look familiar.** Pick up earlier work in a new session and it gets the same name and color again.
- **Your choices win.** Rename or recolor a session yourself and tintname leaves it alone.
- **Your language.** A German conversation gets a German name.
- **Runs on every system.** Linux, macOS and Windows, no extra tools.

## Install

tintname is for the Claude Code CLI in the terminal only. The desktop app and IDE extensions do not show its names and colors.

```text
/plugin install tintname --marketplace EiSiMo/tintname
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

Name a session with `/rename` and tintname leaves its name alone. Set a color with `/color` and tintname keeps it. `/clear` starts over with a fresh name and color.

## Same topic, same look

When a new session obviously continues one of your last ten, tintname gives it that session's name, and its color while no open session holds it.

## Log

tintname writes what it asked the model and what it decided to `~/.claude/tintname/tintname.log`, kept under 256 KB.

## Licence

[MIT](LICENSE)
