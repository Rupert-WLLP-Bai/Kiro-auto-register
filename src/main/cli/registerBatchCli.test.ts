import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runRegisterBatchCli } from './registerBatchCli.ts'

test('runRegisterBatchCli writes json, success, and failure outputs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'register-cli-'))
  const inputPath = join(dir, 'accounts.txt')
  const outPath = join(dir, 'results.json')
  const successPath = join(dir, 'success.txt')
  const failPath = join(dir, 'failed.txt')

  await writeFile(
    inputPath,
    [
      '# comment',
      'ok@example.com|mail-pass|refresh-ok|client-ok',
      'bad@example.com|mail-pass|refresh-bad|client-bad',
      'broken-line'
    ].join('\n'),
    'utf8'
  )

  const logs: string[] = []

  const exitCode = await runRegisterBatchCli(
    [
      '--input',
      inputPath,
      '--out',
      outPath,
      '--success-out',
      successPath,
      '--fail-out',
      failPath,
      '--concurrency',
      '2'
    ],
    {
      cwd: dir,
      stdout: (line) => logs.push(`OUT:${line}`),
      stderr: (line) => logs.push(`ERR:${line}`),
      loadConfig: async () => ({ registrationPassword: 'env-password' }),
      runBatch: async (entries, options) => {
        assert.equal(options.registrationPassword, 'env-password')
        return {
          total: entries.length,
          successCount: 1,
          failedCount: 1,
          results: [
            {
              success: true,
              email: 'ok@example.com',
              name: 'Ok User',
              ssoToken: 'token-ok',
              startedAt: 1,
              endedAt: 2
            },
            {
              success: false,
              email: 'bad@example.com',
              error: 'register failed',
              startedAt: 1,
              endedAt: 2
            }
          ]
        }
      }
    }
  )

  assert.equal(exitCode, 1)

  const jsonOutput = JSON.parse(await readFile(outPath, 'utf8')) as {
    total: number
    successCount: number
    failedCount: number
    invalidCount: number
  }
  assert.equal(jsonOutput.total, 3)
  assert.equal(jsonOutput.successCount, 1)
  assert.equal(jsonOutput.failedCount, 2)
  assert.equal(jsonOutput.invalidCount, 1)

  const successOutput = await readFile(successPath, 'utf8')
  const failOutput = await readFile(failPath, 'utf8')

  assert.match(successOutput, /ok@example\.com\|Ok User\|token-ok/)
  assert.match(failOutput, /bad@example\.com\|register failed/)
  assert.match(failOutput, /broken-line/)
  assert.ok(logs.some((line) => line.includes('批量注册完成')))
})
