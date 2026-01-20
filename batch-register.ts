/**
 * 批量注册脚本 - 完整流程自动化
 *
 * 功能：
 * 1. 激活 Outlook 邮箱
 * 2. 注册 AWS Builder ID
 * 3. 直接调用 AWS OIDC API 获取 Token
 * 4. 保存到 AIClient-2-API configs/kiro 目录
 *
 * 使用方法：
 * npx tsx batch-register.ts --email xxx@outlook.com --password xxx --refresh-token xxx --client-id xxx --aiclient-path /path/to/AIClient-2-API
 */

import { activateOutlook, autoRegisterAWS } from './src/main/autoRegister'
import { chromium, Browser } from 'playwright'
import * as fs from 'fs/promises'
import * as path from 'path'

// ============ 命令行参数解析 ============
interface Args {
  email: string
  password: string
  refreshToken: string
  clientId: string
  aiclientPath: string
  skipActivation?: boolean
  proxyUrl?: string
  backupEmail?: string
  backupRefreshToken?: string
  backupClientId?: string
}

function parseArgs(): Args {
  const args = process.argv.slice(2)
  const parsed: Partial<Args> = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const nextArg = args[i + 1]

    switch (arg) {
      case '--email':
        parsed.email = nextArg
        i++
        break
      case '--password':
        parsed.password = nextArg
        i++
        break
      case '--refresh-token':
        parsed.refreshToken = nextArg
        i++
        break
      case '--client-id':
        parsed.clientId = nextArg
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
      case '--backup-email':
        parsed.backupEmail = nextArg
        i++
        break
      case '--backup-refresh-token':
        parsed.backupRefreshToken = nextArg
        i++
        break
      case '--backup-client-id':
        parsed.backupClientId = nextArg
        i++
        break
    }
  }

  // 验证必需参数
  if (!parsed.email || !parsed.refreshToken || !parsed.clientId || !parsed.aiclientPath) {
    console.error('❌ 缺少必需参数！')
    console.log('\n使用方法：')
    console.log('npx tsx batch-register.ts \\')
    console.log('  --email xxx@outlook.com \\')
    console.log('  --password xxx \\')
    console.log('  --refresh-token xxx \\')
    console.log('  --client-id xxx \\')
    console.log('  --aiclient-path /path/to/AIClient-2-API \\')
    console.log('  [--skip-activation] \\')
    console.log('  [--proxy http://127.0.0.1:7890] \\')
    console.log('  [--backup-email backup@outlook.com] \\')
    console.log('  [--backup-refresh-token xxx] \\')
    console.log('  [--backup-client-id xxx]')
    process.exit(1)
  }

  return parsed as Args
}

// ============ 日志函数 ============
function log(message: string): void {
  const timestamp = new Date().toISOString().slice(11, 19)
  console.log(`[${timestamp}] ${message}`)
}

// ============ AWS OIDC API 配置 ============
const OIDC_ENDPOINT = 'https://oidc.us-east-1.amazonaws.com'
const START_URL = 'https://view.awsapps.com/start'
const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'KiroIDE'
}
const SCOPES = [
  'codewhisperer:completions',
  'codewhisperer:analysis',
  'codewhisperer:conversations',
  'codewhisperer:transformations',
  'codewhisperer:taskassist'
]

// ============ 步骤 1: 注册客户端 ============
async function registerClient(): Promise<{ clientId: string; clientSecret: string }> {
  log('>>> 正在注册客户端...')

  const url = `${OIDC_ENDPOINT}/client/register`
  const payload = {
    clientName: 'Kiro IDE',
    clientType: 'public',
    scopes: SCOPES,
    grantTypes: ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token']
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`客户端注册失败: ${response.status} ${response.statusText} - ${errorText}`)
    }

    const data = await response.json()
    log(`✅ 注册成功! Client ID: ${data.clientId.substring(0, 10)}...`)

    return {
      clientId: data.clientId,
      clientSecret: data.clientSecret
    }
  } catch (error) {
    log(`❌ 注册客户端失败: ${error}`)
    if (error instanceof Error && error.message.includes('fetch failed')) {
      log('提示: 这可能是网络问题或 Node.js 版本问题')
      log('请确保: 1) 网络连接正常 2) 可以访问 AWS OIDC 端点')
    }
    throw error
  }
}

// ============ 步骤 2: 发起设备授权 ============
async function deviceAuthorization(clientId: string, clientSecret: string): Promise<{
  deviceCode: string
  userCode: string
  verificationUriComplete: string
  interval: number
  expiresIn: number
}> {
  log('\n>>> 正在获取设备授权码...')

  const url = `${OIDC_ENDPOINT}/device_authorization`
  const payload = {
    clientId,
    clientSecret,
    startUrl: START_URL
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    throw new Error(`设备授权失败: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()

  log(`✅ 获取授权信息成功`)
  log(`   User Code: ${data.userCode}`)
  log(`   授权链接: ${data.verificationUriComplete}`)

  return data
}

// ============ 步骤 3: 轮询获取 Token ============
async function pollToken(
  clientId: string,
  clientSecret: string,
  deviceCode: string,
  interval: number,
  expiresIn: number
): Promise<any> {
  log('\n>>> 等待用户授权中...')

  const url = `${OIDC_ENDPOINT}/token`
  const startTime = Date.now()

  while (Date.now() - startTime < expiresIn * 1000) {
    const payload = {
      clientId,
      clientSecret,
      deviceCode,
      grantType: 'urn:ietf:params:oauth:grant-type:device_code'
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(payload)
    })

    const data = await response.json()

    if (response.ok && data.accessToken) {
      return data
    }

    if (data.error === 'authorization_pending') {
      await new Promise(resolve => setTimeout(resolve, interval * 1000))
      process.stdout.write('.')
    } else if (data.error === 'slow_down') {
      await new Promise(resolve => setTimeout(resolve, (interval + 5) * 1000))
    } else {
      throw new Error(`Token 获取失败: ${JSON.stringify(data)}`)
    }
  }

  throw new Error('授权超时')
}

// ============ 自动化浏览器授权流程 ============
async function autoAuthorize(
  verificationUrl: string,
  email: string,
  password: string,
  refreshToken: string,
  clientId: string
): Promise<boolean> {
  log('🌐 启动浏览器进行授权...')

  let browser: Browser | null = null

  try {
    // 启动浏览器（带反检测配置）
    browser = await chromium.launch({
      headless: false,  // 显示浏览器，方便调试
      args: ['--disable-blink-features=AutomationControlled']
    })

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    })

    const page = await context.newPage()

    // 打开授权链接
    log(`   访问授权页面: ${verificationUrl}`)
    await page.goto(verificationUrl, { waitUntil: 'networkidle', timeout: 60000 })
    await page.waitForTimeout(2000)

    // 输入邮箱
    log('   输入邮箱...')
    const emailInputSelector = 'input[placeholder="username@example.com"]'
    const emailInput = page.locator(emailInputSelector).first()
    await emailInput.waitFor({ state: 'visible', timeout: 10000 })
    await emailInput.click()
    await page.waitForTimeout(200)
    await emailInput.clear()
    await emailInput.type(email, { delay: Math.random() * 50 + 50 })

    await page.waitForTimeout(1000)

    // 点击继续
    log('   点击继续...')
    const continueButton = page.locator('button[data-testid="test-primary-button"]').first()
    await continueButton.waitFor({ state: 'visible', timeout: 10000 })
    const box = await continueButton.boundingBox()
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 })
    }
    await page.waitForTimeout(Math.random() * 500 + 300)
    await continueButton.click({ delay: Math.random() * 100 + 50 })

    await page.waitForTimeout(3000)

    // 检测是否是登录流程（已注册账号）或授权确认页面
    const loginHeadingSelector = 'span[class*="awsui_heading-text"]:has-text("Sign in with your AWS Builder ID")'
    const nameInputSelector = 'input[placeholder="Maria José Silva"]'
    const confirmButtonSelector = 'button:has-text("Confirm and continue")'

    let isLoginFlow = false
    let isConfirmFlow = false

    try {
      // 优先检测确认按钮（刚注册的账号会直接到确认页面）
      const confirmButton = page.locator(confirmButtonSelector).first()
      try {
        await confirmButton.waitFor({ state: 'visible', timeout: 5000 })
        isConfirmFlow = true
        log('   ✅ 检测到 "Confirm and continue" 按钮')
      } catch {
        // 如果没有确认按钮，再检测登录或注册流程
        const loginHeading = page.locator(loginHeadingSelector).first()
        const nameInput = page.locator(nameInputSelector).first()

        const result = await Promise.race([
          loginHeading.waitFor({ state: 'visible', timeout: 10000 }).then(() => 'login'),
          nameInput.waitFor({ state: 'visible', timeout: 10000 }).then(() => 'register')
        ])

        if (result === 'login') {
          isLoginFlow = true
        }
      }
    } catch (error) {
      log('   ⚠️ 无法确定流程类型')
    }

    if (isConfirmFlow) {
      log('   ✅ 检测到授权确认页面（刚注册的账号）')

      // 直接点击 "Confirm and continue" 按钮
      log('   点击 "Confirm and continue"...')
      const confirmButtonSelectors = [
        'button:has-text("Confirm and continue")',
        'button:has-text("确认并继续")',
        'button[data-testid="test-primary-button"]:has-text("Confirm")',
        'button:has-text("Continue")'
      ]

      let confirmClicked = false
      for (const selector of confirmButtonSelectors) {
        try {
          const confirmBtn = page.locator(selector).first()
          await confirmBtn.waitFor({ state: 'visible', timeout: 5000 })

          const box = await confirmBtn.boundingBox()
          if (box) {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 })
          }
          await page.waitForTimeout(Math.random() * 500 + 300)

          await confirmBtn.click({ delay: Math.random() * 100 + 50 })
          log('   ✅ 已点击 "Confirm and continue"')
          confirmClicked = true
          break
        } catch {
          continue
        }
      }

      if (!confirmClicked) {
        throw new Error('未找到 "Confirm and continue" 按钮')
      }

      await page.waitForTimeout(3000)

      // 点击 "Allow access" 按钮
      log('   查找 "Allow access" 按钮...')
      const allowButtonSelectors = [
        'button:has-text("Allow access")',
        'button:has-text("Allow")',
        'button:has-text("允许访问")',
        'button:has-text("允许")',
        'button[data-testid="allow-button"]',
        'button.allow-button'
      ]

      let allowClicked = false
      for (const selector of allowButtonSelectors) {
        try {
          const allowButton = page.locator(selector).first()
          await allowButton.waitFor({ state: 'visible', timeout: 10000 })

          const box = await allowButton.boundingBox()
          if (box) {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 })
          }
          await page.waitForTimeout(Math.random() * 500 + 300)

          await allowButton.click({ delay: Math.random() * 100 + 50 })
          log('   ✅ 已点击 "Allow access"')
          allowClicked = true
          break
        } catch {
          continue
        }
      }

      if (!allowClicked) {
        log('   ⚠️ 未找到 "Allow access" 按钮')
      }

      await page.waitForTimeout(3000)

      log('   ✅ 授权流程完成！')

      if (browser) {
        await browser.close()
      }

      return true
    } else if (isLoginFlow) {
      log('   ✅ 检测到登录流程（账号已注册）')

      // 输入密码
      log('   输入密码...')
      const passwordInputSelector = 'input[placeholder="Enter password"]'
      const passwordInput = page.locator(passwordInputSelector).first()
      await passwordInput.waitFor({ state: 'visible', timeout: 10000 })
      await passwordInput.click()
      await page.waitForTimeout(200)
      await passwordInput.clear()
      await passwordInput.type(password, { delay: Math.random() * 50 + 50 })

      await page.waitForTimeout(1000)

      // 点击继续
      log('   点击继续...')
      const loginContinueButton = page.locator('button[data-testid="test-primary-button"]').first()
      await loginContinueButton.waitFor({ state: 'visible', timeout: 10000 })
      await loginContinueButton.click({ delay: Math.random() * 100 + 50 })

      await page.waitForTimeout(3000)

      // 获取并输入验证码
      log('   等待新邮件到达...')
      await page.waitForTimeout(5000)  // 等待5秒确保新邮件到达

      log('   获取验证码...')
      const { getOutlookVerificationCode } = await import('./src/main/autoRegister')
      const verificationCode = await getOutlookVerificationCode(refreshToken, clientId, log, 120)

      if (!verificationCode) {
        throw new Error('无法获取验证码')
      }

      log(`   验证码: ${verificationCode}`)

      // 输入验证码
      log('   输入验证码...')
      const codeInputSelectors = [
        'input[placeholder="6-digit"]',
        'input[placeholder="6 位数"]',
        'input[class*="awsui_input"][type="text"]'
      ]

      let codeInput: any = null
      for (const selector of codeInputSelectors) {
        try {
          const input = page.locator(selector).first()
          await input.waitFor({ state: 'visible', timeout: 5000 })
          codeInput = input
          break
        } catch {
          continue
        }
      }

      if (!codeInput) {
        throw new Error('未找到验证码输入框')
      }

      await codeInput.click()
      await page.waitForTimeout(200)
      await codeInput.clear()
      await codeInput.type(verificationCode, { delay: Math.random() * 50 + 50 })

      await page.waitForTimeout(1000)

      // 点击验证
      log('   点击验证...')
      const verifyButton = page.locator('button[data-testid="test-primary-button"]').first()
      await verifyButton.waitFor({ state: 'visible', timeout: 10000 })
      await verifyButton.click({ delay: Math.random() * 100 + 50 })

      await page.waitForTimeout(5000)

      // 点击 "Confirm and continue" 按钮
      log('   查找 "Confirm and continue" 按钮...')
      try {
        const confirmButtonSelectors = [
          'button:has-text("Confirm and continue")',
          'button:has-text("确认并继续")',
          'button[data-testid="test-primary-button"]:has-text("Confirm")',
          'button:has-text("Continue")'
        ]

        let confirmClicked = false
        for (const selector of confirmButtonSelectors) {
          try {
            const confirmButton = page.locator(selector).first()
            await confirmButton.waitFor({ state: 'visible', timeout: 5000 })

            // 模拟鼠标移动
            const box = await confirmButton.boundingBox()
            if (box) {
              await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 })
            }
            await page.waitForTimeout(Math.random() * 500 + 300)

            await confirmButton.click({ delay: Math.random() * 100 + 50 })
            log('   ✅ 已点击 "Confirm and continue"')
            confirmClicked = true
            break
          } catch {
            continue
          }
        }

        if (!confirmClicked) {
          log('   ⚠️ 未找到 "Confirm and continue" 按钮，可能已跳过')
        } else {
          await page.waitForTimeout(3000)

          // 点击 "Allow access" 按钮
          log('   查找 "Allow access" 按钮...')
          const allowButtonSelectors = [
            'button:has-text("Allow access")',
            'button:has-text("Allow")',
            'button:has-text("允许访问")',
            'button:has-text("允许")',
            'button[data-testid="allow-button"]',
            'button.allow-button'
          ]

          let allowClicked = false
          for (const selector of allowButtonSelectors) {
            try {
              const allowButton = page.locator(selector).first()
              await allowButton.waitFor({ state: 'visible', timeout: 10000 })

              // 模拟鼠标移动
              const box = await allowButton.boundingBox()
              if (box) {
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 })
              }
              await page.waitForTimeout(Math.random() * 500 + 300)

              await allowButton.click({ delay: Math.random() * 100 + 50 })
              log('   ✅ 已点击 "Allow access"')
              allowClicked = true
              break
            } catch {
              continue
            }
          }

          if (!allowClicked) {
            log('   ⚠️ 未找到 "Allow access" 按钮')
          }
        }
      } catch (error) {
        log(`   ⚠️ 处理确认步骤时出错: ${error}`)
      }

      await page.waitForTimeout(3000)

      log('   ✅ 授权流程完成！')

      // 关闭浏览器
      if (browser) {
        await browser.close()
      }

      return true
    } else {
      throw new Error('检测到注册流程，但当前脚本仅支持已注册账号的授权流程')
    }
  } catch (error) {
    log(`   ❌ 授权失败: ${error}`)
    throw error
  }
  // 移除 finally 块，不自动关闭浏览器
}

// ============ 保存凭据到 AIClient-2-API ============
async function saveCredentials(
  aiclientPath: string,
  tokenData: any,
  awsClientId: string,
  awsClientSecret: string
): Promise<string> {
  log('\n>>> 保存凭据到 AIClient-2-API...')

  // 构造符合 AIClient-2-API 格式的 JSON
  const timestamp = Date.now()
  const dirName = `${timestamp}_kiro-auth-token`
  const kiroConfigPath = path.join(aiclientPath, 'configs', 'kiro')
  const targetDir = path.join(kiroConfigPath, dirName)
  const targetFile = path.join(targetDir, `${dirName}.json`)

  // 确保目录存在
  await fs.mkdir(targetDir, { recursive: true })

  // 计算过期时间（当前时间 + expiresIn 秒）
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

  // 写入文件
  await fs.writeFile(targetFile, JSON.stringify(credentialData, null, 2), 'utf-8')

  log(`✅ 凭据已保存到: ${targetFile}`)
  log('\n📄 配置文件内容：')
  log(JSON.stringify(credentialData, null, 2))

  return targetFile
}

// ============ 主流程 ============
async function main() {
  const args = parseArgs()

  log('🚀 开始批量注册流程')
  log(`   邮箱: ${args.email}`)
  log(`   AIClient 路径: ${args.aiclientPath}`)

  try {
    // 步骤 1: 激活 Outlook（如果需要）
    if (!args.skipActivation && args.email.toLowerCase().includes('outlook') && args.password) {
      log('\n📧 步骤 1: 激活 Outlook 邮箱')
      const activationResult = await activateOutlook(
        args.email,
        args.password,
        log,
        args.backupEmail,
        args.backupRefreshToken,
        args.backupClientId
      )

      if (!activationResult.success) {
        log(`   ⚠️ Outlook 激活失败: ${activationResult.error}`)
        log('   继续执行后续步骤...')
      } else {
        log('   ✅ Outlook 激活成功')
      }

      // 等待一下
      await new Promise(resolve => setTimeout(resolve, 2000))
    } else {
      log('\n📧 步骤 1: 跳过 Outlook 激活')
    }

    // 步骤 2: 注册 AWS Builder ID
    log('\n🔐 步骤 2: 注册 AWS Builder ID')
    const registerResult = await autoRegisterAWS(
      args.email,
      args.refreshToken,
      args.clientId,
      log,
      args.password,
      true, // 跳过第二次激活，因为步骤1已经激活过了
      args.proxyUrl,
      args.backupEmail,
      args.backupRefreshToken,
      args.backupClientId
    )

    if (!registerResult.success) {
      throw new Error(`AWS 注册失败: ${registerResult.error}`)
    }

    log('   ✅ AWS 注册成功')
    log(`   SSO Token: ${registerResult.ssoToken?.substring(0, 50)}...`)

    // 步骤 3: 注册 AWS OIDC 客户端
    log('\n🔑 步骤 3: 注册 AWS OIDC 客户端')
    const { clientId: awsClientId, clientSecret: awsClientSecret } = await registerClient()

    // 步骤 4: 获取设备授权码
    log('\n🔐 步骤 4: 获取设备授权码')
    const authData = await deviceAuthorization(awsClientId, awsClientSecret)

    // 步骤 5: 打开浏览器进行授权
    log('\n🌐 步骤 5: 请在浏览器中完成授权')
    log(`\n⚠️  请在浏览器打开以下链接进行登录授权:`)
    log(`👉 ${authData.verificationUriComplete}`)
    log(`验证码: ${authData.userCode}`)

    // 自动打开浏览器
    log('\n>>> 自动打开浏览器...')
    await autoAuthorize(
      authData.verificationUriComplete,
      args.email,
      'admin123456aA!',  // 固定密码
      args.refreshToken,
      args.clientId
    )

    // 步骤 6: 轮询获取 Token
    log('\n⏳ 步骤 6: 等待授权完成并获取 Token')
    const tokenData = await pollToken(
      awsClientId,
      awsClientSecret,
      authData.deviceCode,
      authData.interval,
      authData.expiresIn
    )

    log('\n✅ 授权成功！获取到 Token')

    // 步骤 7: 保存凭据到 AIClient-2-API
    log('\n💾 步骤 7: 保存凭据')
    await saveCredentials(args.aiclientPath, tokenData, awsClientId, awsClientSecret)

    log('\n🎉 完整流程执行完成！')
    log('   AIClient-2-API 会自动扫描并加载新的配置文件')
  } catch (error) {
    log(`\n❌ 流程执行失败: ${error}`)
    process.exit(1)
  }
}

// 执行主流程
main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
