export interface RegisterInput {
  email: string
  emailPassword: string
  refreshToken: string
  clientId: string
}

export interface RegisterOptions {
  registrationPassword: string
  skipOutlookActivation?: boolean
  proxyUrl?: string
}

export interface RegisterResult {
  success: boolean
  email: string
  name?: string
  ssoToken?: string
  error?: string
  startedAt: number
  endedAt: number
}

export interface BatchResult {
  total: number
  successCount: number
  failedCount: number
  results: RegisterResult[]
}

export interface InvalidRegisterEntry {
  lineNumber: number
  rawLine: string
  error: string
}

export interface ParsedRegisterAccounts {
  entries: RegisterInput[]
  invalidEntries: InvalidRegisterEntry[]
}

export type RegisterLogCallback = (message: string) => void

export interface RegisterProgress {
  completed: number
  total: number
  successCount: number
  failedCount: number
}
