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
const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'] as const
const UNIX = { HOME: '/home/test' }

const colorFile = (color: string, dir = DIR): string => `${dir}/tintname/colors/${color}.json`

/** Which session holds which color, read from the per-color files. */
const claimsIn = (files: Map<string, string>, dir = DIR): Record<string, string> =>
  Object.fromEntries(
    COLORS.flatMap((color) =>
      Object.keys(JSON.parse(files.get(colorFile(color, dir)) ?? '{}') as object).map(
        (id) => [id, color] as const,
      ),
    ),
  )

/** Writes the per-color files so each session holds its color. */
const seedClaims = (files: Map<string, string>, claims: Record<string, string>): void => {
  for (const color of COLORS) files.delete(colorFile(color))
  for (const [id, color] of Object.entries(claims)) {
    const held = JSON.parse(files.get(colorFile(color)) ?? '{}') as Record<string, number>
    files.set(colorFile(color), JSON.stringify({ ...held, [id]: 0 }))
  }
}

type World = {
  readonly asked: string[]
  readonly toasts: string[]
  readonly commands: string[]
  readonly files: Map<string, string>
  /** Makes the session the plugin sees the one with `id`, as a fork does. */
  readonly becomeSession: (id: string) => void
  /** Runs `fn` after each file write; a throw fails the write. */
  readonly afterWrite: (fn: (path: string) => void) => void
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
  env: Readonly<Record<string, string>> = UNIX,
): World => {
  const asked: string[] = []
  const toasts: string[] = []
  const commands: string[] = []
  const files = liveSessions([SESSION_ID])
  let sessionId = SESSION_ID
  let written: (path: string) => void = () => {}
  mock.store(on)
  mock.env(on, env)
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
    written(e.path)
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
  on('session.id', () => ({ value: sessionId }))
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
  return {
    asked,
    toasts,
    commands,
    files,
    becomeSession: (id) => {
      sessionId = id
    },
    afterWrite: (fn) => {
      written = fn
    },
  }
}

type Clock = { advance: (ms: number) => Promise<void> }

/** Moves the clock on until `work` settles, so the waits of a color claim pass. */
const drive = async <T>(clock: Clock, work: Promise<T>): Promise<T> => {
  let isDone = false
  const done = () => {
    isDone = true
  }
  work.then(done, done)
  for (let i = 0; i < 200 && !isDone; i++) await clock.advance(50)
  return work
}

const completeTurn = async ($: Engine, clock: Clock) => {
  await $.turn.complete({
    answer: 'done',
    durationMs: 1,
    isAborted: false,
    turnId: 'turn-1',
    reason: 'answer',
  })
  for (let i = 0; i < 20; i++) await clock.advance(50)
}

const submit = ($: Engine, clock: Clock, sessionTitle?: string, sessionId = SESSION_ID) =>
  drive(
    clock,
    $.classic.UserPromptSubmit({
      session_id: sessionId,
      prompt: 'next',
      ...(sessionTitle === undefined ? {} : { session_title: sessionTitle }),
    }),
  )

test('names the session at the first prompt, colors it when the turn ends', async ($, on) => {
  const { asked, commands } = world(on, '"login-redirect-fix red"')
  const clock = mock.clock(on)

  const result = await submit($, clock)
  await clock.advance(1)

  expect(asked.length).toBe(1)
  expect(asked[0]).toContain('First prompt:\nnext')
  expect(result.sessionTitle).toBe('login-redirect-fix')
  expect(commands).toEqual([])

  await completeTurn($, clock)

  expect(commands).toEqual(['/color red'])
})

test(
  'writes the name in the configured style',
  { options: { style: 'free text' } },
  async ($, on) => {
    const { asked } = world(on, 'Fix the login redirect red')
    const clock = mock.clock(on)

    const result = await submit($, clock)
    await clock.advance(1)

    expect(asked[0]).toContain('written naturally')
    expect(result.sessionTitle).toBe('Fix the login redirect')
  },
)

test('does not check again after the first turn', async ($, on) => {
  const { asked } = world(on, 'login-redirect-fix red')
  const clock = mock.clock(on)

  await submit($, clock)
  await completeTurn($, clock)

  expect(asked.length).toBe(1)
})

test('names after the first turn when the first prompt got no name', async ($, on) => {
  let reply = ''
  const { asked } = world(on, () => reply)
  const clock = mock.clock(on)

  await submit($, clock)
  reply = 'login-redirect-fix red'
  await completeTurn($, clock)
  const result = await submit($, clock)

  expect(asked.length).toBe(2)
  expect(asked[1]).toContain('The login page redirects forever')
  expect(result.sessionTitle).toBe('login-redirect-fix')
})

test('leaves a session the person named alone', async ($, on) => {
  const { asked, commands } = world(on, 'login-redirect-fix red')
  const clock = mock.clock(on)

  const named = await submit($, clock, 'my own name')
  await completeTurn($, clock)

  expect(named.sessionTitle).toBe(undefined)
  expect(asked.length).toBe(0)
  expect(commands).toEqual([])
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

  expect(commands).toContain('/color red')
  expect(claimsIn(files)).toEqual({ [SESSION_ID]: 'red' })
})

test('takes a free color when another live session holds the wanted one', async ($, on) => {
  const { commands, files } = world(on, 'login-redirect-fix red')
  const clock = mock.clock(on)
  for (const [path, text] of liveSessions([SESSION_ID, 'other'])) files.set(path, text)
  seedClaims(files, { other: 'red', gone: 'blue' })

  await completeTurn($, clock)

  expect(commands).toContain('/color blue')
  expect(claimsIn(files)).toEqual({ other: 'red', [SESSION_ID]: 'blue' })
})

test('keeps the name when the model says KEEP', async ($, on) => {
  let turns = 1
  let reply = 'login-redirect-fix red'
  const { commands } = world(
    on,
    () => reply,
    () => turns,
  )
  const clock = mock.clock(on)

  await submit($, clock)
  turns = 2
  reply = 'KEEP'
  await completeTurn($, clock)
  const result = await submit($, clock, 'login-redirect-fix')

  expect(result.sessionTitle).toBe(undefined)
  expect(commands).toEqual(['/color red'])
})

test('renames at the next prompt and keeps the color', async ($, on) => {
  let turns = 1
  let reply = 'login-redirect-fix red'
  const { asked, commands } = world(
    on,
    () => reply,
    () => turns,
  )
  const clock = mock.clock(on)

  await submit($, clock)
  turns = 2
  reply = 'rust-rewrite orange'
  await completeTurn($, clock)
  const result = await submit($, clock, 'login-redirect-fix')

  expect(asked[1]).not.toContain('Color rules')
  expect(result.sessionTitle).toBe('rust-rewrite')
  expect(commands).toEqual(['/color red'])
})

test('starts over after /clear', async ($, on) => {
  let reply = 'login-redirect-fix red'
  const { asked, commands, files } = world(on, () => reply)
  const clock = mock.clock(on)
  on('classic.SessionStart', () => ({}))

  await submit($, clock)
  await completeTurn($, clock)
  await drive(
    clock,
    $.classic.SessionStart({
      session_id: SESSION_ID,
      source: 'clear',
      session_title: 'login-redirect-fix',
    }),
  )
  expect(claimsIn(files)).toEqual({})

  reply = 'rust-rewrite orange'
  const result = await submit($, clock, 'login-redirect-fix')
  await completeTurn($, clock)

  expect(asked[1]).toContain('Current name: (none)')
  expect(asked[1]).toContain('Color rules')
  expect(result.sessionTitle).toBe('rust-rewrite')
  expect(commands).toEqual(['/color red', '/color orange'])
})

test('gives a fork its own name and color', async ($, on) => {
  let reply = 'login-redirect-fix red'
  const { commands, files, becomeSession } = world(on, () => reply)
  const clock = mock.clock(on)
  on('classic.SessionStart', () => ({}))

  await submit($, clock)
  await completeTurn($, clock)
  for (const [path, text] of liveSessions([SESSION_ID, 'fork'])) files.set(path, text)
  becomeSession('fork')
  await drive(
    clock,
    $.classic.SessionStart({
      session_id: 'fork',
      source: 'fork',
      session_title: 'login-redirect-fix',
    }),
  )

  reply = 'cookie-cleanup red'
  const result = await submit($, clock, 'login-redirect-fix', 'fork')
  await completeTurn($, clock)

  expect(result.sessionTitle).toBe('cookie-cleanup')
  expect(commands).toEqual(['/color red', '/color blue'])
  expect(claimsIn(files)).toEqual({ [SESSION_ID]: 'red', fork: 'blue' })
})

test('leaves a fork of a session the person named alone', async ($, on) => {
  const { asked, commands, becomeSession } = world(on, 'cookie-cleanup blue')
  const clock = mock.clock(on)
  on('classic.SessionStart', () => ({}))

  becomeSession('fork')
  await drive(
    clock,
    $.classic.SessionStart({ session_id: 'fork', source: 'fork', session_title: 'my own name' }),
  )
  const result = await submit($, clock, 'my own name', 'fork')
  await completeTurn($, clock)

  expect(result.sessionTitle).toBe(undefined)
  expect(asked.length).toBe(0)
  expect(commands).toEqual([])
})

test('claims its color again when resumed', async ($, on) => {
  const { commands, files } = world(on, 'login-redirect-fix red')
  const clock = mock.clock(on)
  on('classic.SessionStart', () => ({}))

  await submit($, clock)
  await completeTurn($, clock)
  seedClaims(files, {})
  await drive(
    clock,
    $.classic.SessionStart({
      session_id: SESSION_ID,
      source: 'resume',
      session_title: 'login-redirect-fix',
    }),
  )

  expect(claimsIn(files)).toEqual({ [SESSION_ID]: 'red' })
  expect(commands).toEqual(['/color red'])
})

test('gives way when another session takes the same color at the same time', async ($, on) => {
  const { commands, files, afterWrite } = world(on, 'login-redirect-fix red')
  const clock = mock.clock(on)
  for (const [path, text] of liveSessions([SESSION_ID, 'other'])) files.set(path, text)
  let isRacing = true
  afterWrite((path) => {
    if (isRacing && path === colorFile('red')) {
      isRacing = false
      files.set(path, JSON.stringify({ other: 1 }))
    }
  })

  await completeTurn($, clock)

  expect(commands).toContain('/color blue')
  expect(claimsIn(files)).toEqual({ other: 'red', [SESSION_ID]: 'blue' })
})

test('finds the configuration on Windows without running a command', async ($, on) => {
  const { commands, files } = world(on, 'login-redirect-fix red', undefined, {
    OS: 'Windows_NT',
    HOME: '/home/test',
    USERPROFILE: 'C:\\Users\\test',
  })
  const clock = mock.clock(on)
  const runs: string[] = []
  on('process.run', (_$, e) => {
    runs.push(e.argv.join(' '))
    return {
      value: {
        exitCode: 1,
        stdout: '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })

  await completeTurn($, clock)

  expect(runs).toEqual([])
  expect(commands).toContain('/color red')
  expect(
    [...files.keys()].some((p) => p.endsWith('C:\\Users\\test/.claude/tintname/colors/red.json')),
  ).toBe(true)
})

test('honours CLAUDE_CONFIG_DIR', async ($, on) => {
  const dir = '/elsewhere/claude'
  const { files } = world(on, 'login-redirect-fix red', undefined, {
    HOME: '/home/test',
    CLAUDE_CONFIG_DIR: dir,
  })
  const clock = mock.clock(on)

  await completeTurn($, clock)

  expect(claimsIn(files, dir)).toEqual({ [SESSION_ID]: 'red' })
})

test('still names and colors when the color files cannot be written', async ($, on) => {
  const { commands, afterWrite } = world(on, 'login-redirect-fix red')
  const clock = mock.clock(on)
  afterWrite(() => {
    throw new Error('EACCES')
  })

  const result = await submit($, clock)
  await completeTurn($, clock)

  expect(result.sessionTitle).toBe('login-redirect-fix')
  expect(commands).toEqual(['/color red'])
})
