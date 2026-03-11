import type {
  BatchResult,
  RegisterInput,
  RegisterOptions,
  RegisterProgress,
  RegisterResult
} from './types.ts'

interface BatchRegistrationOptions extends RegisterOptions {
  concurrency?: number
  registerOne: (
    input: RegisterInput,
    options: RegisterOptions & { onLog?: (message: string) => void }
  ) => Promise<RegisterResult>
  onLog?: (event: { email: string; message: string }) => void
  onProgress?: (progress: RegisterProgress) => void
}

function createFailureResult(email: string, startedAt: number, error: string): RegisterResult {
  return {
    success: false,
    email,
    error,
    startedAt,
    endedAt: Date.now()
  }
}

export async function runBatchRegistration(
  inputs: RegisterInput[],
  options: BatchRegistrationOptions
): Promise<BatchResult> {
  const concurrency = Math.max(1, options.concurrency ?? 3)
  const results: RegisterResult[] = new Array(inputs.length)
  let cursor = 0
  let completed = 0
  let successCount = 0
  let failedCount = 0

  const runNext = async (): Promise<void> => {
    const index = cursor
    cursor += 1

    if (index >= inputs.length) {
      return
    }

    const input = inputs[index]
    const startedAt = Date.now()

    try {
      const result = await options.registerOne(input, {
        registrationPassword: options.registrationPassword,
        skipOutlookActivation: options.skipOutlookActivation,
        proxyUrl: options.proxyUrl,
        onLog: options.onLog
          ? (message) => options.onLog?.({ email: input.email, message })
          : undefined
      })

      results[index] = result
      if (result.success) {
        successCount += 1
      } else {
        failedCount += 1
      }
    } catch (error) {
      results[index] = createFailureResult(
        input.email,
        startedAt,
        error instanceof Error ? error.message : String(error)
      )
      failedCount += 1
    } finally {
      completed += 1
      options.onProgress?.({
        completed,
        total: inputs.length,
        successCount,
        failedCount
      })
      await runNext()
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, () => runNext())
  )

  return {
    total: inputs.length,
    successCount,
    failedCount,
    results
  }
}
