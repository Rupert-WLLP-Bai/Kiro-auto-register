import { readFile } from 'node:fs/promises'

import type { ParsedRegisterAccounts, RegisterInput } from './types.ts'

function parseLine(line: string): { entry?: RegisterInput; error?: string } {
  const parts = line.split('|')

  if (parts.length !== 4) {
    return { error: 'Invalid account format: expected 4 pipe-separated fields' }
  }

  const [email, emailPassword, refreshToken, clientId] = parts.map((part) => part.trim())

  if (!email || !email.includes('@')) {
    return { error: 'Invalid email address' }
  }

  if (!refreshToken) {
    return { error: 'Missing refresh token' }
  }

  if (!clientId) {
    return { error: 'Missing client id' }
  }

  return {
    entry: {
      email,
      emailPassword,
      refreshToken,
      clientId
    }
  }
}

export function parseRegisterAccountsText(text: string): ParsedRegisterAccounts {
  const entries: RegisterInput[] = []
  const invalidEntries: ParsedRegisterAccounts['invalidEntries'] = []
  const lines = text.split(/\r?\n/)

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1
    const trimmed = rawLine.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      return
    }

    const { entry, error } = parseLine(trimmed)
    if (entry) {
      entries.push(entry)
      return
    }

    invalidEntries.push({
      lineNumber,
      rawLine: trimmed,
      error: error ?? 'Invalid account line'
    })
  })

  return { entries, invalidEntries }
}

export async function loadRegisterAccountsFile(filePath: string): Promise<ParsedRegisterAccounts> {
  const content = await readFile(filePath, 'utf8')
  return parseRegisterAccountsText(content)
}
