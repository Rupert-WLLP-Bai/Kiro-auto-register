/**
 * 上层注册脚本 - 通过账号序号简化调用
 *
 * 使用方法：
 * npx tsx register.ts <主账号序号> <辅助账号序号>
 *
 * 示例：
 * npx tsx register.ts 27 3
 */

import * as fs from 'fs'
import * as readline from 'readline'
import { activateOutlook, autoRegisterAWS } from './src/main/autoRegister'

// 固定配置
const AICLIENT_PATH = '/Users/pejoyll/Desktop/code/2026/AIClient-2-API'
const AWS_PASSWORD = 'admin123456aA!'
const ACCOUNTS_FILE = 'ids_cleaned.txt'

// 账号信息接口
interface AccountInfo {
  email: string
  password: string
  refreshToken: string
  clientId: string
}

// ============ 工具函数 ============

/**
 * 日志函数
 */
function log(message: string): void {
  const timestamp = new Date().toISOString().slice(11, 19)
  console.log(`[${timestamp}] ${message}`)
}

/**
 * 读取账号数据文件
 */
function readAccountData(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return content.trim().split('\n').filter(line => line.trim())
  } catch (error) {
    throw new Error(`无法读取文件 ${filePath}: ${error}`)
  }
}

/**
 * 解析账号数据行
 */
function parseAccountLine(line: string): AccountInfo {
  const parts = line.split('|')
  if (parts.length !== 4) {
    throw new Error(`数据格式错误，应为 email|password|refreshToken|clientId，实际: ${line}`)
  }

  const [email, password, refreshToken, clientId] = parts
  return { email, password, refreshToken, clientId }
}

/**
 * 验证序号范围
 */
function validateIndex(index: number, maxIndex: number, label: string): void {
  if (isNaN(index) || index < 0 || index >= maxIndex) {
    throw new Error(`${label}序号超出范围！有效范围: 0-${maxIndex - 1}`)
  }
}

/**
 * 获取用户输入
 */
function getUserInput(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

/**
 * 显示确认提示
 */
async function confirmExecution(
  mainAccount: AccountInfo,
  backupAccount: AccountInfo,
  mainIndex: number,
  backupIndex: number
): Promise<boolean> {
  console.log('\n📋 即将使用以下账号进行注册：\n')
  console.log(`主账号（索引 ${mainIndex}）:`)
  console.log(`  邮箱: ${mainAccount.email}\n`)
  console.log(`辅助账号（索引 ${backupIndex}）:`)
  console.log(`  邮箱: ${backupAccount.email}\n`)
  console.log(`AIClient 路径: ${AICLIENT_PATH}\n`)

  const answer = await getUserInput('是否继续？(y/n): ')
  return answer.toLowerCase() === 'y'
}

/**
 * 解析命令行参数
 */
function parseArgs(): { mainIndex: number; backupIndex: number } {
  const args = process.argv.slice(2)

  if (args.length < 2) {
    console.error('❌ 参数不足！\n')
    console.log('使用方法：')
    console.log('  npx tsx register.ts <主账号序号> <辅助账号序号>\n')
    console.log('示例：')
    console.log('  npx tsx register.ts 27 3\n')
    console.log('说明：')
    console.log('  - 序号从 0 开始计数')
    console.log('  - 主账号用于注册 AWS Builder ID')
    console.log('  - 辅助账号用于接收激活邮件')
    process.exit(1)
  }

  const mainIndex = parseInt(args[0], 10)
  const backupIndex = parseInt(args[1], 10)

  if (isNaN(mainIndex) || isNaN(backupIndex)) {
    throw new Error('序号必须是数字！')
  }

  return { mainIndex, backupIndex }
}

// ============ 主流程 ============

/**
 * 执行批量注册流程
 */
async function executeBatchRegister(
  mainAccount: AccountInfo,
  backupAccount: AccountInfo
): Promise<void> {
  log('🚀 开始注册流程')
  log(`   主账号: ${mainAccount.email}`)
  log(`   辅助账号: ${backupAccount.email}`)
  log(`   AIClient 路径: ${AICLIENT_PATH}`)

  try {
    // 步骤 1: 激活 Outlook 邮箱
    log('\n📧 步骤 1: 激活 Outlook 邮箱')
    const activationResult = await activateOutlook(
      mainAccount.email,
      mainAccount.password,
      log,
      backupAccount.email,
      backupAccount.refreshToken,
      backupAccount.clientId
    )

    if (!activationResult.success) {
      log(`   ⚠️ Outlook 激活失败: ${activationResult.error}`)
      log('   继续执行后续步骤...')
    } else {
      log('   ✅ Outlook 激活成功')
    }

    // 等待一下
    await new Promise(resolve => setTimeout(resolve, 2000))

    // 步骤 2: 注册 AWS Builder ID
    log('\n🔐 步骤 2: 注册 AWS Builder ID')
    const registerResult = await autoRegisterAWS(
      mainAccount.email,
      mainAccount.refreshToken,
      mainAccount.clientId,
      log,
      AWS_PASSWORD,
      true, // 跳过第二次激活
      undefined, // 不使用代理
      backupAccount.email,
      backupAccount.refreshToken,
      backupAccount.clientId
    )

    if (!registerResult.success) {
      throw new Error(`AWS 注册失败: ${registerResult.error}`)
    }

    log('   ✅ AWS 注册成功')
    log(`   SSO Token: ${registerResult.ssoToken?.substring(0, 50)}...`)

    // 步骤 3-7: 调用 batch-register.ts 的后续流程
    log('\n🔑 步骤 3: 注册 AWS OIDC 客户端')

    // 动态导入 batch-register.ts 的函数
    const batchRegister = await import('./batch-register')

    // 注册客户端
    const { clientId: awsClientId, clientSecret: awsClientSecret } =
      await (batchRegister as any).registerClient()

    // 步骤 4: 获取设备授权码
    log('\n🔐 步骤 4: 获取设备授权码')
    const authData = await (batchRegister as any).deviceAuthorization(awsClientId, awsClientSecret)

    // 步骤 5: 自动浏览器授权
    log('\n🌐 步骤 5: 自动浏览器授权')
    log(`   授权链接: ${authData.verificationUriComplete}`)
    log(`   验证码: ${authData.userCode}`)

    await (batchRegister as any).autoAuthorize(
      authData.verificationUriComplete,
      mainAccount.email,
      AWS_PASSWORD,
      mainAccount.refreshToken,
      mainAccount.clientId
    )

    // 步骤 6: 轮询获取 Token
    log('\n⏳ 步骤 6: 等待授权完成并获取 Token')
    const tokenData = await (batchRegister as any).pollToken(
      awsClientId,
      awsClientSecret,
      authData.deviceCode,
      authData.interval,
      authData.expiresIn
    )

    log('\n✅ 授权成功！获取到 Token')

    // 步骤 7: 保存凭据
    log('\n💾 步骤 7: 保存凭据到 AIClient-2-API')
    await (batchRegister as any).saveCredentials(
      AICLIENT_PATH,
      tokenData,
      awsClientId,
      awsClientSecret
    )

    log('\n🎉 完整流程执行完成！')
    log('   AIClient-2-API 会自动扫描并加载新的配置文件')
  } catch (error) {
    log(`\n❌ 流程执行失败: ${error}`)
    throw error
  }
}

/**
 * 主函数
 */
async function main() {
  try {
    // 1. 解析命令行参数
    const { mainIndex, backupIndex } = parseArgs()

    // 2. 读取账号数据
    const accounts = readAccountData(ACCOUNTS_FILE)

    // 3. 验证序号
    validateIndex(mainIndex, accounts.length, '主账号')
    validateIndex(backupIndex, accounts.length, '辅助账号')

    // 4. 提取账号信息
    const mainAccount = parseAccountLine(accounts[mainIndex])
    const backupAccount = parseAccountLine(accounts[backupIndex])

    // 5. 确认提示
    const confirmed = await confirmExecution(mainAccount, backupAccount, mainIndex, backupIndex)
    if (!confirmed) {
      console.log('\n❌ 已取消')
      process.exit(0)
    }

    // 6. 执行注册流程
    await executeBatchRegister(mainAccount, backupAccount)

    process.exit(0)
  } catch (error) {
    console.error(`\n❌ 错误: ${error}`)
    process.exit(1)
  }
}

// 执行主流程
main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
