import type { EngineInterface, Register } from 'claude-code'
import {
  SYSTEM_PROMPT,
  buildTitlePrompt,
  isDue,
  onChecked,
  onPrompt,
  sanitizeTitle,
  type SessionRecord,
} from './title.ts'

const KEY_PREFIX = 'session:'
const MAX_SESSIONS = 300
const TIMEOUT_MS = 30_000

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

/**
 * Titles are computed after a turn, off the prompt's path, and applied at
 * the next prompt through `sessionTitle`, which adds nothing to the
 * conversation the model reads (running `/rename` would).
 */
const check = async ($: EngineInterface, model: string): Promise<void> => {
  const sessionId = await $.session.id()
  const record = await readRecord($, sessionId)
  const turns = await $.session.turns()
  if (record.isUserNamed || !isDue(turns, record.checkedAt)) return

  const prompt = buildTitlePrompt(await $.session.messages(), record.pending ?? record.applied)
  if (prompt === null) return

  const reply = await $.model.complete({
    model,
    system: SYSTEM_PROMPT,
    prompt,
    maxTokens: 40,
    timeoutMs: TIMEOUT_MS,
  })
  const title = reply.isAnswered ? sanitizeTitle(reply.text) : null
  await writeRecord($, sessionId, onChecked(await readRecord($, sessionId), turns, title))
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
    const { record: settled, title } = onPrompt(record, e.session_title)
    if (settled !== record) await writeRecord($, e.session_id, settled)
    return title === undefined ? result : { ...result, sessionTitle: title }
  }).catch(($, e, next) => next(e))
}
