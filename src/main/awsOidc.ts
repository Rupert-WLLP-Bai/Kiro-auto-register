/**
 * AWS OIDC API 模块
 * 提供 AWS Builder ID 的 OIDC 认证功能
 */

import { BrowserContext, Page } from 'playwright'
import { getOutlookVerificationCode } from './autoRegister'

// 日志回调类型
type LogCallback = (message: string) => void

// ============ 人工介入和完成检测函数 ============

/**
 * 检测浏览器授权是否完成
 */
async function checkAuthorizationComplete(page: Page): Promise<boolean> {
  try {
    // 检测 1：Allow access 按钮消失
    const allowButton = await page.$('button:has-text("Allow access")')
    if (!allowButton) {
      return true
    }

    // 检测 2：成功页面
    const url = page.url()
    if (url.includes('success') || url.includes('authorized')) {
      return true
    }

    return false
  } catch (error) {
    return false
  }
}

/**
 * 等待用户手动完成操作
 * @param page Playwright Page 对象
 * @param checkComplete 完成检测函数
 * @param stepName 步骤名称（用于日志）
 * @param timeout 最大等待时间（秒）
 * @returns true 表示用户完成，false 表示超时
 */
async function waitForManualCompletion(
  page: Page,
  checkComplete: (page: Page) => Promise<boolean>,
  stepName: string,
  timeout: number = 600 // 默认 10 分钟
): Promise<boolean> {
  const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`)

  log(`\n⏸️  需要人工介入：${stepName}`)
  log(`📌 请在浏览器中手动完成操作`)
  log(`⏱️  程序将等待最多 ${timeout} 秒，每 3 秒检测一次`)
  log(`🔍 检测到完成后将自动继续...\n`)

  const startTime = Date.now()
  const checkInterval = 3000 // 3 秒检测一次

  while (Date.now() - startTime < timeout * 1000) {
    // 检测是否完成
    const isComplete = await checkComplete(page)
    if (isComplete) {
      log(`✅ 检测到操作已完成，继续执行...`)
      return true
    }

    // 等待下一次检测
    await page.waitForTimeout(checkInterval)

    // 显示进度
    const elapsed = Math.floor((Date.now() - startTime) / 1000)
    const remaining = timeout - elapsed
    if (elapsed % 15 === 0) { // 每 15 秒显示一次进度
      log(`⏳ 已等待 ${elapsed}s，剩余 ${remaining}s...`)
    }
  }

  log(`⏱️  等待超时（${timeout}s），操作未完成`)
  return false
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
export async function registerClient(log: LogCallback): Promise<{ clientId: string; clientSecret: string }> {
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
export async function deviceAuthorization(
  clientId: string,
  clientSecret: string,
  log: LogCallback
): Promise<{
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
export async function pollToken(
  clientId: string,
  clientSecret: string,
  deviceCode: string,
  interval: number,
  expiresIn: number,
  log: LogCallback
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
export async function autoAuthorize(
  context: BrowserContext,
  verificationUrl: string,
  email: string,
  password: string,
  refreshToken: string,
  clientId: string,
  log: LogCallback
): Promise<boolean> {
  log('🌐 开始浏览器授权流程...')

  let page: Page | null = null

  try {
    page = await context.newPage()

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
        // 如果没有确认按钮，再检测登录流程
        const loginHeading = page.locator(loginHeadingSelector).first()
        try {
          await loginHeading.waitFor({ state: 'visible', timeout: 10000 })
          isLoginFlow = true
        } catch {
          // 默认为确认流程
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
      await page.close()

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
      await page.waitForTimeout(5000)

      log('   获取验证码...')
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

      // 点击 "Confirm and continue" 和 "Allow access" 按钮
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
      await page.close()

      return true
    } else {
      throw new Error('检测到注册流程，但当前脚本仅支持已注册账号的授权流程')
    }
  } catch (error) {
    log(`   ❌ 授权失败: ${error}`)

    // 判断是否是超时错误
    const isTimeout = error instanceof Error && (
      error.message?.includes('Timeout') ||
      error.message?.includes('timeout') ||
      error.message?.includes('waiting for')
    )

    if (isTimeout) {
      log(`\n⚠️  检测到超时，等待人工完成授权...`)

      if (!page) {
        throw error
      }

      const manualCompleted = await waitForManualCompletion(page, checkAuthorizationComplete, '浏览器授权', 600)

      if (manualCompleted) {
        log(`✅ 授权完成`)
        await page.close()
        return true
      }
    }

    throw error
  }
}
