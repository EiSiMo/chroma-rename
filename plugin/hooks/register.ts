import type { EngineInterface, Register } from 'claude-code'
import {
  SYSTEM_PROMPT,
  buildTitlePrompt,
  freeColors,
  isDue,
  isModelNotFound,
  onChecked,
  onClear,
  onModelMissing,
  onPrompt,
  parseReply,
  pickColor,
  type Color,
  type SessionRecord,
} from './title.ts'

const KEY_PREFIX = 'session:'
const MAX_SESSIONS = 300
const TIMEOUT_MS = 30_000

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

/**
 * Names and colors are computed after a turn, off the prompt's path, and set
 * right away with `/rename` and `/color`. The record is written first, so the
 * title the next prompt carries reads as the plugin's own.
 */
const check = async ($: EngineInterface, model: string): Promise<void> => {
  const sessionId = await $.session.id()
  const record = await readRecord($, sessionId)
  const turns = await $.session.turns()
  if (record.isUserNamed || !isDue(turns, record.checkedAt)) return

  const free = freeColors(await takenByOthers($, sessionId))
  const current = { name: record.applied, color: record.color }
  const prompt = buildTitlePrompt(await $.session.messages(), current, free)
  if (prompt === null) return

  const reply = await $.model.complete({
    model,
    system: SYSTEM_PROMPT,
    prompt,
    maxTokens: 40,
    timeoutMs: TIMEOUT_MS,
  })
  const latest = await readRecord($, sessionId)
  if (isModelNotFound(reply)) {
    const { record: checked, warning } = onModelMissing(latest, turns, model)
    await writeRecord($, sessionId, checked)
    if (warning !== undefined) $.ui.toast(warning)
    return
  }

  const parsed = reply.isAnswered ? parseReply(reply.text) : null
  if (parsed?.kind !== 'name') {
    await writeRecord($, sessionId, onChecked(latest, turns, null))
    if (latest.color !== undefined) await writeClaim($, sessionId, latest.color)
    return
  }

  const color = pickColor(parsed.color, latest.color, freeColors(await takenByOthers($, sessionId)))
  await writeClaim($, sessionId, color)
  await writeRecord($, sessionId, onChecked(latest, turns, parsed.name, color))
  if (parsed.name !== latest.applied) await $.command.run({ command: 'rename', args: parsed.name })
  if (color !== undefined && color !== latest.color) {
    await $.command.run({ command: 'color', args: color })
  }
}

export const register: Register = (on, options) => {
  const model = typeof options.model === 'string' && options.model !== '' ? options.model : 'haiku'
  let isChecking = false

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
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

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    const record = await readRecord($, e.session_id)
    const settled = onPrompt(record, e.session_title)
    if (settled !== record) await writeRecord($, e.session_id, settled)
    return result
  }).catch(($, e, next) => next(e))

  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (e.source !== 'clear') return result
    await writeRecord($, e.session_id, onClear(e.session_title))
    await writeClaim($, e.session_id, undefined)
    $.clock.after(0, () => {
      $.command
        .run({ command: 'color', args: 'default' })
        .catch((error: unknown) => $.ui.log(`color reset failed: ${String(error)}`))
    })
    return result
  }).catch(($, e, next) => next(e))
}
