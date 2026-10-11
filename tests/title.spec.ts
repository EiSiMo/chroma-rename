import { describe, expect, it } from 'vitest'
import {
  MAX_TITLE_LENGTH,
  buildTitlePrompt,
  cleanPrompt,
  isDue,
  onChecked,
  onPrompt,
  sanitizeTitle,
  userPrompts,
  type Message,
} from '../hooks/title.ts'

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
    expect(buildTitlePrompt([assistant('hello')], undefined)).toBeNull()
  })

  it('carries the current title, the first prompt and the latest reply', () => {
    const prompt = buildTitlePrompt(
      [user('add a cache countdown'), assistant('Added it to the status line.')],
      'Status line cache countdown',
    )
    expect(prompt).toContain('Current title: Status line cache countdown')
    expect(prompt).toContain('First prompt:\nadd a cache countdown')
    expect(prompt).toContain("Claude's latest reply:\nAdded it to the status line.")
    expect(prompt).not.toContain('Later prompts')
  })

  it('says when there is no title yet', () => {
    expect(buildTitlePrompt([user('hi there')], undefined)).toContain('Current title: (none)')
  })

  it('keeps only the latest prompts and says how many it left out', () => {
    const messages = Array.from({ length: 12 }, (_, i) => user(`prompt ${i + 1}`))
    const prompt = buildTitlePrompt(messages, undefined) ?? ''
    expect(prompt).toContain('Latest prompts, oldest first (3 earlier omitted):')
    expect(prompt).not.toContain('- prompt 4\n')
    expect(prompt).toContain('- prompt 5')
    expect(prompt).toContain('- prompt 12')
  })

  it('clips long prompts', () => {
    const prompt = buildTitlePrompt([user('x'.repeat(2000))], undefined) ?? ''
    expect(prompt).toContain(`${'x'.repeat(799)}…`)
    expect(prompt).not.toContain('x'.repeat(800))
  })
})

describe('sanitizeTitle', () => {
  it.each([
    ['"Fix login redirect loop."', 'Fix login redirect loop'],
    ['Title: Status line cache countdown', 'Status line cache countdown'],
    ['**Review PR 42**', 'Review PR 42'],
    ['Toggle go-live — venue handover', 'Toggle go-live - venue handover'],
    ['\n\n  Spaced   out   title  \nsecond line', 'Spaced out title'],
  ])('cleans %j', (raw, expected) => {
    expect(sanitizeTitle(raw)).toBe(expected)
  })

  it.each(['', '  \n ', '"."', 'ok'])('rejects %j', (raw) => {
    expect(sanitizeTitle(raw)).toBeNull()
  })

  it('cuts a long title at a word', () => {
    const title = sanitizeTitle(`${'word '.repeat(20)}end`) ?? ''
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH)
    expect(title.endsWith('word')).toBe(true)
  })

  it('cuts a long unbroken title at the limit', () => {
    expect(sanitizeTitle('y'.repeat(100))).toBe('y'.repeat(MAX_TITLE_LENGTH))
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
  it('hands over a pending title and records it as applied', () => {
    expect(onPrompt({ pending: 'New title', checkedAt: 2 }, undefined)).toEqual({
      record: { applied: 'New title', checkedAt: 2 },
      title: 'New title',
    })
  })

  it('replaces its own earlier title', () => {
    const outcome = onPrompt({ applied: 'Old', pending: 'New', checkedAt: 4 }, 'Old')
    expect(outcome.title).toBe('New')
  })

  it('treats a title it did not set as the person naming the session', () => {
    expect(onPrompt({ applied: 'Mine', pending: 'Next' }, 'Theirs')).toEqual({
      record: { isUserNamed: true },
    })
  })

  it('stays out once the person has named the session', () => {
    const record = { isUserNamed: true }
    expect(onPrompt(record, undefined)).toEqual({ record })
  })

  it('drops a pending title the session already has', () => {
    expect(onPrompt({ applied: 'Same', pending: 'Same' }, 'Same')).toEqual({
      record: { applied: 'Same', pending: undefined },
    })
  })
})

describe('onChecked', () => {
  it('queues a new title', () => {
    expect(onChecked({ applied: 'Old' }, 4, 'New')).toEqual({
      applied: 'Old',
      checkedAt: 4,
      pending: 'New',
    })
  })

  it('queues nothing when the title is unchanged or missing', () => {
    expect(onChecked({ applied: 'Same' }, 4, 'Same').pending).toBeUndefined()
    expect(onChecked({ applied: 'Same', pending: 'Stale' }, 4, null).pending).toBeUndefined()
  })
})
