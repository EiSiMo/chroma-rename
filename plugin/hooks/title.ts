/**
 * Pure core of tintname: what to ask the model, what to accept back, when to
 * ask, which color is free, and how a session's record moves. No `claude-code`
 * imports, so Vitest runs it without the engine.
 */

export type Message = { readonly role: 'user' | 'assistant'; readonly text: string }

/** The prompt bar colors `/color` takes. */
export const COLORS = [
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'orange',
  'pink',
  'cyan',
] as const
export type Color = (typeof COLORS)[number]

/** What tintname remembers about one session, kept in `$.store`. */
export type SessionRecord = {
  /** The name this plugin last handed to Claude Code. */
  readonly applied?: string
  /** A name computed after a turn, waiting for the next prompt to apply it. */
  readonly pending?: string
  /** A color picked at the first prompt, waiting for the turn to end to be set. */
  readonly pendingColor?: Color
  /** The color this plugin last set with `/color`. */
  readonly color?: Color
  /** The `/color` runs this plugin made, as `color <args>`, newest last. */
  readonly ran?: readonly string[]
  /** The prompt count at the last check. */
  readonly checkedAt?: number
  /** Set once the person runs `/color` themselves; the plugin then leaves the color alone. */
  readonly isColorUserSet?: boolean
  /** Set once the person names the session themselves; the plugin then stays out. */
  readonly isUserNamed?: boolean
  /** Set once the person has been told the configured model was not found. */
  readonly isModelWarned?: boolean
}

/** How names are written; the `style` setting picks one. */
export const STYLES = [
  'kebab-case',
  'snake_case',
  'camelCase',
  'PascalCase',
  'Title Case',
  'Sentence case',
  'free text',
] as const
export type Style = (typeof STYLES)[number]
export const DEFAULT_STYLE: Style = 'kebab-case'

export const isStyle = (value: unknown): value is Style =>
  (STYLES as readonly unknown[]).includes(value)

export const MAX_GAP = 8
export const MAX_WORDS = 3
export const MAX_NAME_LENGTH = 40
export const MAX_FREE_WORDS = 6
export const MAX_FREE_LENGTH = 60
export const MAX_RAN = 20

const FIRST_PROMPT_CHARS = 800
const LATER_PROMPT_CHARS = 300
const LATER_PROMPTS = 8
const REPLY_CHARS = 400

const DROPPED_BLOCKS =
  /<(system-reminder|local-command-stdout|local-command-stderr|local-command-caveat|task-notification)>[\s\S]*?<\/\1>/g
const COMMAND_NAME = /<command-name>([\s\S]*?)<\/command-name>/
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/
const TAG = /<\/?[a-z][a-z0-9-]*>/gi

export const SYSTEM_PROMPT =
  'You name Claude Code sessions and pick a color for each, so the person can tell their open sessions apart. Reply with one line only.'

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

export type Current = {
  readonly name?: string
  readonly color?: Color
  /** The color is the person's own; no new one is asked for. */
  readonly isColorFixed?: boolean
}

const capitalize = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)

/** Writes lowercase words in a style other than free text. */
export const formatWords = (words: readonly string[], style: Style): string => {
  switch (style) {
    case 'snake_case':
      return words.join('_')
    case 'camelCase':
      return words.map((w, i) => (i === 0 ? w : capitalize(w))).join('')
    case 'PascalCase':
      return words.map(capitalize).join('')
    case 'Title Case':
      return words.map(capitalize).join(' ')
    case 'Sentence case':
      return capitalize(words.join(' '))
    default:
      return words.join('-')
  }
}

const styleRules = (style: Style): string[] =>
  style === 'free text'
    ? [
        `- A short phrase of 2 to ${MAX_FREE_WORDS} words, written naturally, for example "Rewrite the parser in Rust" or "Fix login redirect".`,
        '- Write it in the language the person writes in: a German conversation gets a German name such as "Karten-Export für Berichte". Keep umlauts and other letters as they are.',
      ]
    : [
        `- 1 to ${MAX_WORDS} words in ${style}, for example "${formatWords(['rust', 'rewrite'], style)}" or "${formatWords(['login', 'redirect', 'fix'], style)}".`,
        `- Write it in the language the person writes in: a German conversation gets a German name such as "${formatWords(['karten', 'export'], style)}". Keep umlauts and other letters as they are ("${formatWords(['übersicht', 'größe'], style)}", not "${formatWords(['uebersicht', 'groesse'], style)}").`,
      ]

/**
 * The request for a name, and for a color while the session has none: the
 * rules, the current name, the colors still free, the opening prompt, the
 * most recent prompts and Claude's latest reply. Returns `null` when the
 * session holds no prompt worth naming yet.
 */
export const buildTitlePrompt = (
  messages: readonly Message[],
  current: Current,
  free: readonly Color[],
  style: Style = DEFAULT_STYLE,
): string | null => {
  const [first, ...rest] = userPrompts(messages)
  if (first === undefined) return null

  const later = rest.slice(-LATER_PROMPTS)
  const omitted = rest.length - later.length
  const reply = lastReply(messages)
  const choices = free.length > 0 ? free : COLORS

  const needsColor = current.color === undefined && current.isColorFixed !== true

  return [
    needsColor
      ? 'Reply with exactly one line: "<name> <color>".'
      : 'Reply with exactly one line: "<name>", or "KEEP" to keep the current name.',
    '',
    'Name rules:',
    ...styleRules(style),
    '- Name what the person is doing in this session, judged from their prompts. Claude\'s reply is context only: asking which tests fail is "failing-tests", not the module the answer happens to discuss.',
    '- Name the main piece of work, not the latest prompt. Side questions and follow-ups do not change the topic.',
    '- Leave out the project or repository name unless it is the subject.',
    ...(needsColor
      ? [
          '',
          'Color rules:',
          `- Pick one of: ${choices.join(', ')}.`,
          '- Pick the color that fits the name best: rust or fire is orange, a globe, sky or water is blue, plants or growth is green, errors or deletion is red, docs or writing is yellow.',
        ]
      : [
          '',
          'When to keep:',
          '- Reply "KEEP" unless the person has clearly switched to a different topic. A refinement, a next step or a detail of the same work is not a switch. When in doubt, KEEP.',
        ]),
    '',
    `Current name: ${current.name ?? '(none)'}`,
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
    ...(reply === ''
      ? []
      : ['', "Claude's latest reply (context only):", clip(reply, REPLY_CHARS)]),
  ].join('\n')
}

export const isColor = (word: string): word is Color => (COLORS as readonly string[]).includes(word)

/** Drops whole words from the end until the name fits `max`, then cuts what is left. */
const fit = (
  words: readonly string[],
  join: (w: readonly string[]) => string,
  max: number,
): string => {
  let kept = words
  while (kept.length > 1 && join(kept).length > max) kept = kept.slice(0, -1)
  return join(kept).slice(0, max)
}

/**
 * Reduces a name to the style: at most `MAX_WORDS` words, letters of any
 * script kept, or for free text the phrase as written, at most
 * `MAX_FREE_WORDS` words. `null` when nothing usable is left.
 */
export const sanitizeName = (raw: string, style: Style = DEFAULT_STYLE): string | null => {
  const text = raw.replace(/^name\s*:\s*/i, '')
  const name =
    style === 'free text'
      ? fit(
          text
            .split(/\s+/)
            .filter((w) => w !== '')
            .slice(0, MAX_FREE_WORDS),
          (w) => w.join(' '),
          MAX_FREE_LENGTH,
        )
      : fit(
          text
            .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
            .toLowerCase()
            .split(/[^\p{L}\p{N}]+/u)
            .filter((w) => w !== '')
            .slice(0, MAX_WORDS),
          (w) => formatWords(w, style),
          MAX_NAME_LENGTH,
        )
  return name.length < 3 ? null : name
}

export type Reply =
  | { readonly kind: 'keep' }
  | { readonly kind: 'name'; readonly name: string; readonly color?: Color }

/** Reads the model's line: `KEEP`, or a name in the style followed by a color, or `null`. */
export const parseReply = (raw: string, style: Style = DEFAULT_STYLE): Reply | null => {
  const line = raw
    .split('\n')
    .map((l) => l.trim().replace(/^["'`*_]+|["'`*_.]+$/g, ''))
    .find((l) => l !== '')
  if (line === undefined) return null
  if (/^keep$/i.test(line)) return { kind: 'keep' }

  const words = line.split(/\s+/)
  const last = words.at(-1)?.toLowerCase() ?? ''
  const color = isColor(last) ? last : undefined
  const name = sanitizeName((color === undefined ? words : words.slice(0, -1)).join(' '), style)
  if (name === null) return null
  return color === undefined ? { kind: 'name', name } : { kind: 'name', name, color }
}

/** The colors no other live session holds, in `COLORS` order. */
export const freeColors = (taken: readonly Color[]): Color[] =>
  COLORS.filter((c) => !taken.includes(c))

export const IDLE_SHARE_MS = 2 * 60 * 60 * 1000

/** Another live session's color, with when it went idle if it is idle now. */
export type Claim = { readonly color: Color; readonly idleSince?: number }

/**
 * The colors a session may take: the free ones, or, with every color held,
 * those of sessions idle for `IDLE_SHARE_MS` or longer, longest idle first.
 */
export const availableColors = (claims: readonly Claim[], now: number): Color[] => {
  const free = freeColors(claims.map((c) => c.color))
  if (free.length > 0) return free
  const idle = claims
    .filter((c) => c.idleSince !== undefined && now - c.idleSince >= IDLE_SHARE_MS)
    .sort((a, b) => (a.idleSince ?? 0) - (b.idleSince ?? 0))
    .map((c) => c.color)
  return idle.filter((c, i) => idle.indexOf(c) === i)
}

/** Who holds one color, kept in that color's file: session id to when it took the color. */
export type Holders = Readonly<Record<string, number>>

export const MAX_HOLDERS = 16

/**
 * One color's holders after the session takes it (`isHolding`) or lets it go:
 * sessions `isLive` rejects dropped, the newest `MAX_HOLDERS` kept.
 */
export const withHolder = (
  holders: Holders,
  sessionId: string,
  isHolding: boolean,
  now: number,
  isLive: (id: string) => boolean,
): Holders => {
  const others = Object.entries(holders).filter(
    ([id, at]) => id !== sessionId && typeof at === 'number' && isLive(id),
  )
  const kept = isHolding ? [...others, [sessionId, holders[sessionId] ?? now] as const] : others
  return Object.fromEntries([...kept].sort((a, b) => a[1] - b[1]).slice(-MAX_HOLDERS))
}

/** The claims of every live session but `sessionId`, read from each color's holders. */
export const claimsOf = (
  board: Readonly<Partial<Record<Color, Holders>>>,
  sessionId: string,
  live: (id: string) => { readonly idleSince?: number } | undefined,
): Claim[] =>
  COLORS.flatMap((color) =>
    Object.keys(board[color] ?? {}).flatMap((id) => {
      const session = id === sessionId ? undefined : live(id)
      return session === undefined ? [] : [{ color, ...session }]
    }),
  )

/**
 * The color to show: once set it stays, until `/clear`. A new session gets
 * the wanted color if free, else the first free one; with every color taken,
 * the wanted one is shared.
 */
export const pickColor = (
  wanted: Color | undefined,
  current: Color | undefined,
  free: readonly Color[],
): Color | undefined => {
  if (current !== undefined) return current
  if (wanted !== undefined && free.includes(wanted)) return wanted
  return free[0] ?? wanted
}

/**
 * Whether a check is due after `turns` prompts. The first prompt is checked,
 * then the gap doubles (1, 2, 4, 8, 16, ...) up to `MAX_GAP`.
 */
export const isDue = (turns: number, checkedAt: number | undefined): boolean =>
  turns >= 1 && (checkedAt === undefined || turns - checkedAt >= Math.min(checkedAt, MAX_GAP))

export type PromptOutcome = { readonly record: SessionRecord; readonly title?: string }

/**
 * Settles a prompt against the record. A custom title this plugin did not set
 * means the person named the session, which ends the plugin's work on it;
 * otherwise a pending name is handed over for the prompt to apply.
 */
export const onPrompt = (
  record: SessionRecord,
  sessionTitle: string | undefined,
): PromptOutcome => {
  if (record.isUserNamed) return { record }
  if (sessionTitle !== undefined && sessionTitle !== record.applied) {
    return { record: { ...record, isUserNamed: true, pending: undefined } }
  }
  if (record.pending === undefined || record.pending === sessionTitle) {
    return { record: record.pending === undefined ? record : { ...record, pending: undefined } }
  }
  return {
    record: { ...record, applied: record.pending, pending: undefined },
    title: record.pending,
  }
}

/**
 * The record after `/clear`: a fresh start, except that the title the session
 * still shows counts as the plugin's, so the next name replaces it.
 */
export const onClear = (sessionTitle: string | undefined): SessionRecord =>
  sessionTitle === undefined ? {} : { applied: sessionTitle }

/**
 * The record a fork came from: the newest one whose name the plugin applied
 * and the fork inherited. `undefined` when the person named it, or no name came along.
 */
export const forkParent = (
  records: readonly SessionRecord[],
  sessionTitle: string | undefined,
): SessionRecord | undefined =>
  sessionTitle === undefined || sessionTitle === ''
    ? undefined
    : [...records].reverse().find((r) => !r.isUserNamed && r.applied === sessionTitle)

/**
 * The record of a fork of `parent`: a fresh start like `/clear`, so the fork
 * gets its own name and color, except that a color the person set stays theirs.
 */
export const onFork = (parent: SessionRecord, sessionTitle: string | undefined): SessionRecord => ({
  ...onClear(sessionTitle),
  ...(parent.isColorUserSet ? { isColorUserSet: true, color: parent.color } : {}),
})

/** Records a finished check at `turns` prompts, with the name and color it settled on. */
export const onChecked = (
  record: SessionRecord,
  turns: number,
  name: string | null,
  color?: Color,
): SessionRecord => ({
  ...record,
  checkedAt: turns,
  pending: name !== null && name !== record.applied ? name : undefined,
  ...(color === undefined ? {} : { color }),
})

/** The parts of a model reply that say why it failed, if it did. */
export type ReplyStatus = {
  readonly isAnswered: boolean
  readonly reason?: string
  readonly error?: string
}

/** Whether the reply failed because the API does not know the model asked for. */
export const isModelNotFound = (reply: ReplyStatus): boolean =>
  !reply.isAnswered && reply.reason === 'api-error' && reply.error === 'model_not_found'

export type CheckOutcome = { readonly record: SessionRecord; readonly warning?: string }

/**
 * Records a check whose model was not found. The warning is given once per
 * session, since every later check fails the same way until the setting changes.
 */
export const onModelMissing = (
  record: SessionRecord,
  turns: number,
  model: string,
): CheckOutcome => ({
  record: { ...onChecked(record, turns, null), isModelWarned: true },
  ...(record.isModelWarned
    ? {}
    : {
        warning: `tintname: model "${model}" not found; check its Configure options in /plugin`,
      }),
})

/** Notes a command run, so its transcript rows can be hidden; keeps the newest `MAX_RAN`. */
export const onRan = (record: SessionRecord, run: string): SessionRecord => ({
  ...record,
  ran: [...(record.ran ?? []).filter((r) => r !== run), run].slice(-MAX_RAN),
})

const COLOR_ECHO =
  /^<command-name>\/color<\/command-name>[\s\S]*?(?:<command-args>([^<]*)<\/command-args>|$)/
const COLOR_OUTPUT = /^<local-command-stdout>Session color set to: ([a-z]+)<\/local-command-stdout>/

/** A stored row of a `/color` run: the echo with its arguments, or the output with its color. */
export type ColorRow = { readonly kind: 'echo' | 'output'; readonly value: string }

/** Reads a stored row as part of a `/color` run, or `undefined` for any other row. */
export const colorRowIn = (text: string): ColorRow | undefined => {
  const echo = COLOR_ECHO.exec(text)
  if (echo !== null) return { kind: 'echo', value: (echo[1] ?? '').trim().toLowerCase() }
  const output = COLOR_OUTPUT.exec(text)
  return output === null ? undefined : { kind: 'output', value: output[1] ?? '' }
}

/**
 * The record after the person ran `/color` themselves: their color, or none
 * for `default`, and the plugin's own pending color dropped.
 */
export const onUserColor = (record: SessionRecord, color: Color | undefined): SessionRecord => ({
  ...record,
  isColorUserSet: true,
  pendingColor: undefined,
  color,
})
