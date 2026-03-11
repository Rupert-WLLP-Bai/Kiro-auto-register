import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadRegisterConfig } from './config.ts'

test('loadRegisterConfig reads AWS_REGISTER_PASSWORD from .env', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'register-config-'))
  await writeFile(join(dir, '.env'), 'AWS_REGISTER_PASSWORD=strong-pass-123\n', 'utf8')

  const config = await loadRegisterConfig({ cwd: dir, env: {} })

  assert.equal(config.registrationPassword, 'strong-pass-123')
})

test('loadRegisterConfig rejects missing AWS_REGISTER_PASSWORD', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'register-config-missing-'))

  await assert.rejects(
    () => loadRegisterConfig({ cwd: dir, env: {} }),
    /AWS_REGISTER_PASSWORD/
  )
})

test('loadRegisterConfig rejects blank AWS_REGISTER_PASSWORD', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'register-config-blank-'))
  await writeFile(join(dir, '.env'), 'AWS_REGISTER_PASSWORD=   \n', 'utf8')

  await assert.rejects(
    () => loadRegisterConfig({ cwd: dir, env: {} }),
    /AWS_REGISTER_PASSWORD/
  )
})
