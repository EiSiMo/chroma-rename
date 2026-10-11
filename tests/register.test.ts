import type { Engine } from 'claude-code/testing'
import type { On, SessionMessage } from 'claude-code'
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

type World = { readonly asked: string[] }

/** Stands in for the session and the model beneath the plugin, recording each title request. */
const world = (on: On, reply: string, turns: number): World => {
  const asked: string[] = []
  mock.store(on)
  on('turn.complete', () => ({ text: '' }))
  on('classic.UserPromptSubmit', () => ({}))
  on('session.id', () => ({ value: SESSION_ID }))
  on('session.turns', () => ({ value: turns }))
  on('session.messages', () => ({ value: MESSAGES }))
  on('model.complete', (_$, e) => {
    asked.push(e.prompt)
    return { value: { isAnswered: true, text: reply, usage: USAGE } }
  })
  return { asked }
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
  const { asked } = world(on, '"Fix login redirect loop after reset."', 1)
  const clock = mock.clock(on)

  await completeTurn($, clock)
  const result = await submit($)

  expect(asked.length).toBe(1)
  expect(asked[0]).toContain('The login page redirects forever')
  expect(result.sessionTitle).toBe('Fix login redirect loop after reset')
})

test('leaves a session the person named alone', async ($, on) => {
  const { asked } = world(on, 'Fix login redirect loop', 1)
  const clock = mock.clock(on)

  const named = await submit($, 'my own name')
  await completeTurn($, clock)
  const result = await submit($, 'my own name')

  expect(named.sessionTitle).toBe(undefined)
  expect(asked.length).toBe(0)
  expect(result.sessionTitle).toBe(undefined)
})

test('does not re-apply a title the session already has', async ($, on) => {
  world(on, 'Fix login redirect loop', 1)
  const clock = mock.clock(on)

  await completeTurn($, clock)
  const first = await submit($)
  const second = await submit($, 'Fix login redirect loop')

  expect(first.sessionTitle).toBe('Fix login redirect loop')
  expect(second.sessionTitle).toBe(undefined)
})
