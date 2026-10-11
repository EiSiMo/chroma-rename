/**
 * Pure core of the titler: what to ask the model, what to accept back, when to
 * ask, and how a session's record moves. No `claude-code` imports, so Vitest
 * runs it without the engine.
 */

export type Message = { readonly role: 'user' | 'assistant'; readonly text: string }

/** What the titler remembers about one session, kept in `$.store`. */
export type SessionRecord = {
  /** The title this plugin last handed to Claude Code. */
  readonly applied?: string
  /** A title computed after a turn, waiting for the next prompt to apply it. */
  readonly pending?: string
  /** The prompt count at the last check. */
  readonly checkedAt?: number
  /** Set once the person names the session themselves; the titler then stays out. */
  readonly isUserNamed?: boolean
}

export const MAX_GAP = 8
export const MAX_TITLE_LENGTH = 60

const FIRST_PROMPT_CHARS = 800
const LATER_PROMPT_CHARS = 300
const LATER_PROMPTS = 8
const REPLY_CHARS = 800

const DROPPED_BLOCKS =
  /<(system-reminder|local-command-stdout|local-command-stderr|local-command-caveat|task-notification)>[\s\S]*?<\/\1>/g
const COMMAND_NAME = /<command-name>([\s\S]*?)<\/command-name>/
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/
const TAG = /<\/?[a-z][a-z0-9-]*>/gi

export const SYSTEM_PROMPT =
  'You title Claude Code sessions so the person can find them again in a session list. Reply with the title only.'

/**
 * Turns a user row into the words the person typed: engine reminders and
 * command output dropped, a slash command's record collapsed to `/name args`.
 */
export const cleanPrompt = (text: string): string => {
  const withoutBlocks = text.replace(DROPPED_BLOCKS, '')
  const name = COMMAND_NAME.exec(withoutBlocks)?.[1]
  const typed =
    name === undefined
      ? withoutBlocks.replace(TAG, '')
      : `${name} ${COMMAND_ARGS.exec(withoutBlocks)?.[1] ?? ''}`
  return typed.replace(/\s+/g, ' ').trim()
}

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`

/** The prompts the person typed, oldest first, with empty and repeated rows dropped. */
export const userPrompts = (messages: readonly Message[]): string[] =>
  messages
    .filter((m) => m.role === 'user')
    .map((m) => cleanPrompt(m.text))
    .filter((text, i, all) => text !== '' && all.indexOf(text) === i)

const lastReply = (messages: readonly Message[]): string =>
  [...messages].reverse().find((m) => m.role === 'assistant' && m.text.trim() !== '')?.text ?? ''

/**
 * The request for a title: the rules, the current title, the opening prompt,
 * the most recent prompts and Claude's latest reply. Returns `null` when the
 * session holds no prompt worth titling yet.
 */
export const buildTitlePrompt = (
  messages: readonly Message[],
  currentTitle: string | undefined,
): string | null => {
  const [first, ...rest] = userPrompts(messages)
  if (first === undefined) return null

  const later = rest.slice(-LATER_PROMPTS)
  const omitted = rest.length - later.length
  const reply = lastReply(messages)

  return [
    'Rules:',
    '- 3 to 7 words, sentence case, no quotes, no trailing punctuation, no em dashes.',
    '- Name the main piece of work: its subject and what is being done to it, for example "Status line prompt cache countdown" or "Fix Toggle burn retry on timeout".',
    '- Describe the whole session, not only the latest prompt. Side questions and follow-ups do not change the topic.',
    '- Keep identifiers that anchor the work: ticket keys, PR numbers, package names.',
    '- Leave out the project or repository name unless it is the subject; the session list already shows it.',
    '- If the current title still fits, reply with it unchanged. Change it only when the main work has clearly moved on.',
    '',
    `Current title: ${currentTitle ?? '(none)'}`,
    '',
    'First prompt:',
    clip(first, FIRST_PROMPT_CHARS),
    ...(later.length === 0
      ? []
      : [
          '',
          omitted > 0
            ? `Latest prompts, oldest first (${omitted} earlier omitted):`
            : 'Later prompts, oldest first:',
          ...later.map((p) => `- ${clip(p, LATER_PROMPT_CHARS)}`),
        ]),
    ...(reply === '' ? [] : ['', "Claude's latest reply:", clip(reply, REPLY_CHARS)]),
  ].join('\n')
}

/**
 * Reduces a model reply to a usable title, or `null` when nothing usable is
 * left. Em and en dashes become hyphens; a long title is cut at a word.
 */
export const sanitizeTitle = (raw: string): string | null => {
  const line = raw
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '')
  if (line === undefined) return null

  const title = line
    .replace(/^title\s*:\s*/i, '')
    .replace(/^["'`*_]+|["'`*_]+$/g, '')
    .replace(/\s*[–—]\s*/g, ' - ')
    .replace(/[.!?;:,]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (title.length < 3) return null
  if (title.length <= MAX_TITLE_LENGTH) return title

  const cut = title.slice(0, MAX_TITLE_LENGTH + 1)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut.slice(0, MAX_TITLE_LENGTH)).trim()
}

/**
 * Whether a check is due after `turns` prompts. The first prompt is checked,
 * then the gap doubles (1, 2, 4, 8, 16, ...) up to `MAX_GAP`, so a young
 * session settles quickly and a long one is re-read every few prompts.
 */
export const isDue = (turns: number, checkedAt: number | undefined): boolean =>
  turns >= 1 && (checkedAt === undefined || turns - checkedAt >= Math.min(checkedAt, MAX_GAP))

export type PromptOutcome = { readonly record: SessionRecord; readonly title?: string }

/**
 * Settles a prompt against the record. A custom title this plugin did not set
 * means the person named the session, which ends the titler's work on it;
 * otherwise a pending title is handed over for the prompt to apply.
 */
export const onPrompt = (
  record: SessionRecord,
  sessionTitle: string | undefined,
): PromptOutcome => {
  if (record.isUserNamed) return { record }
  if (sessionTitle !== undefined && sessionTitle !== record.applied) {
    return { record: { isUserNamed: true } }
  }
  if (record.pending === undefined || record.pending === sessionTitle) {
    return { record: { ...record, pending: undefined } }
  }
  return { record: { applied: record.pending, checkedAt: record.checkedAt }, title: record.pending }
}

/** Records a finished check at `turns` prompts and the title it produced, if any. */
export const onChecked = (
  record: SessionRecord,
  turns: number,
  title: string | null,
): SessionRecord => ({
  ...record,
  checkedAt: turns,
  pending: title !== null && title !== record.applied ? title : undefined,
})
