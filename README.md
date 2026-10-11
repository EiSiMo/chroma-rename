# Session titler

Session titler is a Claude Code plugin that names each session after its main piece of work, and renames it when the work changes.

Claude Code's own titles tend to describe the last thing I typed, so `/resume` turned into a list of follow-up questions. Session titler reads the whole conversation instead. It keeps the current title while it still fits, and only changes it when the session has clearly moved on to something else.

## Install

In a Claude Code terminal session (v2.1.275 or later):

```text
/plugin install session-titler --marketplace paulchiu/claude-session-titler
```

Answer `y` to add the marketplace, then pick the user scope so it runs in every project.

### Auto-update

Claude Code leaves auto-update off for third-party marketplaces. To pick up new releases automatically, run `/plugin`, open the Marketplaces tab, select `claude-session-titler` and choose "Enable auto-update". Each release bumps the version in `.claude-plugin/plugin.json`, which is what Claude Code compares when it updates.

To update by hand:

```bash
claude plugin update session-titler@claude-session-titler
```

## How it works

When Claude finishes replying, the plugin checks whether the title is due a review. It checks after the first prompt, then after prompts 2, 4, 8 and 16, then every 8 prompts. A new session gets a name quickly, and a long one is re-read every so often.

Each check sends the model the current title, your first prompt, your 8 most recent prompts and Claude's latest reply, with system reminders and command output stripped. The model is asked for a 3 to 7 word title naming the subject and what is being done to it, and to return the current title unchanged unless the main work has moved on.

The new title is applied when you send your next prompt, through the prompt hook's `sessionTitle` field. Running `/rename` would apply it straight away, but it would also add the command and its output to the conversation Claude reads.

### Naming a session yourself

If you name a session with `/rename` or `claude --name`, the plugin sees a title it didn't set and stops titling that session.

## Settings

| Option  | Default | What it does                                                                       |
| ------- | ------- | ---------------------------------------------------------------------------------- |
| `model` | `haiku` | Model that writes the titles: an alias such as `haiku` or `sonnet`, or a model id. |

Change it from `/plugin`: open Installed, select `session-titler`, then "Configure options". Use an alias or a model id, not the display name (`haiku`, not `Haiku 5.5`). If Claude Code can't find the model, the plugin shows a toast once per session and the session stays untitled.

Each check is one small request: a few thousand input tokens and a few output tokens. With the default model and the schedule above, a 40-prompt session makes 8 checks.

## Limitations

- The title shows up one prompt late, since it's applied at your next prompt.
- A one-shot `claude -p` run ends before a next prompt, so it never gets a title.
- A forked session carries over its parent's title, which the plugin reads as a name you chose, so it leaves forks alone.
- It uses Claude Code's plugin hooks API, which is in early access and may change between releases. CI runs the plugin's checks against the latest Claude Code to catch breaking changes.

## Development

You need Node 24 and Claude Code.

```bash
npm install
npm run check
```

`npm run check` runs the typecheck, lint, format check, the Vitest specs for `hooks/title.ts`, `claude plugin validate`, and the engine tests in `tests/*.test.ts` through `claude plugin test`.

To try a working copy without installing it:

```bash
claude --plugin-dir ~/path/to/claude-session-titler
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the release process.

## Licence

[MIT](LICENSE)
