import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface RegisterConfig {
  registrationPassword: string
}

interface LoadRegisterConfigOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

async function readDotEnv(cwd: string): Promise<Record<string, string>> {
  const envPath = join(cwd, '.env')

  try {
    const content = await readFile(envPath, 'utf8')
    const values: Record<string, string> = {}

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) {
        continue
      }

      const separatorIndex = trimmed.indexOf('=')
      if (separatorIndex === -1) {
        continue
      }

      const key = trimmed.slice(0, separatorIndex).trim()
      const value = trimmed.slice(separatorIndex + 1).trim()

      if (key) {
        values[key] = value
      }
    }

    return values
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return {}
    }

    throw error
  }
}

export async function loadRegisterConfig(
  options: LoadRegisterConfigOptions = {}
): Promise<RegisterConfig> {
  const cwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env
  const fileEnv = await readDotEnv(cwd)

  const password = (env.AWS_REGISTER_PASSWORD ?? fileEnv.AWS_REGISTER_PASSWORD ?? '').trim()

  if (!password) {
    throw new Error('Missing required AWS_REGISTER_PASSWORD in .env')
  }

  return { registrationPassword: password }
}
