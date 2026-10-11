import { readFileSync, writeFileSync } from 'fs'

/**
 * Claude Code updates an installed plugin only when plugin.json's version changes.
 * Only the version string is replaced, so the file keeps its Prettier formatting.
 */
const path = '.claude-plugin/plugin.json'
const manifest = readFileSync(path, 'utf8')
const VERSION = /("version":\s*")[^"]*(")/
if (!VERSION.test(manifest)) throw new Error(`No version field in ${path}`)
writeFileSync(path, manifest.replace(VERSION, `$1${process.env.npm_package_version}$2`))
