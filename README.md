# tintname

A Claude Code plugin that gives every session a short name and its own prompt bar color, so your open sessions stay easy to tell apart.

![tintname names a Rust session file-line-reading in orange, then after /clear a globe session rotating-globe in blue](docs/demo.gif)

## Install

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

## Licence

[MIT](LICENSE)
