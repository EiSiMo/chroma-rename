import { defineConfig } from 'vitest/config'

/** `*.test.ts` files belong to `claude plugin test`, which runs them against the engine. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
})
