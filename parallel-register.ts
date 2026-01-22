/**
 * 并行注册脚本 - 简化版 MVP
 *
 * 功能：
 * 1. 使用 p-queue 管理并发任务
 * 2. 共享浏览器实例，每个任务使用独立 context
 * 3. 使用 ora 显示实时进度
 * 4. 支持失败自动重试
 * 5. 任务间随机延迟启动
 *
 * 使用方法：
 * npx tsx parallel-register.ts \
 *   --accounts-file ids_cleaned.txt \
 *   --start-index 34 \
 *   --count 5 \
 *   --concurrency 2 \
 *   --aiclient-path /path/to/AIClient-2-API
 */

import { chromium, Browser, BrowserContext } from 'playwright'
import PQueue from 'p-queue'
import ora, { Ora } from 'ora'
import * as fs from 'fs/promises'
import * as path from 'path'
import { activateOutlook, autoRegisterAWS } from './src/main/autoRegister'
import { registerClient, deviceAuthorization, pollToken, autoAuthorize } from './src/main/awsOidc'

// ============ 类型定义 ============
interface AccountData {
  email: string
  password: string
  refreshToken: string
  clientId: string
  backupEmail?: string
  backupRefreshToken?: string
  backupClientId?: string
}

interface Task {
  id: string
  account: AccountData
  retryCount: number
  maxRetries: number
}

interface TaskResult {
  taskId: string
  email: string
  success: boolean
  error?: string
  ssoToken?: string
  name?: string
}

interface Args {
  accountsFile: string
  startIndex: number
  count: number
  concurrency: number
  delayMin: number
  delayMax: number
  maxRetries: number
  aiclientPath: string
  skipActivation: boolean
  proxyUrl?: string
  backupAccountsFile?: string
  backupStartIndex?: number
  resume?: boolean
  stateFile?: string
  resumeFromStep?: number
}

// ============ 状态管理 ============
interface TaskState {
  taskId: string
  email: string
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed'
  currentStep: number
  completedSteps: number[]
  pauseReason?: string
  pauseMessage?: string
  retryCount: number
  lastError?: string
  ssoToken?: string
  awsClientId?: string
  awsClientSecret?: string
  startTime?: string
  pauseTime?: string
  endTime?: string
}

interface SessionState {
  sessionId: string
  startTime: string
  config: {
    accountsFile: string
    startIndex: number
    count: number
    concurrency: number
    backupAccountsFile?: string
    backupStartIndex?: number
  }
  tasks: TaskState[]
}

class StateManager {
  private stateFile: string
  private state: SessionState | null = null

  constructor(stateFile: string = '.parallel-register-state.json') {
    this.stateFile = stateFile
  }

  async loadState(): Promise<SessionState | null> {
    try {
      const content = await fs.readFile(this.stateFile, 'utf-8')
      this.state = JSON.parse(content)
      return this.state
    } catch (error) {
      // File doesn't exist or is invalid
      return null
    }
  }

  async initializeState(config: SessionState['config']): Promise<void> {
    this.state = {
      sessionId: new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19),
      startTime: new Date().toISOString(),
      config,
      tasks: []
    }
    await this.saveState()
  }

  async saveState(): Promise<void> {
    if (!this.state) return

    try {
      // Atomic write: write to temp file first, then rename
      const tempFile = `${this.stateFile}.tmp`
      await fs.writeFile(tempFile, JSON.stringify(this.state, null, 2), 'utf-8')
      await fs.rename(tempFile, this.stateFile)
    } catch (error) {
      log(`⚠️ 保存状态文件失败: ${error}`)
    }
  }

  initializeTask(taskId: string, email: string): void {
    if (!this.state) return

    const existingTask = this.state.tasks.find(t => t.taskId === taskId)
    if (!existingTask) {
      this.state.tasks.push({
        taskId,
        email,
        status: 'pending',
        currentStep: 0,
        completedSteps: [],
        retryCount: 0,
        startTime: new Date().toISOString()
      })
    }
  }

  updateTaskState(taskId: string, updates: Partial<TaskState>): void {
    if (!this.state) return

    const task = this.state.tasks.find(t => t.taskId === taskId)
    if (task) {
      Object.assign(task, updates)
    }
  }

  getTaskState(taskId: string): TaskState | undefined {
    if (!this.state) return undefined
    return this.state.tasks.find(t => t.taskId === taskId)
  }

  getPausedTasks(): TaskState[] {
    if (!this.state) return []
    return this.state.tasks.filter(t => t.status === 'paused')
  }

  getCompletedTasks(): TaskState[] {
    if (!this.state) return []
    return this.state.tasks.filter(t => t.status === 'completed')
  }

  getFailedTasks(): TaskState[] {
    if (!this.state) return []
    return this.state.tasks.filter(t => t.status === 'failed')
  }

  getPendingTasks(): TaskState[] {
    if (!this.state) return []
    return this.state.tasks.filter(t => t.status === 'pending' || t.status === 'paused')
  }

  getState(): SessionState | null {
    return this.state
  }
}

// ============ 命令行参数解析 ============
function parseArgs(): Args {
  const args = process.argv.slice(2)
  const parsed: Partial<Args> = {
    concurrency: 2,
    delayMin: 5,
    delayMax: 15,
    maxRetries: 2,
    skipActivation: false,
    aiclientPath: '/Users/pejoyll/Desktop/code/2026/AIClient-2-API'
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const nextArg = args[i + 1]

    switch (arg) {
      case '--accounts-file':
        parsed.accountsFile = nextArg
        i++
        break
      case '--start-index':
        parsed.startIndex = parseInt(nextArg)
        i++
        break
      case '--count':
        parsed.count = parseInt(nextArg)
        i++
        break
      case '--concurrency':
        parsed.concurrency = parseInt(nextArg)
        i++
        break
      case '--delay-min':
        parsed.delayMin = parseInt(nextArg)
        i++
        break
      case '--delay-max':
        parsed.delayMax = parseInt(nextArg)
        i++
        break
      case '--max-retries':
        parsed.maxRetries = parseInt(nextArg)
        i++
        break
      case '--aiclient-path':
        parsed.aiclientPath = nextArg
        i++
        break
      case '--skip-activation':
        parsed.skipActivation = true
        break
      case '--proxy':
        parsed.proxyUrl = nextArg
        i++
        break
      case '--backup-accounts-file':
        parsed.backupAccountsFile = nextArg
        i++
        break
      case '--backup-start-index':
        parsed.backupStartIndex = parseInt(nextArg)
        i++
        break
      case '--resume':
        parsed.resume = true
        break
      case '--state-file':
        parsed.stateFile = nextArg
        i++
        break
      case '--resume-from-step':
        parsed.resumeFromStep = parseInt(nextArg)
        i++
        break
    }
  }

  // 验证必需参数（resume 模式下不需要所有参数）
  if (!parsed.resume && (!parsed.accountsFile || parsed.startIndex === undefined || !parsed.count)) {
    console.error('❌ 缺少必需参数！')
    console.log('\n使用方法：')
    console.log('\n1. 新任务：')
    console.log('npx tsx parallel-register.ts \\')
    console.log('  --accounts-file ids_cleaned.txt \\')
    console.log('  --start-index 34 \\')
    console.log('  --count 5 \\')
    console.log('  [--concurrency 2] \\')
    console.log('  [--aiclient-path /path/to/AIClient-2-API] (默认: /Users/pejoyll/Desktop/code/2026/AIClient-2-API) \\')
    console.log('  [--delay-min 5] \\')
    console.log('  [--delay-max 15] \\')
    console.log('  [--max-retries 2] \\')
    console.log('  [--skip-activation] \\')
    console.log('  [--proxy http://127.0.0.1:7890] \\')
    console.log('  [--backup-accounts-file backup-accounts.txt] \\')
    console.log('  [--backup-start-index 0]')
    console.log('\n2. 恢复任务：')
    console.log('npx tsx parallel-register.ts \\')
    console.log('  --resume \\')
    console.log('  [--state-file .parallel-register-state.json] \\')
    console.log('  [--resume-from-step 3]')
    process.exit(1)
  }

  return parsed as Args
}

// ============ 工具函数 ============
function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function log(message: string): void {
  const timestamp = new Date().toISOString().slice(11, 19)
  console.log(`[${timestamp}] ${message}`)
}

// ============ 读取账号数据 ============
async function loadAccounts(
  mainFile: string,
  mainStartIndex: number,
  count: number,
  backupFile?: string,
  backupStartIndex?: number
): Promise<AccountData[]> {
  log('📋 加载账号数据...')

  // 加载主邮箱数据
  const mainContent = await fs.readFile(mainFile, 'utf-8')
  const mainLines = mainContent.split('\n').filter(line => line.trim())
  log(`   主邮箱文件: ${mainFile} (共 ${mainLines.length} 行)`)

  // 加载辅助邮箱数据（如果提供）
  let backupLines: string[] = []
  if (backupFile) {
    const backupContent = await fs.readFile(backupFile, 'utf-8')
    backupLines = backupContent.split('\n').filter(line => line.trim())
    log(`   辅助邮箱文件: ${backupFile} (共 ${backupLines.length} 行)`)
  }

  const accounts: AccountData[] = []
  const actualBackupStartIndex = backupStartIndex ?? mainStartIndex

  log(`   主邮箱起始索引: ${mainStartIndex}`)
  if (backupFile) {
    log(`   辅助邮箱起始索引: ${actualBackupStartIndex}`)
  }

  for (let i = 0; i < count; i++) {
    const mainIndex = mainStartIndex + i
    const backupIndex = actualBackupStartIndex + i

    if (mainIndex >= mainLines.length) {
      log(`⚠️ 主邮箱索引 ${mainIndex} 超出范围，停止加载`)
      break
    }

    const mainLine = mainLines[mainIndex].trim()
    if (!mainLine) continue

    const mainParts = mainLine.split('|')
    if (mainParts.length < 4) {
      log(`⚠️ 跳过格式错误的行 ${mainIndex}: ${mainLine}`)
      continue
    }

    const account: AccountData = {
      email: mainParts[0].trim(),
      password: mainParts[1].trim(),
      refreshToken: mainParts[2].trim(),
      clientId: mainParts[3].trim()
    }

    // 如果有独立的辅助邮箱文件，从中读取
    if (backupFile && backupIndex < backupLines.length) {
      const backupLine = backupLines[backupIndex].trim()
      if (backupLine) {
        const backupParts = backupLine.split('|')
        if (backupParts.length >= 3) {
          account.backupEmail = backupParts[0].trim()
          account.backupRefreshToken = backupParts[1].trim()
          account.backupClientId = backupParts[2].trim()
          log(`   ✓ [${i + 1}] 主邮箱: ${account.email} + 辅助邮箱: ${account.backupEmail}`)
        } else {
          log(`   ⚠️ 辅助邮箱行 ${backupIndex} 格式错误: ${backupLine}`)
          log(`   ✓ [${i + 1}] 主邮箱: ${account.email} (无辅助邮箱)`)
        }
      }
    }
    // 否则尝试从主文件的第 4-6 列读取（兼容旧格式）
    else if (mainParts.length >= 7) {
      account.backupEmail = mainParts[4]?.trim()
      account.backupRefreshToken = mainParts[5]?.trim()
      account.backupClientId = mainParts[6]?.trim()
      if (account.backupEmail) {
        log(`   ✓ [${i + 1}] 主邮箱: ${account.email} + 辅助邮箱: ${account.backupEmail} (从主文件)`)
      } else {
        log(`   ✓ [${i + 1}] 主邮箱: ${account.email} (无辅助邮箱)`)
      }
    } else {
      log(`   ✓ [${i + 1}] 主邮箱: ${account.email} (无辅助邮箱)`)
    }

    accounts.push(account)
  }

  log(`✅ 成功加载 ${accounts.length} 个账号`)
  return accounts
}

// ============ 浏览器池管理 ============
class BrowserPool {
  private browser: Browser | null = null
  private contexts: Map<string, BrowserContext> = new Map()
  private proxyUrl?: string

  constructor(proxyUrl?: string) {
    this.proxyUrl = proxyUrl
  }

  async initialize(): Promise<void> {
    if (!this.browser) {
      log('🌐 启动共享浏览器实例...')
      this.browser = await chromium.launch({
        headless: false,
        proxy: this.proxyUrl ? { server: this.proxyUrl } : undefined,
        args: ['--disable-blink-features=AutomationControlled']
      })
      log('✅ 浏览器启动成功')
    }
  }

  async createContext(taskId: string): Promise<BrowserContext> {
    if (!this.browser) {
      await this.initialize()
    }

    const context = await this.browser!.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    })

    this.contexts.set(taskId, context)
    return context
  }

  async closeContext(taskId: string): Promise<void> {
    const context = this.contexts.get(taskId)
    if (context) {
      await context.close()
      this.contexts.delete(taskId)
    }
  }

  async cleanup(): Promise<void> {
    // 关闭所有 context
    for (const [taskId, context] of this.contexts) {
      try {
        await context.close()
      } catch (error) {
        log(`⚠️ 关闭 context ${taskId} 失败: ${error}`)
      }
    }
    this.contexts.clear()

    // 关闭浏览器
    if (this.browser) {
      try {
        await this.browser.close()
      } catch (error) {
        log(`⚠️ 关闭浏览器失败: ${error}`)
      }
      this.browser = null
    }
  }
}

// ============ 进度监控 ============
class ProgressMonitor {
  private spinners: Map<string, Ora> = new Map()
  private results: TaskResult[] = []

  startTask(taskId: string, email: string): void {
    const spinner = ora(`[${email}] 开始注册...`).start()
    this.spinners.set(taskId, spinner)
  }

  updateTask(taskId: string, email: string, step: string): void {
    const spinner = this.spinners.get(taskId)
    if (spinner) {
      spinner.text = `[${email}] ${step}`
    }
  }

  completeTask(result: TaskResult): void {
    const spinner = this.spinners.get(result.taskId)
    if (spinner) {
      if (result.success) {
        spinner.succeed(`[${result.email}] ✅ 注册成功`)
      } else {
        spinner.fail(`[${result.email}] ❌ 注册失败: ${result.error}`)
      }
    }
    this.results.push(result)
  }

  displaySummary(): void {
    const total = this.results.length
    const success = this.results.filter(r => r.success).length
    const failed = this.results.filter(r => !r.success).length

    console.log('\n========== 注册统计 ==========')
    console.log(`总计: ${total}`)
    console.log(`成功: ${success}`)
    console.log(`失败: ${failed}`)
    console.log(`成功率: ${((success / total) * 100).toFixed(2)}%`)

    if (failed > 0) {
      console.log('\n失败任务:')
      this.results.filter(r => !r.success).forEach(r => {
        console.log(`- ${r.email}: ${r.error}`)
      })
    }
  }
}

// ============ 核心注册逻辑 ============
async function executeRegistration(
  task: Task,
  browserPool: BrowserPool,
  monitor: ProgressMonitor,
  stateManager: StateManager,
  args: Args
): Promise<TaskResult> {
  const { account } = task
  const taskLogger = (message: string) => {
    log(`[${account.email}] ${message}`)
    // 提取步骤信息更新进度
    if (message.includes('步骤')) {
      monitor.updateTask(task.id, account.email, message)
    }
  }

  let context: BrowserContext | null = null

  // 从状态恢复
  const savedState = stateManager.getTaskState(task.id)
  const startStep = args.resumeFromStep ?? savedState?.currentStep ?? 0
  const completedSteps = new Set(savedState?.completedSteps ?? [])

  // 如果任务已完成，直接返回
  if (savedState?.status === 'completed') {
    taskLogger('✅ 任务已完成，跳过')
    return {
      taskId: task.id,
      email: account.email,
      success: true,
      ssoToken: savedState.ssoToken
    }
  }

  try {
    monitor.startTask(task.id, account.email)
    stateManager.updateTaskState(task.id, {
      status: 'running',
      startTime: savedState?.startTime ?? new Date().toISOString()
    })
    await stateManager.saveState()

    // 步骤 1: 激活 Outlook（如果需要且未完成）
    if (startStep <= 1 && !completedSteps.has(1)) {
      if (!args.skipActivation && account.email.toLowerCase().includes('outlook') && account.password) {
        monitor.updateTask(task.id, account.email, '步骤1: 激活 Outlook 邮箱...')
        stateManager.updateTaskState(task.id, { currentStep: 1 })
        await stateManager.saveState()

        const activationResult = await activateOutlook(
          account.email,
          account.password,
          taskLogger,
          account.backupEmail,
          account.backupRefreshToken,
          account.backupClientId
        )

        if (!activationResult.success) {
          taskLogger(`⚠️ Outlook 激活失败: ${activationResult.error}`)
          taskLogger('继续执行后续步骤...')
        } else {
          taskLogger('✅ Outlook 激活成功')
          completedSteps.add(1)
          stateManager.updateTaskState(task.id, { completedSteps: Array.from(completedSteps) })
          await stateManager.saveState()
        }

        await new Promise(resolve => setTimeout(resolve, 2000))
      } else {
        completedSteps.add(1)
      }
    }

    // 步骤 2: 注册 AWS Builder ID（如果需要且未完成）
    if (startStep <= 2 && !completedSteps.has(2)) {
      monitor.updateTask(task.id, account.email, '步骤2: 注册 AWS Builder ID...')
      stateManager.updateTaskState(task.id, { currentStep: 2 })
      await stateManager.saveState()

      const registerResult = await autoRegisterAWS(
        account.email,
        account.refreshToken,
        account.clientId,
        taskLogger,
        account.password,
        true, // 跳过第二次激活
        args.proxyUrl,
        account.backupEmail,
        account.backupRefreshToken,
        account.backupClientId
      )

      if (!registerResult.success) {
        // 标记为暂停，等待人工介入
        stateManager.updateTaskState(task.id, {
          status: 'paused',
          pauseReason: 'aws_registration_failed',
          pauseMessage: `AWS 注册失败: ${registerResult.error}`,
          pauseTime: new Date().toISOString()
        })
        await stateManager.saveState()

        log(`\n🚨 [${task.id}] 需要人工介入！`)
        log(`   任务: ${account.email}`)
        log(`   步骤: 步骤2 - AWS Builder ID 注册`)
        log(`   原因: ${registerResult.error}`)
        log(`   操作: 请手动完成注册后，使用以下命令继续:`)
        log(`   npx tsx parallel-register.ts --resume --resume-from-step 3\n`)

        throw new Error(`AWS 注册失败: ${registerResult.error}`)
      }

      taskLogger('✅ AWS 注册成功')
      taskLogger(`SSO Token: ${registerResult.ssoToken?.substring(0, 50)}...`)
      completedSteps.add(2)
      stateManager.updateTaskState(task.id, {
        completedSteps: Array.from(completedSteps),
        ssoToken: registerResult.ssoToken
      })
      await stateManager.saveState()
    }

    // 步骤 3: 注册 AWS OIDC 客户端（如果需要且未完成）
    let awsClientId = savedState?.awsClientId
    let awsClientSecret = savedState?.awsClientSecret

    if (startStep <= 3 && !completedSteps.has(3)) {
      monitor.updateTask(task.id, account.email, '步骤3: 注册 OIDC 客户端...')
      stateManager.updateTaskState(task.id, { currentStep: 3 })
      await stateManager.saveState()

      const clientData = await registerClient(taskLogger)
      awsClientId = clientData.clientId
      awsClientSecret = clientData.clientSecret

      completedSteps.add(3)
      stateManager.updateTaskState(task.id, {
        completedSteps: Array.from(completedSteps),
        awsClientId,
        awsClientSecret
      })
      await stateManager.saveState()
    }

    // 步骤 4: 获取设备授权码（如果需要且未完成）
    let authData: any = null
    if (startStep <= 4 && !completedSteps.has(4)) {
      monitor.updateTask(task.id, account.email, '步骤4: 获取设备授权码...')
      stateManager.updateTaskState(task.id, { currentStep: 4 })
      await stateManager.saveState()

      authData = await deviceAuthorization(awsClientId!, awsClientSecret!, taskLogger)
      completedSteps.add(4)
      stateManager.updateTaskState(task.id, { completedSteps: Array.from(completedSteps) })
      await stateManager.saveState()
    }

    // 步骤 5: 创建浏览器 context 并进行授权（如果需要且未完成）
    if (startStep <= 5 && !completedSteps.has(5)) {
      monitor.updateTask(task.id, account.email, '步骤5: 浏览器授权...')
      stateManager.updateTaskState(task.id, { currentStep: 5 })
      await stateManager.saveState()

      context = await browserPool.createContext(task.id)

      taskLogger('>>> 自动打开浏览器进行授权...')

      try {
        await autoAuthorize(
          context,
          authData!.verificationUriComplete,
          account.email,
          'admin123456aA!', // 固定密码
          account.refreshToken,
          account.clientId,
          taskLogger
        )

        completedSteps.add(5)
        stateManager.updateTaskState(task.id, { completedSteps: Array.from(completedSteps) })
        await stateManager.saveState()
      } catch (error) {
        // 浏览器授权失败，可能需要人工介入
        stateManager.updateTaskState(task.id, {
          status: 'paused',
          pauseReason: 'browser_authorization_failed',
          pauseMessage: `浏览器授权失败: ${error}`,
          pauseTime: new Date().toISOString()
        })
        await stateManager.saveState()

        log(`\n🚨 [${task.id}] 需要人工介入！`)
        log(`   任务: ${account.email}`)
        log(`   步骤: 步骤5 - 浏览器授权`)
        log(`   原因: ${error}`)
        log(`   操作: 请在浏览器中手动完成授权后，使用以下命令继续:`)
        log(`   npx tsx parallel-register.ts --resume --resume-from-step 6\n`)

        throw error
      }
    }

    // 步骤 6: 轮询获取 Token（如果需要且未完成）
    let tokenData: any = null
    if (startStep <= 6 && !completedSteps.has(6)) {
      monitor.updateTask(task.id, account.email, '步骤6: 获取 Token...')
      stateManager.updateTaskState(task.id, { currentStep: 6 })
      await stateManager.saveState()

      tokenData = await pollToken(
        awsClientId!,
        awsClientSecret!,
        authData!.deviceCode,
        authData!.interval,
        authData!.expiresIn,
        taskLogger
      )

      taskLogger('✅ 授权成功！获取到 Token')
      completedSteps.add(6)
      stateManager.updateTaskState(task.id, { completedSteps: Array.from(completedSteps) })
      await stateManager.saveState()
    }

    // 步骤 7: 保存凭据到 AIClient-2-API（如果需要且未完成）
    if (startStep <= 7 && !completedSteps.has(7)) {
      monitor.updateTask(task.id, account.email, '步骤7: 保存凭据...')
      stateManager.updateTaskState(task.id, { currentStep: 7 })
      await stateManager.saveState()

      await saveCredentials(args.aiclientPath, tokenData!, awsClientId!, awsClientSecret!, account.email)

      completedSteps.add(7)
      stateManager.updateTaskState(task.id, { completedSteps: Array.from(completedSteps) })
      await stateManager.saveState()
    }

    // 清理 context
    if (context) {
      await browserPool.closeContext(task.id)
      context = null
    }

    // 标记任务完成
    stateManager.updateTaskState(task.id, {
      status: 'completed',
      currentStep: 7,
      endTime: new Date().toISOString()
    })
    await stateManager.saveState()

    return {
      taskId: task.id,
      email: account.email,
      success: true,
      ssoToken: savedState?.ssoToken
    }
  } catch (error) {
    // 清理 context
    if (context) {
      try {
        await browserPool.closeContext(task.id)
      } catch {}
    }

    // 标记任务失败（如果不是暂停状态）
    const currentState = stateManager.getTaskState(task.id)
    if (currentState?.status !== 'paused') {
      stateManager.updateTaskState(task.id, {
        status: 'failed',
        lastError: error instanceof Error ? error.message : String(error),
        endTime: new Date().toISOString()
      })
      await stateManager.saveState()
    }

    return {
      taskId: task.id,
      email: account.email,
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

// ============ 保存凭据到 AIClient-2-API ============
async function saveCredentials(
  aiclientPath: string,
  tokenData: any,
  awsClientId: string,
  awsClientSecret: string,
  email: string
): Promise<string> {
  log(`[${email}] 保存凭据到 AIClient-2-API...`)

  const timestamp = Date.now()
  const dirName = `${timestamp}_kiro-auth-token`
  const kiroConfigPath = path.join(aiclientPath, 'configs', 'kiro')
  const targetDir = path.join(kiroConfigPath, dirName)
  const targetFile = path.join(targetDir, `${dirName}.json`)

  await fs.mkdir(targetDir, { recursive: true })

  const expiresAt = Date.now() + (tokenData.expiresIn || 3600) * 1000

  const credentialData = {
    accessToken: tokenData.accessToken,
    refreshToken: tokenData.refreshToken,
    expiresAt: expiresAt,
    authMethod: 'builder-id',
    clientId: awsClientId,
    clientSecret: awsClientSecret,
    region: 'us-east-1'
  }

  await fs.writeFile(targetFile, JSON.stringify(credentialData, null, 2), 'utf-8')

  log(`[${email}] ✅ 凭据已保存到: ${targetFile}`)
  return targetFile
}

// ============ 主流程 ============
async function main() {
  const args = parseArgs()

  // 初始化状态管理器
  const stateManager = new StateManager(args.stateFile ?? '.parallel-register-state.json')

  // 检查是否是恢复模式
  if (args.resume) {
    log('🔄 检测到恢复模式，加载上次会话状态...')
    const savedState = await stateManager.loadState()

    if (!savedState) {
      log('❌ 未找到状态文件，无法恢复')
      process.exit(1)
    }

    log(`\n📊 上次会话信息:`)
    log(`   会话 ID: ${savedState.sessionId}`)
    log(`   开始时间: ${savedState.startTime}`)
    log(`   账号文件: ${savedState.config.accountsFile}`)
    log(`   起始索引: ${savedState.config.startIndex}`)
    log(`   总任务数: ${savedState.tasks.length}`)

    const completed = stateManager.getCompletedTasks()
    const paused = stateManager.getPausedTasks()
    const failed = stateManager.getFailedTasks()
    const pending = stateManager.getPendingTasks()

    log(`\n📋 任务状态:`)
    log(`   ✅ 已完成: ${completed.length}`)
    log(`   ⏸️  暂停: ${paused.length}`)
    log(`   ❌ 失败: ${failed.length}`)
    log(`   ⏳ 待执行: ${pending.length}`)

    if (paused.length > 0) {
      log(`\n⏸️  暂停的任务:`)
      paused.forEach(t => {
        log(`   - [${t.taskId}] ${t.email}`)
        log(`     步骤: ${t.currentStep}, 原因: ${t.pauseReason}`)
        log(`     消息: ${t.pauseMessage}`)
      })
    }

    if (args.resumeFromStep) {
      log(`\n🔧 将从步骤 ${args.resumeFromStep} 继续执行`)
    }

    // 使用保存的配置
    args.accountsFile = savedState.config.accountsFile
    args.startIndex = savedState.config.startIndex
    args.count = savedState.config.count
    args.concurrency = savedState.config.concurrency
    args.backupAccountsFile = savedState.config.backupAccountsFile
    args.backupStartIndex = savedState.config.backupStartIndex

    log('\n🔄 继续执行任务...\n')
  } else {
    // 新任务模式
    log('🚀 开始并行注册流程')
    log(`   账号文件: ${args.accountsFile}`)
    log(`   起始索引: ${args.startIndex}`)
    log(`   注册数量: ${args.count}`)
    log(`   并发数: ${args.concurrency}`)
    log(`   延迟范围: ${args.delayMin}-${args.delayMax} 秒`)
    log(`   最大重试: ${args.maxRetries}`)
    log(`   AIClient 路径: ${args.aiclientPath}`)

    // 初始化新会话状态
    await stateManager.initializeState({
      accountsFile: args.accountsFile,
      startIndex: args.startIndex,
      count: args.count,
      concurrency: args.concurrency,
      backupAccountsFile: args.backupAccountsFile,
      backupStartIndex: args.backupStartIndex
    })
  }

  // 加载账号数据
  const accounts = await loadAccounts(
    args.accountsFile,
    args.startIndex,
    args.count,
    args.backupAccountsFile,
    args.backupStartIndex
  )

  // 初始化组件
  const browserPool = new BrowserPool(args.proxyUrl)
  const monitor = new ProgressMonitor()
  const queue = new PQueue({ concurrency: args.concurrency })

  // 创建任务
  const tasks: Task[] = accounts.map((account, index) => ({
    id: `task-${args.startIndex + index}`,
    account,
    retryCount: 0,
    maxRetries: args.maxRetries
  }))

  // 初始化任务状态
  tasks.forEach(task => {
    stateManager.initializeTask(task.id, task.account.email)
  })
  await stateManager.saveState()

  log(`\n🔄 开始执行 ${tasks.length} 个注册任务...\n`)

  // 添加任务到队列（带延迟）
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]

    // 检查任务是否已完成
    const taskState = stateManager.getTaskState(task.id)
    if (taskState?.status === 'completed') {
      log(`✅ [${task.account.email}] 任务已完成，跳过`)
      continue
    }

    queue.add(async () => {
      const result = await executeRegistration(task, browserPool, monitor, stateManager, args)
      monitor.completeTask(result)

      // 如果失败且还有重试次数，重新加入队列
      if (!result.success && task.retryCount < task.maxRetries) {
        const currentState = stateManager.getTaskState(task.id)
        // 只有非暂停状态才重试（暂停状态需要人工介入）
        if (currentState?.status !== 'paused') {
          task.retryCount++
          log(`\n⚠️ [${task.account.email}] 任务失败，准备重试 (${task.retryCount}/${task.maxRetries})...`)
          await new Promise(resolve => setTimeout(resolve, 5000))
          queue.add(async () => {
            const retryResult = await executeRegistration(task, browserPool, monitor, stateManager, args)
            monitor.completeTask(retryResult)
          })
        }
      }
    })

    // 在任务之间添加随机延迟（除了最后一个任务）
    if (i < tasks.length - 1) {
      const delay = randomDelay(args.delayMin * 1000, args.delayMax * 1000)
      log(`⏳ 等待 ${(delay / 1000).toFixed(1)} 秒后启动下一个任务...\n`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  // 等待所有任务完成
  await queue.onIdle()

  // 清理资源
  log('\n🧹 清理资源...')
  await browserPool.cleanup()

  // 显示统计
  monitor.displaySummary()

  // 显示状态文件统计
  const finalState = stateManager.getState()
  if (finalState) {
    const completed = stateManager.getCompletedTasks()
    const paused = stateManager.getPausedTasks()
    const failed = stateManager.getFailedTasks()

    log('\n📊 最终状态:')
    log(`   ✅ 已完成: ${completed.length}`)
    log(`   ⏸️  暂停: ${paused.length}`)
    log(`   ❌ 失败: ${failed.length}`)

    if (paused.length > 0) {
      log(`\n⚠️  有 ${paused.length} 个任务需要人工介入:`)
      paused.forEach(t => {
        log(`   - [${t.taskId}] ${t.email}`)
        log(`     当前步骤: ${t.currentStep}`)
        log(`     原因: ${t.pauseMessage}`)
      })
      log(`\n💡 使用以下命令继续:`)
      log(`   npx tsx parallel-register.ts --resume`)
    }
  }

  log('\n🎉 并行注册流程完成！')
}

// 执行主流程
main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
