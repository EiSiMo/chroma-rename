import { describe, expect, it } from 'vitest'
import {
  COLORS,
  MAX_NAME_LENGTH,
  buildTitlePrompt,
  colorRowIn,
  availableColors,
  onUserColor,
  IDLE_SHARE_MS,
  type Claim,
  cleanPrompt,
  isDue,
  isModelNotFound,
  onChecked,
  onModelMissing,
  onClear,
  onPrompt,
  onRan,
  parseReply,
  pickColor,
  freeColors,
  sanitizeName,
  userPrompts,
  type Message,
} from '../plugin/hooks/title.ts'

const user = (text: string): Message => ({ role: 'user', text })
const assistant = (text: string): Message => ({ role: 'assistant', text })

describe('cleanPrompt', () => {
  it('drops engine reminders and command output', () => {
    const text =
      'fix the build<system-reminder>todo list is empty</system-reminder><local-command-stdout>ok</local-command-stdout>'
    expect(cleanPrompt(text)).toBe('fix the build')
  })

  it('collapses a slash command record to its name and args', () => {
    const text =
      '<command-name>/review-code</command-name>\n<command-message>review-code</command-message>\n<command-args>PR 42</command-args>'
    expect(cleanPrompt(text)).toBe('/review-code PR 42')
  })

  it('keeps a command with no args', () => {
    expect(cleanPrompt('<command-name>/compact</command-name>')).toBe('/compact')
  })

  it('strips leftover tags and squeezes whitespace', () => {
    expect(cleanPrompt('<bash-input>ls   -la</bash-input>\n')).toBe('ls -la')
  })
})

describe('userPrompts', () => {
  it('keeps typed prompts in order, without empties or repeats', () => {
    const messages = [
      user('first'),
      assistant('reply'),
      user('<system-reminder>only a reminder</system-reminder>'),
      user('second'),
      user('first'),
    ]
    expect(userPrompts(messages)).toEqual(['first', 'second'])
  })
})

describe('buildTitlePrompt', () => {
  it('returns null before the person has typed anything', () => {
    expect(buildTitlePrompt([assistant('hello')], {}, COLORS)).toBeNull()
  })

  it('carries the current name and color, the first prompt and the latest reply', () => {
    const prompt = buildTitlePrompt(
      [user('add a cache countdown'), assistant('Added it to the status line.')],
      { name: 'cache-countdown', color: 'cyan' },
      COLORS,
    )
    expect(prompt).toContain('Current name: cache-countdown')
    expect(prompt).toContain('or "KEEP"')
    expect(prompt).not.toContain('Color rules')
    expect(prompt).toContain('First prompt:\nadd a cache countdown')
    expect(prompt).toContain("Claude's latest reply (context only):\nAdded it to the status line.")
    expect(prompt).not.toContain('Later prompts')
  })

  it('says when there is no name yet', () => {
    expect(buildTitlePrompt([user('hi there')], {}, COLORS)).toContain('Current name: (none)')
  })

  it('offers only the free colors', () => {
    const prompt = buildTitlePrompt([user('hi there')], {}, ['blue', 'pink']) ?? ''
    expect(prompt).toContain('Pick one of: blue, pink.')
  })

  it('asks for no color when the person set their own', () => {
    const prompt = buildTitlePrompt([user('hi there')], { isColorFixed: true }, COLORS) ?? ''
    expect(prompt).not.toContain('Color rules')
    expect(prompt).toContain('or "KEEP"')
  })

  it('offers every color when none is free', () => {
    const prompt = buildTitlePrompt([user('hi there')], {}, []) ?? ''
    expect(prompt).toContain(`Pick one of: ${COLORS.join(', ')}.`)
  })

  it('keeps only the latest prompts and says how many it left out', () => {
    const messages = Array.from({ length: 12 }, (_, i) => user(`prompt ${i + 1}`))
    const prompt = buildTitlePrompt(messages, {}, COLORS) ?? ''
    expect(prompt).toContain('Latest prompts, oldest first (3 earlier omitted):')
    expect(prompt).not.toContain('- prompt 4\n')
    expect(prompt).toContain('- prompt 5')
    expect(prompt).toContain('- prompt 12')
  })

  it('clips long prompts', () => {
    const prompt = buildTitlePrompt([user('x'.repeat(2000))], {}, COLORS) ?? ''
    expect(prompt).toContain(`${'x'.repeat(799)}…`)
    expect(prompt).not.toContain('x'.repeat(800))
  })
})

describe('sanitizeName', () => {
  it.each([
    ['Rust Rewrite', 'rust-rewrite'],
    ['name: login_redirect fix', 'login-redirect-fix'],
    ['Karten-Export für Übersicht', 'karten-export-für'],
    ['one two three four five', 'one-two-three'],
  ])('cleans %j', (raw, expected) => {
    expect(sanitizeName(raw)).toBe(expected)
  })

  it.each(['', '  ', '"."', 'ok'])('rejects %j', (raw) => {
    expect(sanitizeName(raw)).toBeNull()
  })

  it('cuts a long name at a word', () => {
    const name = sanitizeName(`${'a'.repeat(20)} ${'b'.repeat(15)} ${'c'.repeat(10)}`) ?? ''
    expect(name).toBe(`${'a'.repeat(20)}-${'b'.repeat(15)}`)
    expect(name.length).toBeLessThanOrEqual(MAX_NAME_LENGTH)
  })
})

describe('parseReply', () => {
  it.each([
    ['rust-rewrite orange', { kind: 'name', name: 'rust-rewrite', color: 'orange' }],
    ['"weltkugel-feature blue."', { kind: 'name', name: 'weltkugel-feature', color: 'blue' }],
    ['login-fix', { kind: 'name', name: 'login-fix' }],
    ['KEEP', { kind: 'keep' }],
    ['keep.', { kind: 'keep' }],
  ])('reads %j', (raw, expected) => {
    expect(parseReply(raw)).toEqual(expected)
  })

  it.each(['', ' \n ', 'ok red'])('rejects %j', (raw) => {
    expect(parseReply(raw)).toBeNull()
  })
})

describe('pickColor', () => {
  it('takes the wanted color when free', () => {
    expect(pickColor('orange', undefined, ['orange', 'blue'])).toBe('orange')
  })

  it('never changes a color once set', () => {
    expect(pickColor('orange', 'blue', ['orange', 'blue'])).toBe('blue')
    expect(pickColor('orange', 'blue', [])).toBe('blue')
  })

  it('falls back to the first free color', () => {
    expect(pickColor('orange', undefined, ['pink', 'cyan'])).toBe('pink')
  })

  it('shares the wanted color when none is free', () => {
    expect(pickColor('orange', undefined, [])).toBe('orange')
  })
})

describe('freeColors', () => {
  it('drops the taken colors', () => {
    expect(freeColors(['red', 'cyan'])).toEqual(COLORS.filter((c) => c !== 'red' && c !== 'cyan'))
  })
})

describe('isDue', () => {
  it('checks the first prompt', () => {
    expect(isDue(1, undefined)).toBe(true)
  })

  it('never checks before a prompt', () => {
    expect(isDue(0, undefined)).toBe(false)
  })

  it('doubles the gap, then holds it at eight prompts', () => {
    const checks: number[] = []
    let checkedAt: number | undefined
    for (let turn = 1; turn <= 40; turn++) {
      if (isDue(turn, checkedAt)) {
        checks.push(turn)
        checkedAt = turn
      }
    }
    expect(checks).toEqual([1, 2, 4, 8, 16, 24, 32, 40])
  })
})

describe('onPrompt', () => {
  it('hands over a pending name and records it as applied', () => {
    expect(onPrompt({ pending: 'new-name', checkedAt: 2 }, undefined)).toEqual({
      record: { applied: 'new-name', checkedAt: 2 },
      title: 'new-name',
    })
  })

  it('replaces its own earlier name', () => {
    expect(onPrompt({ applied: 'old', pending: 'new', checkedAt: 4 }, 'old').title).toBe('new')
  })

  it('treats a title it did not set as the person naming the session', () => {
    expect(onPrompt({ applied: 'mine', pending: 'next', color: 'red' }, 'theirs')).toEqual({
      record: { applied: 'mine', color: 'red', isUserNamed: true },
    })
  })

  it('stays out once the person has named the session', () => {
    const record = { isUserNamed: true }
    expect(onPrompt(record, 'anything')).toEqual({ record })
  })

  it('leaves the record alone when nothing is pending', () => {
    const record = { applied: 'same', checkedAt: 2 }
    expect(onPrompt(record, 'same').record).toBe(record)
  })
})

describe('onClear', () => {
  it('starts over and claims the title the session still shows', () => {
    expect(onClear('old-name')).toEqual({ applied: 'old-name' })
    expect(onClear(undefined)).toEqual({})
  })
})

describe('onChecked', () => {
  it('queues a new name and records the color', () => {
    expect(onChecked({}, 1, 'rust-rewrite', 'orange')).toEqual({
      checkedAt: 1,
      pending: 'rust-rewrite',
      color: 'orange',
    })
  })

  it('queues nothing when the name is unchanged or missing', () => {
    expect(onChecked({ applied: 'same' }, 4, 'same').pending).toBeUndefined()
    expect(onChecked({ applied: 'same', pending: 'stale' }, 4, null).pending).toBeUndefined()
  })
})

describe('onRan', () => {
  it('keeps the newest runs, each once', () => {
    const record = onRan(onRan(onRan({}, 'color red'), 'color blue'), 'color red')
    expect(record.ran).toEqual(['color blue', 'color red'])
  })
})

describe('isModelNotFound', () => {
  it('spots a model the API does not know', () => {
    expect(
      isModelNotFound({ isAnswered: false, reason: 'api-error', error: 'model_not_found' }),
    ).toBe(true)
  })

  it.each([
    { isAnswered: false, reason: 'api-error', error: 'invalid_request' },
    { isAnswered: false, reason: 'aborted' },
    { isAnswered: true },
  ])('ignores %j', (reply) => {
    expect(isModelNotFound(reply)).toBe(false)
  })
})

describe('onModelMissing', () => {
  it('warns with the model name and where to change it', () => {
    const { warning } = onModelMissing({}, 1, 'haikoo')
    expect(warning).toBe(
      'tintname: model "haikoo" not found; check its Configure options in /plugin',
    )
  })

  it('warns once per session', () => {
    expect(onModelMissing({ isModelWarned: true }, 2, 'haikoo').warning).toBeUndefined()
  })

  it('records the check and the warning', () => {
    expect(onModelMissing({ applied: 'Old' }, 4, 'haikoo').record).toEqual({
      applied: 'Old',
      checkedAt: 4,
      isModelWarned: true,
    })
  })
})

describe('colorRowIn', () => {
  it('reads the arguments of a /color echo row', () => {
    expect(
      colorRowIn(
        '<command-name>/color</command-name>\n  <command-message>color</command-message>\n  <command-args>Yellow</command-args>',
      ),
    ).toEqual({ kind: 'echo', value: 'yellow' })
  })

  it('reads a bare /color echo row as no arguments', () => {
    expect(
      colorRowIn('<command-name>/color</command-name>\n  <command-message>color</command-message>'),
    ).toEqual({ kind: 'echo', value: '' })
  })

  it('reads the color of a /color output row', () => {
    expect(
      colorRowIn('<local-command-stdout>Session color set to: cyan</local-command-stdout>'),
    ).toEqual({ kind: 'output', value: 'cyan' })
  })

  it('ignores other rows', () => {
    expect(colorRowIn('<command-name>/rename</command-name><command-args>x</command-args>')).toBe(
      undefined,
    )
    expect(colorRowIn('hello')).toBe(undefined)
  })
})

describe('availableColors', () => {
  const NOW = 10 * IDLE_SHARE_MS

  it('offers the free colors while there are any', () => {
    expect(availableColors([{ color: 'red' }], NOW)).toEqual(COLORS.filter((c) => c !== 'red'))
  })

  it('with every color held, offers those of long-idle sessions, longest idle first', () => {
    const claims: Claim[] = COLORS.map((color) => ({ color }))
    claims[2] = { color: COLORS[2], idleSince: NOW - 3 * IDLE_SHARE_MS }
    claims[5] = { color: COLORS[5], idleSince: NOW - 5 * IDLE_SHARE_MS }
    claims[6] = { color: COLORS[6], idleSince: NOW - IDLE_SHARE_MS / 2 }
    expect(availableColors(claims, NOW)).toEqual([COLORS[5], COLORS[2]])
  })

  it('offers nothing when every holder is busy or only briefly idle', () => {
    expect(
      availableColors(
        COLORS.map((color) => ({ color, idleSince: NOW - 1 })),
        NOW,
      ),
    ).toEqual([])
  })
})

describe('onUserColor', () => {
  it("takes the person's color and drops the plugin's pending one", () => {
    expect(onUserColor({ color: 'red', pendingColor: 'blue', applied: 'x' }, 'pink')).toEqual({
      applied: 'x',
      color: 'pink',
      isColorUserSet: true,
      pendingColor: undefined,
    })
  })

  it('clears the color on default', () => {
    expect(onUserColor({ color: 'red' }, undefined).color).toBeUndefined()
  })
})
