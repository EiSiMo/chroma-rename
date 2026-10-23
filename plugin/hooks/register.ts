import type { EngineInterface, Register } from 'claude-code'
import {
  SYSTEM_PROMPT,
  buildTitlePrompt,
  colorRunIn,
  freeColors,
  isDue,
  isModelNotFound,
  onChecked,
  onClear,
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

/** Which session holds which color, shared by every Claude Code process on the machine. */
type Claims = Readonly<Record<string, Color>>

const keyFor = (sessionId: string): string => `${KEY_PREFIX}${sessionId}`

const readRecord = async ($: EngineInterface, sessionId: string): Promise<SessionRecord> =>
  ((await $.store.get(keyFor(sessionId))) as SessionRecord | undefined) ?? {}

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

/** The Claude Code configuration directory, asked of the shell once per load. */
const readConfigDir = async ($: EngineInterface): Promise<string> => {
  if (configDir !== undefined) return configDir
  const { stdout } = await $.process.run([
    'sh',
    '-c',
    'printf %s "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"',
  ])
  configDir = stdout
  return configDir
}

/** The ids of the sessions running now, from the files Claude Code keeps per process. */
const liveSessionIds = async ($: EngineInterface, dir: string): Promise<Set<string>> => {
  const entries = await $.fs.list(`${dir}/sessions`).catch(() => [])
  const ids = await Promise.all(
    entries
      .filter((f) => f.kind === 'file' && f.name.endsWith('.json'))
      .map(async (f) => {
        try {
          const text = await $.fs.read(`${dir}/sessions/${f.name}`)
          return (JSON.parse(text) as { sessionId?: unknown }).sessionId
        } catch {
          return undefined
        }
      }),
  )
  return new Set(ids.filter((id): id is string => typeof id === 'string'))
}

const claimsPath = (dir: string): string => `${dir}/tintname/colors.json`

/** The claims of live sessions only; a session that ended or was cleared frees its color. */
const readClaims = async ($: EngineInterface, dir: string): Promise<Claims> => {
  const live = await liveSessionIds($, dir)
  try {
    const all = JSON.parse(await $.fs.read(claimsPath(dir))) as Claims
    return Object.fromEntries(Object.entries(all).filter(([id]) => live.has(id)))
  } catch {
    return {}
  }
}

const writeClaim = async (
  $: EngineInterface,
  sessionId: string,
  color: Color | undefined,
): Promise<void> => {
  const dir = await readConfigDir($)
  const others = Object.entries(await readClaims($, dir)).filter(([id]) => id !== sessionId)
  const claims = Object.fromEntries(color === undefined ? others : [...others, [sessionId, color]])
  await $.fs.write(claimsPath(dir), `${JSON.stringify(claims, null, 2)}\n`)
}

const takenByOthers = async ($: EngineInterface, sessionId: string): Promise<Color[]> => {
  const claims = await readClaims($, await readConfigDir($))
  return Object.entries(claims)
    .filter(([id]) => id !== sessionId)
    .map(([, color]) => color)
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
  sessionId: string,
  messages: readonly Message[],
  turns: number,
  timeoutMs: number,
  isFresh = false,
): Promise<Consulted | undefined> => {
  const record = await readRecord($, sessionId)
  const free = freeColors(await takenByOthers($, sessionId))
  const current = isFresh
    ? { color: record.color }
    : { name: record.pending ?? record.applied, color: record.color }
  const prompt = buildTitlePrompt(messages, current, free)
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

  const parsed = reply.isAnswered ? parseReply(reply.text) : null
  if (parsed?.kind !== 'name') {
    const checked = onChecked(latest, turns, null)
    await writeRecord($, sessionId, checked)
    if (latest.color !== undefined) await writeClaim($, sessionId, latest.color)
    return { record: checked }
  }

  const color = pickColor(parsed.color, latest.color, freeColors(await takenByOthers($, sessionId)))
  await writeClaim($, sessionId, color)
  const newColor = color !== undefined && color !== latest.color ? color : undefined
  const named = onChecked(latest, turns, parsed.name, color)
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
const check = async ($: EngineInterface, model: string): Promise<void> => {
  const sessionId = await $.session.id()
  const record = await readRecord($, sessionId)
  const turns = await $.session.turns()
  if (record.isUserNamed || !isDue(turns, record.checkedAt)) return
  const consulted = await consult(
    $,
    model,
    sessionId,
    await $.session.messages(),
    turns,
    TIMEOUT_MS,
  )
  if (consulted?.newColor !== undefined) setColor($, consulted.newColor)
}

export const register: Register = (on, options) => {
  const model = typeof options.model === 'string' && options.model !== '' ? options.model : 'haiku'
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
        check($, model)
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
   */
  on('session.append', { door: 'command' }, async ($, e, next) => {
    const block = e.message.content[0]
    const text = block?.type === 'text' && typeof block.text === 'string' ? block.text : ''
    const color = colorRunIn(text)
    if (color === undefined) return next(e)
    const record = await readRecord($, await $.session.id())
    if (!(record.ran ?? []).includes(`color ${color}`)) return next(e)
    return next({ ...e, message: { ...e.message, content: [] } })
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
      const consulted = await consult($, model, e.session_id, messages, 1, FIRST_TIMEOUT_MS, true)
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

  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (e.source !== 'clear') return result
    await writeRecord($, e.session_id, onClear(e.session_title))
    await writeClaim($, e.session_id, undefined)
    return result
  }).catch(($, e, next) => next(e))
}
