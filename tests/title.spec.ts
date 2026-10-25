import { describe, expect, it } from 'vitest'
import {
  COLORS,
  MAX_FREE_LENGTH,
  MAX_HOLDERS,
  claimsOf,
  idleSinceOf,
  withHolder,
  MAX_NAME_LENGTH,
  STYLES,
  buildTitlePrompt,
  formatWords,
  colorRowIn,
  availableColors,
  onUserColor,
  onUserNamed,
  renamedIn,
  IDLE_SHARE_MS,
  type Claim,
  cleanPrompt,
  isDue,
  isModelNotFound,
  onChecked,
  onModelMissing,
  onClear,
  shownName,
  forkParent,
  onFork,
  onPrompt,
  onRan,
  onColorFailed,
  needsColor,
  parseReply,
  pickColor,
  freeColors,
  recentOf,
  MAX_RECENT,
  appendLog,
  type SessionRecord,
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
  it.each(STYLES)('asks for names in %s', (style) => {
    const prompt = buildTitlePrompt([user('hi there')], {}, COLORS, style) ?? ''
    expect(prompt).toContain(
      style === 'free text' ? 'written naturally' : `"${formatWords(['rust', 'rewrite'], style)}"`,
    )
  })

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

describe('formatWords', () => {
  it.each([
    ['kebab-case', 'login-redirect-fix'],
    ['snake_case', 'login_redirect_fix'],
    ['camelCase', 'loginRedirectFix'],
    ['PascalCase', 'LoginRedirectFix'],
    ['Title Case', 'Login Redirect Fix'],
    ['Sentence case', 'Login redirect fix'],
  ] as const)('writes %s', (style, expected) => {
    expect(formatWords(['login', 'redirect', 'fix'], style)).toBe(expected)
  })
})

describe('sanitizeName in a style', () => {
  it('reads a name written in another style', () => {
    expect(sanitizeName('loginRedirectFix', 'snake_case')).toBe('login_redirect_fix')
    expect(sanitizeName('Übersicht Größe', 'camelCase')).toBe('übersichtGröße')
  })

  it('keeps free text as written, up to six words', () => {
    expect(sanitizeName('Fix the  login redirect', 'free text')).toBe('Fix the login redirect')
    expect(sanitizeName('one two three four five six seven', 'free text')).toBe(
      'one two three four five six',
    )
  })

  it('cuts long free text at a word', () => {
    const name = sanitizeName(`${'a'.repeat(30)} ${'b'.repeat(30)} c`, 'free text') ?? ''
    expect(name).toBe('a'.repeat(30))
    expect(name.length).toBeLessThanOrEqual(MAX_FREE_LENGTH)
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

  it('reads a name starting with keep as a name', () => {
    expect(parseReply('keep-alive-fix')).toEqual({ kind: 'name', name: 'keep-alive-fix' })
  })

  it('reads free text', () => {
    expect(parseReply('Fix the login redirect blue', 'free text')).toEqual({
      kind: 'name',
      name: 'Fix the login redirect',
      color: 'blue',
    })
  })

  it('keeps a closing color word in the name when no color was asked', () => {
    expect(parseReply('Make the button green', 'free text', [], false)).toEqual({
      kind: 'name',
      name: 'Make the button green',
    })
  })

  it('drops a color word that cannot be part of a name in the style, asked or not', () => {
    expect(parseReply('rust-rewrite orange', 'kebab-case', [], false)).toEqual({
      kind: 'name',
      name: 'rust-rewrite',
      color: 'orange',
    })
    expect(parseReply('karten-export (green)')).toEqual({
      kind: 'name',
      name: 'karten-export',
      color: 'green',
    })
  })
})

describe('parseReply with known names', () => {
  it('keeps the spelling of a known name the reply matches in the style', () => {
    expect(parseReply('karten-export-neu green', 'kebab-case', ['Karten Export Neu'])).toEqual({
      kind: 'name',
      name: 'Karten Export Neu',
      color: 'green',
    })
    expect(parseReply('Karten Export Neu', 'kebab-case', ['Karten Export Neu'])).toEqual({
      kind: 'name',
      name: 'Karten Export Neu',
    })
  })

  it('writes any other name in the style', () => {
    expect(parseReply('Karten Export', 'kebab-case', ['Karten Export Neu'])).toEqual({
      kind: 'name',
      name: 'karten-export',
    })
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
  it('keeps blue and cyan back while another color is free', () => {
    expect(freeColors([])).not.toContain('blue')
    expect(freeColors([])).not.toContain('cyan')
  })

  it('offers blue and cyan once every other color is taken', () => {
    const others = COLORS.filter((c) => c !== 'blue' && c !== 'cyan')
    expect(freeColors(others)).toEqual(['blue', 'cyan'])
    expect(freeColors([...others, 'blue'])).toEqual(['cyan'])
  })

  it('drops the taken colors', () => {
    expect(freeColors(['red', 'cyan'])).toEqual(
      COLORS.filter((c) => c !== 'red' && c !== 'cyan' && c !== 'blue'),
    )
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
      record: { applied: 'mine', color: 'red', isUserNamed: true, userName: 'theirs' },
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

describe('shownName', () => {
  it('is the name the person gave, else the one the plugin applied', () => {
    expect(shownName({ applied: 'auto', isUserNamed: true, userName: 'mine' })).toBe('mine')
    expect(shownName({ applied: 'auto' })).toBe('auto')
    expect(shownName({})).toBeUndefined()
  })
})

describe('onClear', () => {
  it('starts over and claims the title the session still shows', () => {
    expect(onClear('old-name')).toEqual({ applied: 'old-name' })
    expect(onClear(undefined)).toEqual({})
  })
})

describe('forkParent', () => {
  it('finds the newest record whose applied name the fork inherited', () => {
    const older = { applied: 'rust-rewrite', color: 'red' as const }
    const newer = { applied: 'rust-rewrite', color: 'blue' as const }
    expect(forkParent([older, { applied: 'other' }, newer], 'rust-rewrite')).toBe(newer)
  })

  it('finds none for a name the person gave, or no name', () => {
    expect(forkParent([{ applied: 'x', isUserNamed: true }], 'x')).toBeUndefined()
    expect(forkParent([{ applied: 'x' }], 'y')).toBeUndefined()
    expect(forkParent([{ applied: '' }], '')).toBeUndefined()
    expect(forkParent([{ applied: 'x' }], undefined)).toBeUndefined()
  })
})

describe('onFork', () => {
  it("starts over and drops the plugin's color", () => {
    expect(onFork({ applied: 'x', color: 'red', checkedAt: 4 }, 'x')).toEqual({ applied: 'x' })
  })

  it('keeps a color the person set', () => {
    expect(onFork({ applied: 'x', color: 'pink', isColorUserSet: true }, 'x')).toEqual({
      applied: 'x',
      color: 'pink',
      isColorUserSet: true,
    })
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

describe('onColorFailed', () => {
  it('queues the color again and forgets its run', () => {
    expect(onColorFailed({ color: 'red', ran: ['color blue', 'color red'] }, 'red')).toEqual({
      color: 'red',
      pendingColor: 'red',
      ran: ['color blue'],
    })
  })

  it("leaves a color that moved on or became the person's alone", () => {
    const moved = { color: 'blue' as const, ran: ['color red'] }
    const theirs = { color: 'red' as const, isColorUserSet: true }
    expect(onColorFailed(moved, 'red')).toBe(moved)
    expect(onColorFailed(theirs, 'red')).toBe(theirs)
  })
})

describe('needsColor', () => {
  it('asks for a color only while the session has none of its own', () => {
    expect(needsColor({})).toBe(true)
    expect(needsColor({ color: 'red' })).toBe(false)
    expect(needsColor({ isColorFixed: true })).toBe(false)
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
      'chroma-rename: model "haikoo" not found; check its Configure options in /plugin',
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

describe('renamedIn', () => {
  it('reads the name of a /rename output row', () => {
    expect(
      renamedIn('<local-command-stdout>Session renamed to: Mein Thema</local-command-stdout>'),
    ).toBe('Mein Thema')
  })

  it('ignores other rows', () => {
    expect(renamedIn('<command-name>/rename</command-name><command-args>x</command-args>')).toBe(
      undefined,
    )
    expect(
      renamedIn('<local-command-stdout>Session color set to: red</local-command-stdout>'),
    ).toBe(undefined)
  })
})

describe('onUserNamed', () => {
  it('stops the plugin, keeps the color and drops a pending name', () => {
    expect(onUserNamed({ applied: 'mine', pending: 'next', color: 'red' }, 'theirs')).toEqual({
      applied: 'mine',
      color: 'red',
      isUserNamed: true,
      userName: 'theirs',
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
    expect(availableColors([{ color: 'red' }], NOW)).toEqual(
      COLORS.filter((c) => c !== 'red' && c !== 'blue' && c !== 'cyan'),
    )
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

describe('withHolder', () => {
  const isLive = (id: string) => id !== 'gone'

  it('adds the session, keeping when it first took the color', () => {
    expect(withHolder({ a: 1 }, 's', true, 5, isLive)).toEqual({ a: 1, s: 5 })
    expect(withHolder({ s: 2 }, 's', true, 5, isLive)).toEqual({ s: 2 })
  })

  it('removes the session and drops ended ones', () => {
    expect(withHolder({ s: 1, gone: 2, a: 3 }, 's', false, 5, isLive)).toEqual({ a: 3 })
  })

  it('keeps only the newest holders', () => {
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`h${i}`, i]))
    const kept = withHolder(many, 's', true, 100, isLive)
    expect(Object.keys(kept).length).toBe(MAX_HOLDERS)
    expect(kept.s).toBe(100)
    expect(kept.h0).toBeUndefined()
  })
})

describe('claimsOf', () => {
  it("lists other live sessions' colors with their idle time", () => {
    const live = (id: string) => (id === 'gone' ? undefined : id === 'b' ? { idleSince: 7 } : {})
    expect(claimsOf({ red: { s: 1, a: 1 }, blue: { b: 1, gone: 1 } }, 's', live)).toEqual([
      { color: 'red' },
      { color: 'blue', idleSince: 7 },
    ])
  })
})

describe('idleSinceOf', () => {
  it('reads when an idle session went idle', () => {
    expect(idleSinceOf({ status: 'idle', statusUpdatedAt: 5, updatedAt: 9 })).toBe(5)
  })

  it('reads when a busy session last updated its file, so a crashed one ages', () => {
    expect(idleSinceOf({ status: 'busy', statusUpdatedAt: 5, updatedAt: 9 })).toBe(9)
  })

  it('knows nothing without times', () => {
    expect(idleSinceOf({ status: 'busy' })).toBeUndefined()
  })
})

describe('recentOf', () => {
  const noneLive = () => false

  it('lists named sessions newest first, without this one or open ones', () => {
    const records: [string, SessionRecord][] = [
      ['a', { applied: 'karten-export', color: 'blue' }],
      ['b', { applied: 'auto-name', isUserNamed: true }],
      ['c', { applied: 'login-fix', color: 'red' }],
      ['open', { applied: 'parser', color: 'green' }],
      ['me', { applied: 'mine', color: 'pink' }],
      ['d', { color: 'cyan' }],
    ]
    expect(recentOf(records, 'me', (id) => id === 'open')).toEqual([
      { name: 'login-fix', color: 'red' },
      { name: 'karten-export', color: 'blue' },
    ])
  })

  it('offers a session the person renamed under their name', () => {
    const records: [string, SessionRecord][] = [
      ['a', { applied: 'auto-name', isUserNamed: true, userName: 'Mein Thema', color: 'pink' }],
    ]
    expect(recentOf(records, 'me', noneLive)).toEqual([{ name: 'Mein Thema', color: 'pink' }])
  })

  it('keeps the newest of one name and drops the excluded one', () => {
    const records: [string, SessionRecord][] = [
      ['a', { applied: 'login-fix', color: 'blue' }],
      ['b', { applied: 'login-fix', color: 'red' }],
      ['c', { applied: 'parent-name' }],
    ]
    expect(recentOf(records, 'me', noneLive, 'parent-name')).toEqual([
      { name: 'login-fix', color: 'red' },
    ])
  })

  it(`keeps at most ${MAX_RECENT}`, () => {
    const records = Array.from({ length: 15 }, (_, i): [string, SessionRecord] => [
      `s${i}`,
      { applied: `name-${i}` },
    ])
    const recent = recentOf(records, 'me', noneLive)
    expect(recent.length).toBe(MAX_RECENT)
    expect(recent[0]).toEqual({ name: 'name-14' })
  })
})

describe('buildTitlePrompt with earlier sessions', () => {
  const messages = [{ role: 'user', text: 'Der Kartenexport bricht wieder ab' }] as const

  it('lists them and asks to reuse an obvious match', () => {
    const prompt = buildTitlePrompt(messages, {}, ['blue', 'red'], 'kebab-case', [
      { name: 'karten-export', color: 'blue' },
      { name: 'login-fix' },
    ])
    expect(prompt).toContain('Earlier sessions, newest first:\n- karten-export (blue)\n- login-fix')
    expect(prompt).toContain('reuse that name exactly')
    expect(prompt).toContain('reuse its color too')
  })

  it('says nothing about them when there are none', () => {
    const prompt = buildTitlePrompt(messages, {}, ['blue'])
    expect(prompt).not.toContain('Earlier sessions')
    expect(prompt).not.toContain('reuse')
  })
})

describe('appendLog', () => {
  it('adds the line', () => {
    expect(appendLog('a\n', 'b', 100)).toBe('a\nb\n')
  })

  it('drops the oldest whole lines past the limit', () => {
    const log = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n') + '\n'
    const trimmed = appendLog(log, 'line 10', 40)
    expect(trimmed.length).toBeLessThanOrEqual(30)
    expect(trimmed.endsWith('line 10\n')).toBe(true)
    expect(trimmed.startsWith('line ')).toBe(true)
  })
})
