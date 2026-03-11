import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'

import { loadRegisterAccountsFile } from '../register/accountsFile.ts'
import { runBatchRegistration } from '../register/batch.ts'
import { loadRegisterConfig } from '../register/config.ts'
import type { BatchResult, InvalidRegisterEntry, RegisterOptions } from '../register/types.ts'
import { registerOneWithPlaywright } from '../register/service.ts'

interface CliDependencies {
  cwd?: string
  stdout?: (line: string) => void
  stderr?: (line: string) => void
  loadConfig?: typeof loadRegisterConfig
  loadAccountsFile?: typeof loadRegisterAccountsFile
  runBatch?: typeof runBatchRegistration
  writeTextFile?: (filePath: string, content: string) => Promise<void>
}

interface CliArgs {
  inputPath: string
  concurrency: number
  skipOutlookActivation: boolean
  proxyUrl?: string
  outPath?: string
  successOutPath?: string
  failOutPath?: string
}

function printUsage(write: (line: string) => void): void {
  write(
    'Usage: bun run register:batch -- --input <accounts.txt> [--concurrency 3] [--skip-outlook-activation] [--proxy <url>] [--out <results.json>] [--success-out <success.txt>] [--fail-out <failed.txt>]'
  )
}

function defaultTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function resolvePath(cwd: string, filePath: string): string {
  return isAbsolute(filePath) ? filePath : join(cwd, filePath)
}

function toJsonOutput(
  batchResult: BatchResult,
  invalidEntries: InvalidRegisterEntry[]
): Record<string, unknown> {
  return {
    total: batchResult.total + invalidEntries.length,
    successCount: batchResult.successCount,
    failedCount: batchResult.failedCount + invalidEntries.length,
    invalidCount: invalidEntries.length,
    results: batchResult.results,
    invalidEntries
  }
}

function formatSuccessLines(batchResult: BatchResult): string {
  return batchResult.results
    .filter((result) => result.success)
    .map((result) => `${result.email}|${result.name ?? ''}|${result.ssoToken ?? ''}`)
    .join('\n')
}

function formatFailureLines(
  batchResult: BatchResult,
  invalidEntries: InvalidRegisterEntry[]
): string {
  const failedResults = batchResult.results
    .filter((result) => !result.success)
    .map((result) => `${result.email}|${result.error ?? 'Unknown error'}`)
  const invalidLines = invalidEntries.map(
    (entry) => `[line ${entry.lineNumber}] ${entry.rawLine}|${entry.error}`
  )

  return [...failedResults, ...invalidLines].join('\n')
}

function parseCliArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    inputPath: '',
    concurrency: 3,
    skipOutlookActivation: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--input') {
      parsed.inputPath = argv[++index] ?? ''
    } else if (arg === '--concurrency') {
      parsed.concurrency = Number.parseInt(argv[++index] ?? '', 10)
    } else if (arg === '--skip-outlook-activation') {
      parsed.skipOutlookActivation = true
    } else if (arg === '--proxy') {
      parsed.proxyUrl = argv[++index] ?? ''
    } else if (arg === '--out') {
      parsed.outPath = argv[++index] ?? ''
    } else if (arg === '--success-out') {
      parsed.successOutPath = argv[++index] ?? ''
    } else if (arg === '--fail-out') {
      parsed.failOutPath = argv[++index] ?? ''
    } else if (arg === '--help' || arg === '-h') {
      throw new Error('__PRINT_USAGE__')
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!parsed.inputPath) {
    throw new Error('Missing required --input argument')
  }

  if (!Number.isInteger(parsed.concurrency) || parsed.concurrency <= 0) {
    throw new Error('Invalid --concurrency value')
  }

  return parsed
}

async function writeOutputFile(
  filePath: string,
  content: string,
  writeTextFile: (filePath: string, content: string) => Promise<void>
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeTextFile(filePath, content)
}

export async function runRegisterBatchCli(
  argv: string[],
  dependencies: CliDependencies = {}
): Promise<number> {
  const cwd = dependencies.cwd ?? process.cwd()
  const stdout = dependencies.stdout ?? ((line: string) => console.log(line))
  const stderr = dependencies.stderr ?? ((line: string) => console.error(line))
  const loadConfigFn = dependencies.loadConfig ?? loadRegisterConfig
  const loadAccountsFileFn = dependencies.loadAccountsFile ?? loadRegisterAccountsFile
  const runBatchFn = dependencies.runBatch ?? runBatchRegistration
  const writeTextFile =
    dependencies.writeTextFile ??
    (async (filePath: string, content: string) => {
      await writeFile(filePath, content, 'utf8')
    })

  let args: CliArgs
  try {
    args = parseCliArgs(argv)
  } catch (error) {
    if (error instanceof Error && error.message === '__PRINT_USAGE__') {
      printUsage(stdout)
      return 0
    }

    stderr(error instanceof Error ? error.message : String(error))
    printUsage(stderr)
    return 1
  }

  try {
    const config = await loadConfigFn({ cwd, env: process.env })
    const parsed = await loadAccountsFileFn(resolvePath(cwd, args.inputPath))
    const batchOptions: RegisterOptions = {
      registrationPassword: config.registrationPassword,
      skipOutlookActivation: args.skipOutlookActivation,
      proxyUrl: args.proxyUrl
    }

    const batchResult = await runBatchFn(parsed.entries, {
      ...batchOptions,
      concurrency: args.concurrency,
      registerOne: registerOneWithPlaywright,
      onLog: ({ email, message }) => {
        stdout(`[${email}] ${message}`)
      }
    })

    const timestamp = defaultTimestamp()
    const outPath = resolvePath(cwd, args.outPath || `register-results-${timestamp}.json`)
    const successOutPath = resolvePath(
      cwd,
      args.successOutPath || `register-success-${timestamp}.txt`
    )
    const failOutPath = resolvePath(cwd, args.failOutPath || `register-failed-${timestamp}.txt`)

    await writeOutputFile(
      outPath,
      JSON.stringify(toJsonOutput(batchResult, parsed.invalidEntries), null, 2),
      writeTextFile
    )
    await writeOutputFile(successOutPath, formatSuccessLines(batchResult), writeTextFile)
    await writeOutputFile(
      failOutPath,
      formatFailureLines(batchResult, parsed.invalidEntries),
      writeTextFile
    )

    const totalFailures = batchResult.failedCount + parsed.invalidEntries.length
    stdout(
      `批量注册完成: 总计 ${batchResult.total + parsed.invalidEntries.length} 个，成功 ${batchResult.successCount} 个，失败 ${totalFailures} 个`
    )
    stdout(`结果文件: ${outPath}`)

    return totalFailures > 0 ? 1 : 0
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error))
    return 1
  }
}
