/**
 * AWS Builder ID 自动注册模块
 * 完全集成在 Electron 中，不依赖外部 Python 脚本
 *
 * 邮箱参数格式: 邮箱|密码|refresh_token|client_id
 * - refresh_token: OAuth2 刷新令牌 (如 M.C509_xxx...)
 * - client_id: Graph API 客户端ID (如 9e5f94bc-xxx...)
 */

import { chromium, Browser, Page } from 'playwright'

// 日志回调类型
type LogCallback = (message: string) => void

// 验证码正则表达式 - 与 Python 版本保持一致
const CODE_PATTERNS = [
  // AWS/Amazon 验证码格式
  /(?:verification\s*code|验证码|Your code is|code is)[：:\s]*(\d{6})/gi,
  /(?:is|为)[：:\s]*(\d{6})\b/gi,
  // 验证码通常单独一行或在特定上下文中
  /^\s*(\d{6})\s*$/gm, // 单独一行的6位数字
  />\s*(\d{6})\s*</g // HTML标签之间的6位数字
]

// AWS 验证码发件人
const AWS_SENDERS = [
  'no-reply@signin.aws', // AWS 新发件人
  'no-reply@login.awsapps.com',
  'noreply@amazon.com',
  'account-update@amazon.com',
  'no-reply@aws.amazon.com',
  'noreply@aws.amazon.com',
  'aws' // 模糊匹配
]

// 随机姓名生成
const FIRST_NAMES = [
  'James',
  'Robert',
  'John',
  'Michael',
  'David',
  'William',
  'Richard',
  'Maria',
  'Elizabeth',
  'Jennifer',
  'Linda',
  'Barbara',
  'Susan',
  'Jessica'
]
const LAST_NAMES = [
  'Smith',
  'Johnson',
  'Williams',
  'Brown',
  'Jones',
  'Garcia',
  'Miller',
  'Davis',
  'Rodriguez',
  'Martinez',
  'Wilson',
  'Anderson',
  'Thomas',
  'Taylor'
]

function generateRandomName(): string {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]
  const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]
  return `${first} ${last}`
}

// HTML 转文本 - 改进版本
function htmlToText(html: string): string {
  if (!html) return ''

  let text = html

  // 解码 HTML 实体
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))

  // 移除 style 和 script 标签及其内容
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')

  // 将 br 和 p 标签转换为换行
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<\/p>/gi, '\n')
  text = text.replace(/<\/div>/gi, '\n')

  // 移除所有 HTML 标签
  text = text.replace(/<[^>]+>/g, ' ')

  // 清理多余空白
  text = text.replace(/\s+/g, ' ')

  return text.trim()
}

// 从文本提取验证码 - 改进版本，与 Python 保持一致
function extractCode(text: string): string | null {
  if (!text) return null

  for (const pattern of CODE_PATTERNS) {
    // 重置正则表达式的 lastIndex
    pattern.lastIndex = 0

    let match
    while ((match = pattern.exec(text)) !== null) {
      const code = match[1]
      if (code && /^\d{6}$/.test(code)) {
        // 获取上下文进行排除检查
        const start = Math.max(0, match.index - 20)
        const end = Math.min(text.length, match.index + match[0].length + 20)
        const context = text.slice(start, end)

        // 排除颜色代码 (#XXXXXX)
        if (context.includes('#' + code)) continue

        // 排除 CSS 颜色相关
        if (/color[:\s]*[^;]*\d{6}/i.test(context)) continue
        if (/rgb|rgba|hsl/i.test(context)) continue

        // 排除超过6位的数字（电话号码、邮编等）
        if (/\d{7,}/.test(context)) continue

        return code
      }
    }
  }
  return null
}

/**
 * 从 Outlook 邮箱获取验证码
 * 使用 Microsoft Graph API，与 Python 版本保持一致
 */
export async function getOutlookVerificationCode(
  refreshToken: string,
  clientId: string,
  log: LogCallback,
  timeout: number = 120
): Promise<string | null> {
  log('========== 开始获取邮箱验证码 ==========')
  log(`client_id: ${clientId}`)
  log(`refresh_token: ${refreshToken.substring(0, 30)}...`)

  const startTime = Date.now()
  const checkInterval = 5000 // 5秒检查一次
  const checkedIds = new Set<string>()

  // 预处理：剔除 refreshToken 末尾的 $ 符号
  refreshToken = refreshToken.replace(/\$+$/, '').trim()

  while (Date.now() - startTime < timeout * 1000) {
    try {
      // 刷新 access_token
      log('刷新 access_token...')
      let accessToken: string | null = null

      const tokenAttempts = [
        {
          url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
          scope: 'https://graph.microsoft.com/Mail.Read offline_access'
        },
        {
          url: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
          scope: 'https://graph.microsoft.com/Mail.Read offline_access'
        }
      ]

      for (const attempt of tokenAttempts) {
        try {
          const tokenBody = new URLSearchParams()
          tokenBody.append('client_id', clientId)
          tokenBody.append('refresh_token', refreshToken)
          tokenBody.append('grant_type', 'refresh_token')
          if (attempt.scope) {
            tokenBody.append('scope', attempt.scope)
          }

          const tokenResponse = await fetch(attempt.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: tokenBody.toString()
          })

          if (tokenResponse.ok) {
            const tokenResult = (await tokenResponse.json()) as { access_token: string }
            accessToken = tokenResult.access_token
            log('✓ 成功获取 access_token')
            break
          }
        } catch {
          continue
        }
      }

      if (!accessToken) {
        log('✗ token 刷新失败')
        return null
      }

      // 获取邮件
      log('获取邮件列表...')
      const graphParams = new URLSearchParams({
        $top: '50',
        $orderby: 'receivedDateTime desc',
        $select: 'id,subject,from,receivedDateTime,bodyPreview,body'
      })

      const mailResponse = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages?${graphParams}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        }
      )

      if (!mailResponse.ok) {
        log(`获取邮件失败: ${mailResponse.status}`)
        await new Promise((r) => setTimeout(r, checkInterval))
        continue
      }

      const mailData = (await mailResponse.json()) as {
        value: Array<{
          id: string
          subject: string
          from: { emailAddress: { address: string } }
          body: { content: string }
          bodyPreview: string
          receivedDateTime: string
        }>
      }

      log(`获取到 ${mailData.value?.length || 0} 封邮件`)

      // 搜索最新的 AWS 邮件
      for (const mail of mailData.value || []) {
        const fromEmail = mail.from?.emailAddress?.address?.toLowerCase() || ''
        const isAwsSender = AWS_SENDERS.some((s) => fromEmail.includes(s.toLowerCase()))

        if (isAwsSender && !checkedIds.has(mail.id)) {
          checkedIds.add(mail.id)

          log(`\n=== 检查 AWS 邮件 ===`)
          log(`  发件人: ${fromEmail}`)
          log(`  主题: ${mail.subject?.substring(0, 50)}`)

          // 提取验证码
          let code: string | null = null
          const bodyText = htmlToText(mail.body?.content || '')
          if (bodyText) {
            code = extractCode(bodyText)
          }
          if (!code) {
            code = extractCode(mail.body?.content || '')
          }
          if (!code) {
            code = extractCode(mail.bodyPreview || '')
          }

          if (code) {
            log(`\n========== 找到验证码: ${code} ==========`)
            return code
          }
        }
      }

      log(`未找到验证码，${checkInterval / 1000}秒后重试...`)
      await new Promise((r) => setTimeout(r, checkInterval))
    } catch (error) {
      log(`获取验证码出错: ${error}`)
      await new Promise((r) => setTimeout(r, checkInterval))
    }
  }

  log('获取验证码超时')
  return null
}

/**
 * 模拟人类点击动作
 */
async function humanClick(
  page: Page,
  selector: string,
  log: LogCallback,
  description: string
): Promise<boolean> {
  try {
    const button = page.locator(selector).first()
    await button.waitFor({ state: 'visible', timeout: 10000 })

    // 1. 模拟鼠标移动到元素上
    const box = await button.boundingBox()
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 })
    }

    // 2. 随机延迟
    await page.waitForTimeout(Math.random() * 500 + 300)

    // 3. 点击（带轻微按下延迟）
    await button.click({ delay: Math.random() * 100 + 50 })
    log(`✓ 已模拟人工点击${description}`)
    return true
  } catch (error) {
    log(`✗ 点击${description}失败: ${error}`)
    return false
  }
}

/**
 * 模拟人工输入
 */
async function humanType(
  page: Page,
  selector: string,
  value: string,
  log: LogCallback,
  description: string
): Promise<boolean> {
  try {
    const element = page.locator(selector).first()
    await element.waitFor({ state: 'visible', timeout: 10000 })

    // 模拟鼠标移动到元素
    const box = await element.boundingBox()
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 })
    }
    await page.waitForTimeout(Math.random() * 300 + 200)

    await element.click({ delay: Math.random() * 100 + 50 })
    await page.waitForTimeout(200)
    await element.clear()

    // 逐字输入
    await element.type(value, { delay: Math.random() * 50 + 50 })
    log(`✓ 已模拟人工输入${description}`)
    return true
  } catch (error) {
    log(`✗ 输入${description}失败: ${error}`)
    return false
  }
}

/**
 * 等待输入框出现并输入内容
 */
async function waitAndFill(
  page: Page,
  selector: string,
  value: string,
  log: LogCallback,
  description: string,
  timeout: number = 30000
): Promise<boolean> {
  log(`等待${description}出现...`)
  try {
    const element = page.locator(selector).first()
    await element.waitFor({ state: 'visible', timeout })
    await page.waitForTimeout(500)
    await element.clear()
    await element.fill(value)
    log(`✓ 已输入${description}: ${value}`)
    return true
  } catch (error) {
    log(`✗ ${description}操作失败: ${error}`)
    return false
  }
}

/**
 * 尝试多个选择器点击
 */
async function tryClickSelectors(
  page: Page,
  selectors: string[],
  log: LogCallback,
  description: string,
  timeout: number = 15000
): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const element = page.locator(selector).first()
      await element.waitFor({ state: 'visible', timeout: timeout / selectors.length })

      // 模拟鼠标移动
      const box = await element.boundingBox()
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 })
      }
      await page.waitForTimeout(Math.random() * 500 + 300)

      await element.click({ delay: Math.random() * 100 + 50 })
      log(`✓ 已点击${description}`)
      return true
    } catch {
      continue
    }
  }
  log(`✗ 未找到${description}`)
  return false
}

/**
 * 检测 AWS 错误弹窗并重试点击按钮
 * 错误弹窗选择器: div.awsui_content_mx3cw_97dyn_391 包含 "抱歉，处理您的请求时出错"
 */
async function checkAndRetryOnError(
  page: Page,
  buttonSelector: string,
  log: LogCallback,
  description: string,
  maxRetries: number = 3,
  retryDelay: number = 2000
): Promise<boolean> {
  // 错误弹窗的多种可能选择器
  const errorSelectors = [
    'div.awsui_content_mx3cw_97dyn_391',
    '[class*="awsui_content_"]',
    '.awsui-flash-error',
    '[data-testid="flash-error"]'
  ]

  const errorTexts = [
    '抱歉，处理您的请求时出错',
    'Sorry, there was an error processing your request',
    'error processing your request',
    'Please try again',
    '请重试'
  ]

  for (let retry = 0; retry < maxRetries; retry++) {
    // 等待一下让页面响应
    await page.waitForTimeout(1500)

    // 检查是否有错误弹窗
    let hasError = false
    for (const selector of errorSelectors) {
      try {
        const errorElements = await page.locator(selector).all()
        for (const el of errorElements) {
          const text = await el.textContent()
          if (text && errorTexts.some((errText) => text.includes(errText))) {
            hasError = true
            log(`⚠ 检测到错误弹窗: "${text.substring(0, 50)}..."`)
            break
          }
        }
        if (hasError) break
      } catch {
        continue
      }
    }

    if (!hasError) {
      // 没有错误，操作成功
      return true
    }

    if (retry < maxRetries - 1) {
      log(`重试点击${description} (${retry + 2}/${maxRetries})...`)
      await page.waitForTimeout(retryDelay)

      // 重新点击按钮
      try {
        const button = page.locator(buttonSelector).first()
        await button.waitFor({ state: 'visible', timeout: 5000 })
        await button.click()
        log(`✓ 已重新点击${description}`)
      } catch (e) {
        log(`✗ 重新点击${description}失败: ${e}`)
      }
    }
  }

  log(`✗ ${description}多次重试后仍然失败`)
  return false
}

/**
 * 等待按钮出现并点击，带错误检测和自动重试
 */
async function waitAndClickWithRetry(
  page: Page,
  selector: string,
  log: LogCallback,
  description: string,
  timeout: number = 30000,
  maxRetries: number = 3
): Promise<boolean> {
  log(`等待${description}出现...`)
  try {
    const element = page.locator(selector).first()
    await element.waitFor({ state: 'visible', timeout })

    // 模拟鼠标移动
    const box = await element.boundingBox()
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 })
    }
    await page.waitForTimeout(Math.random() * 500 + 300)

    await element.click({ delay: Math.random() * 100 + 50 })
    log(`✓ 已点击${description}`)

    // 检查是否有错误弹窗，如果有则重试
    const success = await checkAndRetryOnError(page, selector, log, description, maxRetries)
    return success
  } catch (error) {
    log(`✗ 点击${description}失败: ${error}`)
    return false
  }
}

/**
 * Outlook 邮箱激活
 * 在 AWS 注册之前激活 Outlook 邮箱，确保能正常接收验证码
 */
export async function activateOutlook(
  email: string,
  emailPassword: string,
  log: LogCallback
): Promise<{ success: boolean; error?: string }> {
  const activationUrl = 'https://go.microsoft.com/fwlink/p/?linkid=2125442'
  let browser: Browser | null = null

  log('========== 开始激活 Outlook 邮箱 ==========')
  log(`邮箱: ${email}`)

  try {
    // 启动浏览器
    log('\n步骤1: 启动浏览器，访问 Outlook 激活页面...')
    browser = await chromium.launch({
      headless: false,
      args: ['--disable-blink-features=AutomationControlled']
    })

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    })

    const page = await context.newPage()

    await page.goto(activationUrl, { waitUntil: 'networkidle', timeout: 60000 })
    log('✓ 页面加载完成')
    await page.waitForTimeout(2000)

    // 步骤2: 等待邮箱输入框出现并输入邮箱
    log('\n步骤2: 输入邮箱...')
    const emailInputSelectors = [
      'input#i0116[type="email"]',
      'input[name="loginfmt"]',
      'input[type="email"]'
    ]

    let emailFilled = false
    for (const selector of emailInputSelectors) {
      try {
        const element = page.locator(selector).first()
        await element.waitFor({ state: 'visible', timeout: 10000 })
        await element.fill(email)
        log(`✓ 已输入邮箱: ${email}`)
        emailFilled = true
        break
      } catch {
        continue
      }
    }

    if (!emailFilled) {
      throw new Error('未找到邮箱输入框')
    }

    await page.waitForTimeout(1000)

    // 步骤3: 点击第一个下一步按钮
    log('\n步骤3: 点击下一步按钮...')
    const firstNextSelectors = [
      'input#idSIButton9[type="submit"]',
      'input[type="submit"][value="下一步"]',
      'input[type="submit"][value="Next"]'
    ]

    if (!(await tryClickSelectors(page, firstNextSelectors, log, '第一个下一步按钮'))) {
      throw new Error('点击第一个下一步按钮失败')
    }

    await page.waitForTimeout(3000)

    // 步骤4: 等待密码输入框出现并输入密码
    log('\n步骤4: 输入密码...')
    const passwordInputSelectors = [
      'input#passwordEntry[type="password"]',
      'input#i0118[type="password"]',
      'input[name="passwd"][type="password"]',
      'input[type="password"]'
    ]

    let passwordFilled = false
    for (const selector of passwordInputSelectors) {
      try {
        const element = page.locator(selector).first()
        await element.waitFor({ state: 'visible', timeout: 15000 })
        await element.fill(emailPassword)
        log('✓ 已输入密码')
        passwordFilled = true
        break
      } catch {
        continue
      }
    }

    if (!passwordFilled) {
      throw new Error('未找到密码输入框')
    }

    await page.waitForTimeout(1000)

    // 步骤5: 点击第二个下一步/登录按钮
    log('\n步骤5: 点击登录按钮...')
    const loginButtonSelectors = [
      'button[type="submit"][data-testid="primaryButton"]',
      'input#idSIButton9[type="submit"]',
      'button:has-text("下一步")',
      'button:has-text("登录")',
      'button:has-text("Sign in")',
      'button:has-text("Next")'
    ]

    if (!(await tryClickSelectors(page, loginButtonSelectors, log, '登录按钮'))) {
      throw new Error('点击登录按钮失败')
    }

    await page.waitForTimeout(3000)

    // 步骤6: 等待第一个"暂时跳过"链接并点击
    log('\n步骤6: 点击第一个"暂时跳过"链接...')
    const skipSelector = 'a#iShowSkip'
    try {
      const skipElement = page.locator(skipSelector).first()
      await skipElement.waitFor({ state: 'visible', timeout: 30000 })

      // 模拟鼠标移动
      const box = await skipElement.boundingBox()
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 })
      }
      await page.waitForTimeout(Math.random() * 500 + 300)

      await skipElement.click({ delay: Math.random() * 100 + 50 })
      log('✓ 已点击第一个"暂时跳过"')
      await page.waitForTimeout(3000)
    } catch {
      log('未找到第一个"暂时跳过"链接，可能已跳过此步骤')
    }

    // 步骤7: 等待第二个"暂时跳过"链接并点击
    log('\n步骤7: 点击第二个"暂时跳过"链接...')
    try {
      const skipElement = page.locator(skipSelector).first()
      await skipElement.waitFor({ state: 'visible', timeout: 15000 })

      // 模拟鼠标移动
      const box = await skipElement.boundingBox()
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 })
      }
      await page.waitForTimeout(Math.random() * 500 + 300)

      await skipElement.click({ delay: Math.random() * 100 + 50 })
      log('✓ 已点击第二个"暂时跳过"')
      await page.waitForTimeout(3000)
    } catch {
      log('未找到第二个"暂时跳过"链接，可能已跳过此步骤')
    }

    // 步骤8: 等待"取消"按钮（密钥创建对话框）并点击
    log('\n步骤8: 点击"取消"按钮（跳过密钥创建）...')
    const cancelButtonSelectors = [
      'button[data-testid="secondaryButton"]:has-text("取消")',
      'button[data-testid="secondaryButton"]:has-text("Cancel")',
      'button[type="button"]:has-text("取消")',
      'button[type="button"]:has-text("Cancel")'
    ]

    if (!(await tryClickSelectors(page, cancelButtonSelectors, log, '"取消"按钮', 15000))) {
      log('未找到"取消"按钮，可能已跳过此步骤')
    }

    await page.waitForTimeout(3000)

    // 步骤9: 等待"是"按钮（保持登录状态）并点击
    log('\n步骤9: 点击"是"按钮（保持登录状态）...')
    const yesButtonSelectors = [
      'button[type="submit"][data-testid="primaryButton"]:has-text("是")',
      'button[type="submit"][data-testid="primaryButton"]:has-text("Yes")',
      'input#idSIButton9[value="是"]',
      'input#idSIButton9[value="Yes"]',
      'button:has-text("是")',
      'button:has-text("Yes")'
    ]

    if (!(await tryClickSelectors(page, yesButtonSelectors, log, '"是"按钮', 15000))) {
      log('未找到"是"按钮，可能已跳过此步骤')
    }

    await page.waitForTimeout(5000)

    // 步骤10: 等待 Outlook 邮箱加载完成
    log('\n步骤10: 等待 Outlook 邮箱加载完成...')
    const newMailSelectors = [
      'button[aria-label="New mail"]',
      'button:has-text("New mail")',
      'button:has-text("新邮件")',
      'span:has-text("New mail")',
      '[data-automation-type="RibbonSplitButton"]'
    ]

    let outlookLoaded = false
    for (const selector of newMailSelectors) {
      try {
        const element = page.locator(selector).first()
        await element.waitFor({ state: 'visible', timeout: 30000 })
        log('✓ Outlook 邮箱激活成功！')
        outlookLoaded = true
        break
      } catch {
        continue
      }
    }

    if (!outlookLoaded) {
      // 检查是否已经在收件箱页面
      const currentUrl = page.url()
      if (
        currentUrl.toLowerCase().includes('outlook') ||
        currentUrl.toLowerCase().includes('mail')
      ) {
        log('✓ 已进入 Outlook 邮箱页面，激活成功！')
        outlookLoaded = true
      }
    }

    await page.waitForTimeout(2000)
    await browser.close()
    browser = null

    if (outlookLoaded) {
      log('\n========== Outlook 邮箱激活完成 ==========')
      return { success: true }
    } else {
      log('\n⚠ Outlook 邮箱激活可能未完成')
      return { success: false, error: 'Outlook 邮箱激活可能未完成' }
    }
  } catch (error) {
    log(`\n✗ Outlook 激活失败: ${error}`)
    if (browser) {
      try {
        await browser.close()
      } catch {}
    }
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * AWS Builder ID 自动注册
 * @param email 邮箱地址
 * @param refreshToken OAuth2 刷新令牌
 * @param clientId Graph API 客户端ID
 * @param log 日志回调
 * @param emailPassword 邮箱密码（用于 Outlook 激活）
 * @param skipOutlookActivation 是否跳过 Outlook 激活
 * @param proxyUrl 代理地址（仅用于 AWS 注册，不用于 Outlook 激活和获取验证码）
 */
export async function autoRegisterAWS(
  email: string,
  refreshToken: string,
  clientId: string,
  log: LogCallback,
  emailPassword?: string,
  skipOutlookActivation: boolean = false,
  proxyUrl?: string
): Promise<{ success: boolean; ssoToken?: string; name?: string; error?: string }> {
  const password = 'admin123456aA!'
  const randomName = generateRandomName()
  let browser: Browser | null = null

  // 如果是 Outlook 邮箱且提供了密码，先激活（不使用代理）
  if (!skipOutlookActivation && email.toLowerCase().includes('outlook') && emailPassword) {
    log('检测到 Outlook 邮箱，先进行激活（不使用代理）...')
    const activationResult = await activateOutlook(email, emailPassword, log)
    if (!activationResult.success) {
      log(`⚠ Outlook 激活可能未完成: ${activationResult.error}`)
      log('继续尝试 AWS 注册...')
    } else {
      log('Outlook 激活成功，开始 AWS 注册...')
    }
    // 等待一下再继续
    await new Promise((r) => setTimeout(r, 2000))
  }

  log('========== 开始 AWS Builder ID 注册 ==========')
  log(`邮箱: ${email}`)
  log(`姓名: ${randomName}`)
  log(`密码: ${password}`)
  if (proxyUrl) {
    log(`代理: ${proxyUrl}`)
  }

  try {
    // 步骤1: 创建浏览器，进入注册页面（使用代理）
    log('\n步骤1: 启动浏览器，进入注册页面...')
    browser = await chromium.launch({
      headless: false,
      proxy: proxyUrl ? { server: proxyUrl } : undefined,
      args: ['--disable-blink-features=AutomationControlled']
    })

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    })

    const page = await context.newPage()

    const registerUrl = 'https://view.awsapps.com/start/#/device?user_code=PQCF-FCCN'
    await page.goto(registerUrl, { waitUntil: 'networkidle', timeout: 60000 })
    log('✓ 页面加载完成')
    await page.waitForTimeout(2000)

    // 等待邮箱输入框出现并输入邮箱（使用人类行为模拟）
    // 选择器: input[placeholder="username@example.com"]
    const emailInputSelector = 'input[placeholder="username@example.com"]'
    if (!(await humanType(page, emailInputSelector, email, log, '邮箱输入框'))) {
      throw new Error('未找到邮箱输入框')
    }

    await page.waitForTimeout(1000)

    // 点击第一个继续按钮（带错误检测和自动重试）
    // 选择器: button[data-testid="test-primary-button"]
    const firstContinueSelector = 'button[data-testid="test-primary-button"]'
    if (!(await waitAndClickWithRetry(page, firstContinueSelector, log, '第一个继续按钮'))) {
      throw new Error('点击第一个继续按钮失败')
    }

    await page.waitForTimeout(3000)

    // 检测是否是已注册账号（登录页面或验证页面）
    // 登录页面标识1: span 包含 "Sign in with your AWS Builder ID"
    // 登录页面标识2: 页面包含 "verify" 字样且有验证码输入框
    const loginHeadingSelector =
      'span[class*="awsui_heading-text"]:has-text("Sign in with your AWS Builder ID")'
    const verifyHeadingSelector = 'span[class*="awsui_heading-text"]:has-text("Verify")'
    const verifyCodeInputSelector = 'input[placeholder="6-digit"]'
    const nameInputSelector = 'input[placeholder="Maria José Silva"]'

    let isLoginFlow = false
    let isVerifyFlow = false // 直接进入验证码步骤的登录流程

    try {
      // 同时检测登录页面、验证页面和注册页面的元素
      const loginHeading = page.locator(loginHeadingSelector).first()
      const verifyHeading = page.locator(verifyHeadingSelector).first()
      const verifyCodeInput = page.locator(verifyCodeInputSelector).first()
      const nameInput = page.locator(nameInputSelector).first()
      const passwordInput = page.locator('input[placeholder="Enter password"]').first()

      // 等待其中一个元素出现（增加超时时间到20秒）
      const result = await Promise.race([
        loginHeading.waitFor({ state: 'visible', timeout: 20000 }).then(() => 'login'),
        verifyHeading.waitFor({ state: 'visible', timeout: 20000 }).then(() => 'verify'),
        verifyCodeInput.waitFor({ state: 'visible', timeout: 20000 }).then(() => 'verify-input'),
        passwordInput.waitFor({ state: 'visible', timeout: 20000 }).then(() => 'password'),
        nameInput.waitFor({ state: 'visible', timeout: 20000 }).then(() => 'register')
      ])

      if (result === 'login' || result === 'password') {
        isLoginFlow = true
      } else if (result === 'verify' || result === 'verify-input') {
        isLoginFlow = true
        isVerifyFlow = true
      }

      log(`检测到流程类型: ${result}`)
    } catch {
      // 如果都没找到，尝试单独检测
      log('主检测超时，尝试单独检测各个元素...')

      try {
        await page
          .locator(loginHeadingSelector)
          .first()
          .waitFor({ state: 'visible', timeout: 5000 })
        isLoginFlow = true
        log('检测到登录标题')
      } catch {
        try {
          await page
            .locator('input[placeholder="Enter password"]')
            .first()
            .waitFor({ state: 'visible', timeout: 5000 })
          isLoginFlow = true
          log('检测到密码输入框')
        } catch {
          try {
            // 检测 verify 标题或验证码输入框
            const hasVerify = await page
              .locator(verifyHeadingSelector)
              .first()
              .isVisible()
              .catch(() => false)
            const hasVerifyInput = await page
              .locator(verifyCodeInputSelector)
              .first()
              .isVisible()
              .catch(() => false)
            if (hasVerify || hasVerifyInput) {
              isLoginFlow = true
              isVerifyFlow = true
              log('检测到验证码页面')
            }
          } catch {
            isLoginFlow = false
            log('未检测到登录流程，默认为注册流程')
          }
        }
      }
    }

    if (isLoginFlow) {
      // ========== 登录流程（邮箱已注册）==========
      if (isVerifyFlow) {
        log('\n⚠ 检测到验证页面，邮箱已注册，直接进入验证码步骤...')
      } else {
        log('\n⚠ 检测到邮箱已注册，切换到登录流程...')
      }

      // 如果不是直接验证流程，需要先输入密码
      if (!isVerifyFlow) {
        // 步骤2(登录): 输入密码（使用人类行为模拟）
        log('\n步骤2(登录): 输入密码...')
        const loginPasswordSelector = 'input[placeholder="Enter password"]'
        if (!(await humanType(page, loginPasswordSelector, password, log, '登录密码输入框'))) {
          throw new Error('未找到登录密码输入框')
        }

        await page.waitForTimeout(1000)

        // 点击继续按钮
        const loginContinueSelector = 'button[data-testid="test-primary-button"]'
        if (!(await waitAndClickWithRetry(page, loginContinueSelector, log, '登录继续按钮'))) {
          throw new Error('点击登录继续按钮失败')
        }

        await page.waitForTimeout(3000)
      }

      // 步骤3(登录): 等待验证码输入框出现，获取并输入验证码
      log('\n步骤3(登录): 获取并输入验证码...')
      // 登录验证码输入框选择器（支持多种 placeholder）
      const loginCodeSelectors = [
        'input[placeholder="6-digit"]',
        'input[placeholder="6 位数"]',
        'input[class*="awsui_input"][type="text"]'
      ]

      let loginCodeInput: string | null = null
      for (const selector of loginCodeSelectors) {
        try {
          await page.locator(selector).first().waitFor({ state: 'visible', timeout: 10000 })
          loginCodeInput = selector
          log('✓ 登录验证码输入框已出现')
          break
        } catch {
          continue
        }
      }

      if (!loginCodeInput) {
        throw new Error('未找到登录验证码输入框')
      }

      await page.waitForTimeout(1000)

      // 自动获取验证码
      let loginVerificationCode: string | null = null
      if (refreshToken && clientId) {
        loginVerificationCode = await getOutlookVerificationCode(refreshToken, clientId, log, 120)
      } else {
        log('缺少 refresh_token 或 client_id，无法自动获取验证码')
      }

      if (!loginVerificationCode) {
        throw new Error('无法获取登录验证码')
      }

      // 输入验证码
      if (!(await waitAndFill(page, loginCodeInput, loginVerificationCode, log, '登录验证码'))) {
        throw new Error('输入登录验证码失败')
      }

      await page.waitForTimeout(1000)

      // 点击验证码确认按钮
      const loginVerifySelector = 'button[data-testid="test-primary-button"]'
      if (!(await waitAndClickWithRetry(page, loginVerifySelector, log, '登录验证码确认按钮'))) {
        throw new Error('点击登录验证码确认按钮失败')
      }

      await page.waitForTimeout(5000)
    } else {
      // ========== 注册流程（新账号）==========
      // 步骤2: 等待姓名输入框出现，输入姓名
      log('\n步骤2: 输入姓名...')
      if (!(await humanType(page, nameInputSelector, randomName, log, '姓名输入框'))) {
        throw new Error('未找到姓名输入框')
      }

      await page.waitForTimeout(Math.random() * 1000 + 500)

      // 使用更像人的点击方式提交
      const secondContinueSelector = 'button[data-testid="signup-next-button"]'
      if (!(await humanClick(page, secondContinueSelector, log, '第二个继续按钮'))) {
        throw new Error('点击第二个继续按钮失败')
      }

      // 容错：如果点击后没动静（可能是因为姓名页有前端校验），强制模拟一次 Enter 键
      await page.waitForTimeout(2000)
      if (await page.locator(nameInputSelector).isVisible()) {
        log('检测到仍在姓名页面，尝试模拟 Enter 键提交...')
        await page.keyboard.press('Enter')
      }

      await page.waitForTimeout(1000)

      await page.waitForTimeout(3000)

      // 步骤3: 等待验证码输入框出现，获取并输入验证码
      log('\n步骤3: 获取并输入验证码...')
      // 选择器: input[placeholder="6 位数"]
      const codeInputSelector = 'input[placeholder="6 位数"]'

      // 先等待验证码输入框出现
      log('等待验证码输入框出现...')
      try {
        await page.locator(codeInputSelector).first().waitFor({ state: 'visible', timeout: 30000 })
        log('✓ 验证码输入框已出现')
      } catch {
        throw new Error('未找到验证码输入框')
      }

      await page.waitForTimeout(1000)

      // 自动获取验证码
      let verificationCode: string | null = null
      if (refreshToken && clientId) {
        verificationCode = await getOutlookVerificationCode(refreshToken, clientId, log, 120)
      } else {
        log('缺少 refresh_token 或 client_id，无法自动获取验证码')
      }

      if (!verificationCode) {
        throw new Error('无法获取验证码')
      }

      // 输入验证码
      if (!(await waitAndFill(page, codeInputSelector, verificationCode, log, '验证码'))) {
        throw new Error('输入验证码失败')
      }

      await page.waitForTimeout(1000)

      // 点击 Continue 按钮（带错误检测和自动重试）
      // 选择器: button[data-testid="email-verification-verify-button"]
      const verifyButtonSelector = 'button[data-testid="email-verification-verify-button"]'
      if (!(await waitAndClickWithRetry(page, verifyButtonSelector, log, 'Continue 按钮'))) {
        throw new Error('点击 Continue 按钮失败')
      }

      await page.waitForTimeout(3000)

      // 步骤4: 等待密码输入框出现，输入密码
      log('\n步骤4: 输入密码...')
      // 选择器: input[placeholder="Enter password"]
      const passwordInputSelector = 'input[placeholder="Enter password"]'
      if (!(await waitAndFill(page, passwordInputSelector, password, log, '密码输入框'))) {
        throw new Error('未找到密码输入框')
      }

      await page.waitForTimeout(500)

      // 输入确认密码
      // 选择器: input[placeholder="Re-enter password"]
      const confirmPasswordSelector = 'input[placeholder="Re-enter password"]'
      if (!(await waitAndFill(page, confirmPasswordSelector, password, log, '确认密码输入框'))) {
        throw new Error('未找到确认密码输入框')
      }

      await page.waitForTimeout(1000)

      // 点击第三个继续按钮（带错误检测和自动重试）
      // 选择器: button[data-testid="test-primary-button"]
      const thirdContinueSelector = 'button[data-testid="test-primary-button"]'
      if (!(await waitAndClickWithRetry(page, thirdContinueSelector, log, '第三个继续按钮'))) {
        throw new Error('点击第三个继续按钮失败')
      }

      await page.waitForTimeout(5000)
    }

    // 步骤5: 获取 SSO Token（登录和注册流程共用）
    log('\n步骤5: 获取 SSO Token...')
    let ssoToken: string | null = null

    for (let i = 0; i < 30; i++) {
      const cookies = await context.cookies()
      const ssoCookie = cookies.find((c) => c.name === 'x-amz-sso_authn')
      if (ssoCookie) {
        ssoToken = ssoCookie.value
        log(`✓ 成功获取 SSO Token (x-amz-sso_authn)!`)
        break
      }
      log(`等待 SSO Token... (${i + 1}/30)`)
      await page.waitForTimeout(1000)
    }

    await browser.close()
    browser = null

    if (ssoToken) {
      log('\n========== 操作成功! ==========')
      return { success: true, ssoToken, name: randomName }
    } else {
      throw new Error('未能获取 SSO Token，可能操作未完成')
    }
  } catch (error) {
    log(`\n✗ 注册失败: ${error}`)
    if (browser) {
      try {
        await browser.close()
      } catch {}
    }
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}
