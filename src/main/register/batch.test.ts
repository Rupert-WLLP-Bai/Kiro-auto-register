import test from 'node:test'
import assert from 'node:assert/strict'

import { runBatchRegistration } from './batch.ts'
import type { RegisterInput, RegisterResult } from './types.ts'

test('runBatchRegistration respects concurrency and aggregates results', async () => {
  const inputs: RegisterInput[] = [
    { email: 'a@example.com', emailPassword: '', refreshToken: 'r1', clientId: 'c1' },
    { email: 'b@example.com', emailPassword: '', refreshToken: 'r2', clientId: 'c2' },
    { email: 'c@example.com', emailPassword: '', refreshToken: 'r3', clientId: 'c3' }
  ]

  let running = 0
  let maxRunning = 0

  const result = await runBatchRegistration(inputs, {
    concurrency: 2,
    registrationPassword: 'env-password',
    registerOne: async (input): Promise<RegisterResult> => {
      running += 1
      maxRunning = Math.max(maxRunning, running)
      await new Promise((resolve) => setTimeout(resolve, 10))
      running -= 1

      return {
        success: input.email !== 'b@example.com',
        email: input.email,
        error: input.email === 'b@example.com' ? 'boom' : undefined,
        startedAt: 1,
        endedAt: 2
      }
    }
  })

  assert.equal(maxRunning, 2)
  assert.equal(result.total, 3)
  assert.equal(result.successCount, 2)
  assert.equal(result.failedCount, 1)
  assert.equal(result.results.length, 3)
})
