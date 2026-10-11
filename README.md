# Session titler

Session titler is a Claude Code plugin that names each session after its main piece of work and updates the name when the work moves on.

I got tired of scrolling `/resume` past titles that described whatever I'd typed last ('ok and the same for zsh?') rather than what the session was for. Session titler reads the whole conversation, keeps a title that still fits, and only changes it when the main thread of work changes.

## Install

In a Claude Code terminal session (v2.1.275 or later):

```text
/plugin install session-titler --marketplace paulchiu/claude-session-titler
```

Answer `y` to add the marketplace, then pick the user scope so it runs in every project.

### Auto-update

Claude Code leaves auto-update off for third-party marketplaces. To pick up new releases automatically, run `/plugin`, open the **Marketplaces** tab, select `claude-session-titler` and choose **Enable auto-update**. Each release bumps the version in `.claude-plugin/plugin.json`, which is what Claude Code compares when it updates.

To update by hand instead:

```bash
claude plugin update session-titler@claude-session-titler
```

## How it works

After each of your prompts finishes, the plugin decides whether a check is due. It checks after the first prompt, then after prompts 2, 4, 8, 16 and every 8 prompts from there, so a new session settles on a name quickly and a long one is re-read every so often.

A check sends the model a short digest of the session: the current title, your first prompt, your 8 most recent prompts and Claude's latest reply. Engine reminders and command output are left out. The model is asked for a 3 to 7 word title naming the subject and what is being done to it, and to return the current title unchanged unless the main work has moved on.

The new title is applied when you send your next prompt, through the prompt hook's `sessionTitle` field. Running `/rename` would apply it straight away, but would also add the command and its output to the conversation Claude reads.

### Your own names win

If you name a session yourself, with `/rename` or `claude --name`, the plugin sees a title it didn't set and stops titling that session for good.

## Settings

| Option  | Default | What it does                                                                            |
| ------- | ------- | --------------------------------------------------------------------------------------- |
| `model` | `haiku` | Model that writes the titles: an alias such as `haiku` or `sonnet`, or a full model id. |

Change it from `/plugin` (**Installed**, select `session-titler`, **Configure options**).

Each check is one small request (a few thousand input tokens, a handful of output tokens). With the default model and the check schedule above, a 40-prompt session makes 8 of them.

## Limitations

- The title lands one prompt late, since it is applied at your next prompt rather than straight after the check.
- A one-shot `claude -p` run ends before there is a next prompt, so it never gets a title.
- A forked session carries over its parent's title, which the plugin reads as a name you chose, so it leaves forks alone.
- It is built on Claude Code's plugin hooks API, which is still in early access and may change between releases. CI runs the plugin's checks against the latest Claude Code to catch that early.

## Development

You need Node 24 and Claude Code.

```bash
npm install
npm run check
```

`npm run check` runs the typecheck, lint, format check, the Vitest specs for the pure core in `hooks/title.ts`, `claude plugin validate`, and the engine tests in `tests/*.test.ts` through `claude plugin test`.

To try a working copy without installing it:

```bash
claude --plugin-dir ~/path/to/claude-session-titler
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the release process.

## Licence

[MIT](LICENSE)
