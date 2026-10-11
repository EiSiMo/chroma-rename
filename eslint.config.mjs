import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig(
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['version-bump.mjs', 'eslint.config.mjs'],
    languageOptions: { globals: globals.node },
  },
  globalIgnores(['node_modules', 'vendor', 'plugin/.claude-plugin/types', 'coverage']),
)
