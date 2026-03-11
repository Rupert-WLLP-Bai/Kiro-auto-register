import test from 'node:test'
import assert from 'node:assert/strict'

import { parseRegisterAccountsText } from './accountsFile.ts'

test('parseRegisterAccountsText parses valid account lines and skips comments', () => {
  const result = parseRegisterAccountsText(`
# comment
alice@example.com|mail-password|refresh-1|client-1

bob@example.com||refresh-2|client-2
`)

  assert.equal(result.entries.length, 2)
  assert.deepEqual(result.entries[0], {
    email: 'alice@example.com',
    emailPassword: 'mail-password',
    refreshToken: 'refresh-1',
    clientId: 'client-1'
  })
  assert.deepEqual(result.entries[1], {
    email: 'bob@example.com',
    emailPassword: '',
    refreshToken: 'refresh-2',
    clientId: 'client-2'
  })
  assert.equal(result.invalidEntries.length, 0)
})

test('parseRegisterAccountsText reports invalid lines with line numbers', () => {
  const result = parseRegisterAccountsText(`
invalid-line
carol@example.com|mail-password||client-3
`)

  assert.equal(result.entries.length, 0)
  assert.equal(result.invalidEntries.length, 2)
  assert.equal(result.invalidEntries[0]?.lineNumber, 2)
  assert.match(result.invalidEntries[0]?.error ?? '', /格式|fields|字段/i)
  assert.equal(result.invalidEntries[1]?.lineNumber, 3)
  assert.match(result.invalidEntries[1]?.error ?? '', /refresh token/i)
})
