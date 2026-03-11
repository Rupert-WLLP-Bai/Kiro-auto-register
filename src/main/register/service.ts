import type { RegisterInput, RegisterOptions, RegisterResult } from './types.ts'

export async function registerOneWithPlaywright(
  input: RegisterInput,
  options: RegisterOptions & { onLog?: (message: string) => void }
): Promise<RegisterResult> {
  const startedAt = Date.now()
  const { autoRegisterAWS } = await import('../autoRegister.ts')

  const result = await autoRegisterAWS(
    input.email,
    input.refreshToken,
    input.clientId,
    options.onLog ?? (() => undefined),
    input.emailPassword || undefined,
    options.skipOutlookActivation ?? false,
    options.proxyUrl,
    undefined,
    undefined,
    undefined,
    options.registrationPassword
  )

  return {
    success: result.success,
    email: input.email,
    name: result.name,
    ssoToken: result.ssoToken,
    error: result.error,
    startedAt,
    endedAt: Date.now()
  }
}
