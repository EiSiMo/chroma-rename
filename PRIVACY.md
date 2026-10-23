# Privacy policy

chroma-rename is a Claude Code plugin that runs entirely on your computer. It has no server of its own and collects nothing for its author.

## What it reads

To pick a name, it reads your prompts and the conversation of the current session and sends them to Claude through Claude Code, using the model set in its options. That request goes nowhere else and is handled under the terms you already have with Anthropic or your Claude Code provider.

## What it stores

Only on your computer, under the Claude Code configuration directory (`~/.claude` or `CLAUDE_CONFIG_DIR`):

- each session's short name and color, in the plugin store Claude Code keeps for chroma-rename;
- which open sessions hold which color, in `chroma-rename/colors/`;
- a log of the names and colors it picked, in `chroma-rename/chroma-rename.log`, kept under 256 KB.

It stores no prompts and no conversation text. A name can contain a word from the conversation, such as a person's name the session is about.

## What it shares

Nothing. It sends no data to its author or to any third party, and it does no tracking or analytics.

## Deleting your data

Uninstall the plugin and delete the `chroma-rename` folder in the configuration directory.

## Contact

Open an issue at [github.com/EiSiMo/chroma-rename](https://github.com/EiSiMo/chroma-rename/issues).
