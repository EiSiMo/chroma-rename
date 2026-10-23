import type { EngineInterface, Register } from 'claude-code'
import {
  DEFAULT_STYLE,
  SYSTEM_PROMPT,
  buildTitlePrompt,
  isStyle,
  type Style,
  colorRowIn,
  isColor,
  onUserColor,
  COLORS,
  availableColors,
  claimsOf,
  idleSinceOf,
  type SessionFile,
  withHolder,
  type Holders,
  isDue,
  isModelNotFound,
  onChecked,
  onClear,
  forkParent,
  onFork,
  onModelMissing,
  onPrompt,
  onRan,
  parseReply,
  pickColor,
  type Color,
  type Message,
  type SessionRecord,
} from './title.ts'

const KEY_PREFIX = 'session:'
const MAX_SESSIONS = 300
const TIMEOUT_MS = 30_000
const FIRST_TIMEOUT_MS = 6_000

const keyFor = (sessionId: string): string => `${KEY_PREFIX}${sessionId}`

const readRecord = async ($: EngineInterface, sessionId: string): Promise<SessionRecord> =>
  ((await $.store.get(keyFor(sessionId))) as SessionRecord | undefined) ?? {}

/** Every session's record, oldest first. */
const readRecords = async ($: EngineInterface): Promise<SessionRecord[]> => {
  const keys = (await $.store.keys()).filter((k) => k.startsWith(KEY_PREFIX))
  return Promise.all(
    keys.map(async (k) => ((await $.store.get(k)) as SessionRecord | undefined) ?? {}),
  )
}

/** Writes the record as the newest key, dropping the oldest sessions past `MAX_SESSIONS`. */
const writeRecord = async (
  $: EngineInterface,
  sessionId: string,
  record: SessionRecord,
): Promise<void> => {
  const key = keyFor(sessionId)
  await $.store.delete(key)
  await $.store.set(key, record)
  const sessions = (await $.store.keys()).filter((k) => k.startsWith(KEY_PREFIX))
  await Promise.all(sessions.slice(0, -MAX_SESSIONS).map((k) => $.store.delete(k)))
}

let configDir: string | undefined

/**
 * The Claude Code configuration directory, read from the environment once per
 * load: `CLAUDE_CONFIG_DIR`, else `.claude` in the home directory, which
 * Windows keeps in `USERPROFILE`. No command runs, so no shell is needed.
 */
const readConfigDir = async ($: EngineInterface): Promise<string> => {
  if (configDir !== undefined) return configDir
  const own = await $.env.get('CLAUDE_CONFIG_DIR')
  const home =
    (await $.env.get('OS')) === 'Windows_NT'
      ? await $.env.get('USERPROFILE')
      : await $.env.get('HOME')
  if (own === undefined || own === '') {
    if (home === undefined || home === '') throw new Error('no home directory')
    configDir = `${home.replace(/[\\/]+$/, '')}/.claude`
  } else {
    configDir = own
  }
  return configDir
}

type LiveSession = { readonly idleSince?: number }

/**
 * The sessions running now, by id, from the files Claude Code keeps per
 * process; `undefined` when there are none to read, so no claim is dropped.
 */
const liveSessions = async (
  $: EngineInterface,
  dir: string,
): Promise<Map<string, LiveSession> | undefined> => {
  const entries = await $.fs.list(`${dir}/sessions`).catch(() => undefined)
  if (entries === undefined) return undefined
  const sessions = await Promise.all(
    entries
      .filter((f) => f.kind === 'file' && f.name.endsWith('.json'))
      .map(async (f) => {
        try {
          const text = await $.fs.read(`${dir}/sessions/${f.name}`)
          return JSON.parse(text) as SessionFile & { sessionId?: unknown }
        } catch {
          return undefined
        }
      }),
  )
  return new Map(
    sessions.flatMap((s) =>
      typeof s?.sessionId !== 'string'
        ? []
        : [[s.sessionId, { idleSince: idleSinceOf(s) }] as const],
    ),
  )
}

const holdersPath = (dir: string, color: Color): string => `${dir}/tintname/colors/${color}.json`

/** One color's holders; a file caught mid-write is read again, a missing one holds nobody. */
const readHolders = async ($: EngineInterface, dir: string, color: Color): Promise<Holders> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const text = await $.fs.read(holdersPath(dir, color)).catch(() => undefined)
    if (text === undefined) return {}
    try {
      return JSON.parse(text) as Holders
    } catch {
      await $.clock.sleep(20)
    }
  }
  return {}
}

type Board = {
  readonly holders: Readonly<Record<Color, Holders>>
  readonly live?: Map<string, LiveSession>
}

const readBoard = async ($: EngineInterface, dir: string): Promise<Board> => {
  const live = await liveSessions($, dir)
  const holders = await Promise.all(COLORS.map((color) => readHolders($, dir, color)))
  const board = Object.fromEntries(COLORS.map((color, i) => [color, holders[i] ?? {}]))
  return {
    holders: board as Record<Color, Holders>,
    ...(live === undefined ? {} : { live }),
  }
}

const isLiveIn =
  (board: Board) =>
  (id: string): boolean =>
    board.live === undefined || board.live.has(id)

/** The colors this session may take now, given every other live session's claim. */
const colorsFor = (board: Board, sessionId: string): Color[] =>
  availableColors(
    claimsOf(board.holders, sessionId, (id) =>
      isLiveIn(board)(id) ? (board.live?.get(id) ?? {}) : undefined,
    ),
    Date.now(),
  )

const VERIFY_MS = 150
const CLAIM_ATTEMPTS = 4

/**
 * Claims a color for the session: `choose` gets the colors it may take and
 * returns its pick, or `undefined` to release its claim. Each color has a file
 * of its own; the session writes itself in, waits `VERIFY_MS` and reads it
 * back, and picks again when a session writing at the same time took its
 * place. Without a lock or a command, this runs the same on every system.
 * When the files cannot be used, the color is still picked, only unshared.
 */
const claim = async (
  $: EngineInterface,
  sessionId: string,
  choose: (available: Color[]) => Color | undefined,
): Promise<Color | undefined> => {
  try {
    const dir = await readConfigDir($)
    let color: Color | undefined
    for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
      const board = await readBoard($, dir)
      color = choose(colorsFor(board, sessionId))
      const now = Date.now()
      await Promise.all(
        COLORS.filter((c) => c === color || sessionId in board.holders[c]).map((c) =>
          $.fs.write(
            holdersPath(dir, c),
            `${JSON.stringify(withHolder(board.holders[c], sessionId, c === color, now, isLiveIn(board)), null, 2)}\n`,
          ),
        ),
      )
      if (color === undefined) return undefined
      await $.clock.sleep(VERIFY_MS)
      if (sessionId in (await readHolders($, dir, color))) return color
    }
    return color
  } catch (error) {
    $.ui.log(`color claim failed: ${String(error)}`)
    return choose([...COLORS])
  }
}

/** The colors this session may take now, for the prompt. */
const availableFor = async ($: EngineInterface, sessionId: string): Promise<Color[]> => {
  try {
    return colorsFor(await readBoard($, await readConfigDir($)), sessionId)
  } catch {
    return [...COLORS]
  }
}

type Consulted = { readonly record: SessionRecord; readonly newColor?: Color }

/**
 * Asks the model for a name and, while the session has none, a color, and
 * writes the outcome: a changed name waits in `pending` for a prompt to apply
 * it through `sessionTitle`, which adds nothing to the transcript.
 */
const consult = async (
  $: EngineInterface,
  model: string,
  style: Style,
  sessionId: string,
  messages: readonly Message[],
  turns: number,
  timeoutMs: number,
  isFresh = false,
): Promise<Consulted | undefined> => {
  const record = await readRecord($, sessionId)
  const free = await availableFor($, sessionId)
  const isColorFixed = record.isColorUserSet === true
  const current = isFresh
    ? { color: record.color, isColorFixed }
    : { name: record.pending ?? record.applied, color: record.color, isColorFixed }
  const prompt = buildTitlePrompt(messages, current, free, style)
  if (prompt === null) return undefined

  const reply = await $.model.complete({
    model,
    system: SYSTEM_PROMPT,
    prompt,
    maxTokens: 40,
    timeoutMs,
  })
  const latest = await readRecord($, sessionId)
  if (isModelNotFound(reply)) {
    const { record: checked, warning } = onModelMissing(latest, turns, model)
    await writeRecord($, sessionId, checked)
    if (warning !== undefined) $.ui.toast(warning)
    return { record: checked }
  }

  const parsed = reply.isAnswered ? parseReply(reply.text, style) : null
  if (parsed?.kind !== 'name') {
    const checked = onChecked(latest, turns, null)
    await writeRecord($, sessionId, checked)
    if (latest.color !== undefined) await claim($, sessionId, () => latest.color)
    return { record: checked }
  }

  const settled = await readRecord($, sessionId)
  const color = await claim($, sessionId, (available) =>
    settled.isColorUserSet ? settled.color : pickColor(parsed.color, settled.color, available),
  )
  const newColor =
    color !== undefined && color !== settled.color && !settled.isColorUserSet ? color : undefined
  const named = onChecked(settled, turns, parsed.name, color)
  const checked = newColor === undefined ? named : onRan(named, `color ${newColor}`)
  await writeRecord($, sessionId, checked)
  return newColor === undefined ? { record: checked } : { record: checked, newColor }
}

/** `/color` is the only way a plugin reaches the prompt bar; its rows are emptied as stored. */
const setColor = ($: EngineInterface, color: Color): void => {
  $.clock.after(0, () => {
    $.command
      .run({ command: 'color', args: color })
      .catch((error: unknown) => $.ui.log(`color failed: ${String(error)}`))
  })
}

/** The check after a turn; its name is applied at the next prompt. */
const check = async ($: EngineInterface, model: string, style: Style): Promise<void> => {
  const sessionId = await $.session.id()
  const record = await readRecord($, sessionId)
  const turns = await $.session.turns()
  if (record.isUserNamed || !isDue(turns, record.checkedAt)) return
  const consulted = await consult(
    $,
    model,
    style,
    sessionId,
    await $.session.messages(),
    turns,
    TIMEOUT_MS,
  )
  if (consulted?.newColor !== undefined) setColor($, consulted.newColor)
}

export const register: Register = (on, options) => {
  const model = typeof options.model === 'string' && options.model !== '' ? options.model : 'haiku'
  const style = isStyle(options.style) ? options.style : DEFAULT_STYLE
  let isChecking = false

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      const sessionId = await $.session.id()
      const record = await readRecord($, sessionId)
      if (record.pendingColor !== undefined) {
        await writeRecord($, sessionId, { ...record, pendingColor: undefined })
        setColor($, record.pendingColor)
      }
    }
    if (e.agentId === undefined && !e.isAborted && !isChecking) {
      isChecking = true
      $.clock.after(0, () => {
        check($, model, style)
          .catch((error: unknown) => $.ui.log(`check failed: ${String(error)}`))
          .finally(() => {
            isChecking = false
          })
      })
    }
    return result
  })

  /**
   * Empties the rows of a `/color` run this plugin made, the echo and the
   * output alike: an empty row is stored as `(no content)` and drawn as nothing.
   * A run of the person's own is kept, and its color becomes theirs: claimed
   * for them and never changed by the plugin. `default` releases the claim.
   */
  on('session.append', { door: 'command' }, async ($, e, next) => {
    const block = e.message.content[0]
    const text = block?.type === 'text' && typeof block.text === 'string' ? block.text : ''
    const row = colorRowIn(text)
    if (row === undefined) return next(e)
    const sessionId = await $.session.id()
    const record = await readRecord($, sessionId)
    const run = `color ${row.value}`
    if ((record.ran ?? []).includes(run)) {
      if (row.kind === 'output') {
        await writeRecord($, sessionId, { ...record, ran: record.ran?.filter((r) => r !== run) })
      }
      return next({ ...e, message: { ...e.message, content: [] } })
    }
    const isReset = row.kind === 'echo' && (row.value === 'default' || row.value === 'reset')
    const color = isColor(row.value) ? row.value : undefined
    if (isReset || color !== undefined || !record.isColorUserSet) {
      await writeRecord(
        $,
        sessionId,
        onUserColor(record, isReset ? undefined : (color ?? record.color)),
      )
      await claim($, sessionId, () => (isReset ? undefined : (color ?? record.color)))
    }
    return next(e)
  })

  /**
   * The first prompt is named before it is sent, so the session carries its
   * name from the start, also after `/clear`; the wait is bounded by
   * `FIRST_TIMEOUT_MS`. Without a name, the check after the turn tries again.
   * Its color waits for the turn to end: a `/color` queued mid-turn shows as a
   * preview row no hook reaches.
   */
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    const stored = await readRecord($, e.session_id)
    let { record, title } = onPrompt(stored, e.session_title)
    if (record !== stored) await writeRecord($, e.session_id, record)
    if (!record.isUserNamed && record.checkedAt === undefined) {
      const messages = [{ role: 'user', text: e.prompt }] as const
      const consulted = await consult(
        $,
        model,
        style,
        e.session_id,
        messages,
        1,
        FIRST_TIMEOUT_MS,
        true,
      )
      if (consulted !== undefined) {
        const named =
          consulted.record.pending === undefined
            ? { ...consulted.record, checkedAt: undefined }
            : consulted.record
        ;({ record, title } = onPrompt(named, e.session_title))
        if (consulted.newColor !== undefined)
          record = { ...record, pendingColor: consulted.newColor }
        await writeRecord($, e.session_id, record)
      }
    }
    return title === undefined ? result : { ...result, sessionTitle: title }
  }).catch(($, e, next) => next(e))

  /**
   * `/clear` and a fork of a session the plugin named start over; a fork
   * inherits the name and color, which would make two sessions look alike.
   * A resumed session claims its color again, since its claim lapsed when it ended.
   */
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (e.source === 'clear') {
      await writeRecord($, e.session_id, onClear(e.session_title))
      await claim($, e.session_id, () => undefined)
    } else if (e.source === 'fork') {
      const parent = forkParent(await readRecords($), e.session_title)
      if (parent !== undefined) {
        const record = onFork(parent, e.session_title)
        await writeRecord($, e.session_id, record)
        await claim($, e.session_id, () => record.color)
      }
    } else if (e.source === 'resume') {
      const { color } = await readRecord($, e.session_id)
      if (color !== undefined) await claim($, e.session_id, () => color)
    }
    return result
  }).catch(($, e, next) => next(e))
}
