# tintname

tintname is a Claude Code plugin that gives every session a short kebab-case name and its own prompt bar color, so a handful of open sessions stay easy to tell apart.

It started as a fork of [paulchiu/claude-session-titler](https://github.com/paulchiu/claude-session-titler) and keeps its scheduling and hooks, with these changes:

- Names are 1 to 3 words of lowercase kebab-case (`rust-rewrite`, `karten-export`), in the language the chat is in.
- The model also picks a color that fits the subject: a Rust rewrite is orange, a globe feature is blue.
- Open sessions share their colors through one file, so no two live sessions get the same one. When all 8 are taken, the wanted color is shared.
- Renaming is conservative: the model answers `KEEP` unless the session has clearly switched topics.
- `/clear` starts over: the color resets to default, the color claim is released, and the next prompt names the session afresh.

## Install

```text
/plugin install tintname --marketplace EiSiMo/tintname
```

Pick the user scope so it runs in every project. Turn off `session-titler` if you had it, or both will name your sessions.

## How it works

When Claude finishes replying, the plugin checks whether the name is due a review: after the first prompt, then after prompts 2, 4, 8 and 16, then every 8 prompts.

Each check sends the model (Haiku by default) the current name and color, the colors still free, your first prompt, your 8 most recent prompts and Claude's latest reply. It answers with one line, `<name> <color>` or `KEEP`.

The name is applied at your next prompt through the prompt hook's `sessionTitle` field, which adds nothing to the conversation. The color is set right away by running `/color <color>`, the only way a plugin can reach the prompt bar; that command's short output line does land in the transcript.

Colors are coordinated through `~/.claude/tintname/colors.json` (session id to color). A claim counts only while its session is listed in `~/.claude/sessions/`, so ended or cleared sessions free their color by themselves.

### Naming a session yourself

If you name a session with `/rename` or `claude --name`, the plugin sees a title it didn't set and stops for that session.

## Settings

| Option  | Default | What it does                                                                       |
| ------- | ------- | ---------------------------------------------------------------------------------- |
| `model` | `haiku` | Model that writes names and picks colors: an alias such as `haiku`, or a model id. |

## Limitations

- The name shows up one prompt late, since it's applied at your next prompt.
- Two sessions checking in the same instant can pick the same color; the next rename sorts it out.
- A color you set by hand with `/color` is not known to other sessions.
- It uses Claude Code's plugin hooks API, which is in early access and may change between releases.

## Development

You need Node 24 and Claude Code.

```bash
npm install
npm run check
```

`npm run check` runs the typecheck, lint, format check, the Vitest specs in `tests/`, `claude plugin validate` for the plugin and the marketplace, and the engine tests in `plugin/tests/` through `claude plugin test`.

To try a working copy without installing it:

```bash
claude --plugin-dir ~/path/to/claude-tintname/plugin
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the release process.

## Licence

[MIT](LICENSE)
