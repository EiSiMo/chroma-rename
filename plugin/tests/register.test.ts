import type { Engine } from 'claude-code/testing'
import type { ModelCompleteResult, On, SessionMessage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const SESSION_ID = 'session-1'

const MESSAGES: SessionMessage[] = [
  { role: 'user', text: 'The login page redirects forever after a password reset', toolUses: [] },
  { role: 'assistant', text: 'The reset handler sets the session cookie twice.', toolUses: [] },
]

const USAGE = {
  input_tokens: 1,
  output_tokens: 1,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

const NOT_FOUND: ModelCompleteResult = {
  isAnswered: false,
  reason: 'api-error',
  status: 404,
  error: 'model_not_found',
  usage: USAGE,
}

const DIR = '/home/test/.claude'
const CLAIMS = `${DIR}/tintname/colors.json`

type World = {
  readonly asked: string[]
  readonly toasts: string[]
  readonly commands: string[]
  readonly files: Map<string, string>
}

/** One live process file per session id, as Claude Code keeps them. */
const liveSessions = (ids: readonly string[]): Map<string, string> =>
  new Map(ids.map((id, i) => [`${DIR}/sessions/${i}.json`, JSON.stringify({ sessionId: id })]))

/**
 * Stands in for the session and the model beneath the plugin, recording each
 * title request and toast. A string reply is the model answering with it.
 */
const world = (
  on: On,
  reply: string | ModelCompleteResult | (() => string),
  turns: () => number = () => 1,
): World => {
  const asked: string[] = []
  const toasts: string[] = []
  const commands: string[] = []
  const files = liveSessions([SESSION_ID])
  mock.store(on)
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: DIR,
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('fs.list', (_$, e) => ({
    value: [...files.keys()]
      .filter((path) => path.startsWith(`${e.path}/`))
      .map((path) => ({
        name: path.slice(e.path.length + 1),
        kind: 'file' as const,
        size: 0,
        mtimeMs: 0,
        isLink: false,
      })),
  }))
  on('fs.read', (_$, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.write', (_$, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('command.run', (_$, e) => {
    commands.push(`/${e.command} ${e.args}`)
    return {}
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('turn.complete', () => ({ text: '' }))
  on('classic.UserPromptSubmit', () => ({}))
  on('session.id', () => ({ value: SESSION_ID }))
  on('session.turns', () => ({ value: turns() }))
  on('session.messages', () => ({ value: MESSAGES }))
  on('model.complete', (_$, e) => {
    asked.push(e.prompt)
    return {
      value:
        typeof reply === 'object'
          ? reply
          : { isAnswered: true, text: typeof reply === 'string' ? reply : reply(), usage: USAGE },
    }
  })
  return { asked, toasts, commands, files }
}

const completeTurn = async ($: Engine, clock: { advance: (ms: number) => Promise<void> }) => {
  await $.turn.complete({
    answer: 'done',
    durationMs: 1,
    isAborted: false,
    turnId: 'turn-1',
    reason: 'answer',
  })
  await clock.advance(1)
}

const submit = ($: Engine, sessionTitle?: string) =>
  $.classic.UserPromptSubmit({
    session_id: SESSION_ID,
    prompt: 'next',
    ...(sessionTitle === undefined ? {} : { session_title: sessionTitle }),
  })

test('titles the session at the prompt after the first turn', async ($, on) => {
  const { asked } = world(on, '"login-redirect-fix red"')
  const clock = mock.clock(on)

  await completeTurn($, clock)
  const result = await submit($)

  expect(asked.length).toBe(1)
  expect(asked[0]).toContain('The login page redirects forever')
  expect(result.sessionTitle).toBe('login-redirect-fix')
})

test('leaves a session the person named alone', async ($, on) => {
  const { asked } = world(on, 'login-redirect-fix red')
  const clock = mock.clock(on)

  const named = await submit($, 'my own name')
  await completeTurn($, clock)
  const result = await submit($, 'my own name')

  expect(named.sessionTitle).toBe(undefined)
  expect(asked.length).toBe(0)
  expect(result.sessionTitle).toBe(undefined)
})

test('does not re-apply a title the session already has', async ($, on) => {
  world(on, 'login-redirect-fix red')
  const clock = mock.clock(on)

  await completeTurn($, clock)
  const first = await submit($)
  const second = await submit($, 'login-redirect-fix')

  expect(first.sessionTitle).toBe('login-redirect-fix')
  expect(second.sessionTitle).toBe(undefined)
})

test(
  'says when the configured model is not found',
  { options: { model: 'haikoo' } },
  async ($, on) => {
    const { toasts } = world(on, NOT_FOUND)
    const clock = mock.clock(on)

    await completeTurn($, clock)

    expect(toasts.length).toBe(1)
    expect(toasts[0]).toContain('"haikoo"')
    expect(toasts[0]).toContain('Configure options')
  },
)

test('says so once per session', async ($, on) => {
  let turns = 1
  const { asked, toasts } = world(on, NOT_FOUND, () => turns)
  const clock = mock.clock(on)

  await completeTurn($, clock)
  turns = 2
  await completeTurn($, clock)

  expect(asked.length).toBe(2)
  expect(toasts.length).toBe(1)
})

const OTHER_FAILURES: readonly [string, ModelCompleteResult][] = [
  ['aborted', { isAnswered: false, reason: 'aborted', usage: USAGE }],
  ['empty', { isAnswered: false, reason: 'empty-reply', usage: USAGE }],
  [
    'rate limited',
    { isAnswered: false, reason: 'api-error', status: 429, error: 'rate_limit', usage: USAGE },
  ],
]

for (const [label, reply] of OTHER_FAILURES) {
  test(`stays quiet when the reply is ${label}`, async ($, on) => {
    const { asked, toasts } = world(on, reply)
    const clock = mock.clock(on)

    await completeTurn($, clock)

    expect(asked.length).toBe(1)
    expect(toasts.length).toBe(0)
  })
}

test('sets the color it picked and claims it', async ($, on) => {
  const { commands, files } = world(on, 'login-redirect-fix red')
  const clock = mock.clock(on)

  await completeTurn($, clock)

  expect(commands).toEqual(['/color red'])
  expect(JSON.parse(files.get(CLAIMS) ?? '{}')).toEqual({ [SESSION_ID]: 'red' })
})

test('takes a free color when another live session holds the wanted one', async ($, on) => {
  const { commands, files } = world(on, 'login-redirect-fix red')
  const clock = mock.clock(on)
  for (const [path, text] of liveSessions([SESSION_ID, 'other'])) files.set(path, text)
  files.set(CLAIMS, JSON.stringify({ other: 'red', gone: 'blue' }))

  await completeTurn($, clock)

  expect(commands).toEqual(['/color blue'])
  expect(JSON.parse(files.get(CLAIMS) ?? '{}')).toEqual({ other: 'red', [SESSION_ID]: 'blue' })
})

test('keeps name and color when the model says KEEP', async ($, on) => {
  let turns = 1
  let reply = 'login-redirect-fix red'
  const { commands } = world(
    on,
    () => reply,
    () => turns,
  )
  const clock = mock.clock(on)

  await completeTurn($, clock)
  await submit($)
  turns = 2
  reply = 'KEEP'
  await completeTurn($, clock)
  const result = await submit($, 'login-redirect-fix')

  expect(commands).toEqual(['/color red'])
  expect(result.sessionTitle).toBe(undefined)
})

test('starts over after /clear', async ($, on) => {
  const { commands, files } = world(on, 'login-redirect-fix red')
  const clock = mock.clock(on)
  on('classic.SessionStart', () => ({}))

  await completeTurn($, clock)
  await submit($)
  await $.classic.SessionStart({
    session_id: SESSION_ID,
    source: 'clear',
    session_title: 'login-redirect-fix',
  })
  await clock.advance(1)

  expect(commands).toEqual(['/color red', '/color default'])
  expect(JSON.parse(files.get(CLAIMS) ?? '{}')).toEqual({})
})
