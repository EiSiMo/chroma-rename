import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as Record<string, unknown>

/** The folder the marketplace entry installs, relative to the repo root. */
const PLUGIN = ((): string => {
  const marketplace = readJson('.claude-plugin/marketplace.json') as {
    plugins: { name: string; source: string }[]
  }
  const entry = marketplace.plugins.find((p) => p.name === 'tintname')
  if (entry === undefined) throw new Error('No tintname entry in the marketplace')
  return entry.source
})()

const MANIFEST = join(PLUGIN, '.claude-plugin/plugin.json')
const ICON = join(PLUGIN, '.claude-plugin/icon.png')

describe('plugin folder', () => {
  it('holds the manifest the marketplace entry names', () => {
    expect(readJson(MANIFEST).name).toBe('tintname')
  })

  it('ships only the manifest, icon, README, hooks and engine tests', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: join(ROOT, PLUGIN), encoding: 'utf8' })
    expect(tracked.trim().split('\n').sort()).toEqual([
      '.claude-plugin/icon.png',
      '.claude-plugin/plugin.json',
      'README.md',
      'hooks/hooks.json',
      'hooks/register.ts',
      'hooks/title.ts',
      'tests/register.test.ts',
    ])
  })
})

describe('plugin icon', () => {
  const PNG_SIGNATURE = '89504e470d0a1a0a'
  /** Where the first chunk's type, width and height sit in a PNG file. */
  const IHDR = { type: 12, width: 16, height: 20 }

  it('is a square PNG between 512 and 2048 px under 2 MB', () => {
    const png = readFileSync(join(ROOT, ICON))
    const width = png.readUInt32BE(IHDR.width)
    const height = png.readUInt32BE(IHDR.height)

    expect(png.subarray(0, 8).toString('hex')).toBe(PNG_SIGNATURE)
    expect(png.subarray(IHDR.type, IHDR.type + 4).toString('ascii')).toBe('IHDR')
    expect(width).toBe(height)
    expect(width).toBeGreaterThanOrEqual(512)
    expect(width).toBeLessThanOrEqual(2048)
    expect(statSync(join(ROOT, ICON)).size).toBeLessThan(2 * 1024 * 1024)
  })
})

describe('version bump', () => {
  let dir: string | undefined

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  })

  it('changes only the version line of the plugin manifest', () => {
    dir = mkdtempSync(join(tmpdir(), 'version-bump-'))
    cpSync(join(ROOT, MANIFEST), join(dir, MANIFEST))
    execFileSync('node', [join(ROOT, 'version-bump.mjs')], {
      cwd: dir,
      env: { ...process.env, npm_package_version: '9.8.7' },
    })

    const before = readFileSync(join(ROOT, MANIFEST), 'utf8').split('\n')
    const after = readFileSync(join(dir, MANIFEST), 'utf8').split('\n')
    const changed = after.filter((line, i) => line !== before[i])

    expect(after.length).toBe(before.length)
    expect(changed).toEqual(['  "version": "9.8.7",'])
  })
})
