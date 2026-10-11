import { readFileSync, writeFileSync } from 'fs'

/** Claude Code updates an installed plugin only when plugin.json's version changes. */
const path = '.claude-plugin/plugin.json'
const manifest = JSON.parse(readFileSync(path, 'utf8'))
manifest.version = process.env.npm_package_version
writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n')
