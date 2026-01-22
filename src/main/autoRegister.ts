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

// ============ 人性化操作辅助函数 ============

/**
 * 生成随机延迟（模拟人类思考时间）
 * @param min 最小延迟（毫秒）
 * @param max 最大延迟（毫秒）
 */
function randomDelay(min: number, max: number): number {
  return Math.random() * (max - min) + min
}

/**
 * 生成贝塞尔曲线上的点（模拟真实鼠标移动轨迹）
 */
function bezierCurve(start: { x: number; y: number }, end: { x: number; y: number }, steps: number) {
  const points: { x: number; y: number }[] = []

  // 生成两个随机控制点
  const cp1 = {
    x: start.x + (end.x - start.x) * (0.25 + Math.random() * 0.25),
    y: start.y + (end.y - start.y) * (0.25 + Math.random() * 0.25) + (Math.random() - 0.5) * 100
  }
  const cp2 = {
    x: start.x + (end.x - start.x) * (0.5 + Math.random() * 0.25),
    y: start.y + (end.y - start.y) * (0.5 + Math.random() * 0.25) + (Math.random() - 0.5) * 100
  }

  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const mt = 1 - t
    const mt2 = mt * mt
    const mt3 = mt2 * mt
    const t2 = t * t
    const t3 = t2 * t

    const x = mt3 * start.x + 3 * mt2 * t * cp1.x + 3 * mt * t2 * cp2.x + t3 * end.x
    const y = mt3 * start.y + 3 * mt2 * t * cp1.y + 3 * mt * t2 * cp2.y + t3 * end.y

    points.push({ x, y })
  }

  return points
}

/**
 * 人性化鼠标移动（带曲线轨迹）
 */
async function humanMouseMove(page: Page, targetX: number, targetY: number) {
  try {
    // 获取当前鼠标位置（假设从页面中心开始）
    const viewport = page.viewportSize()
    const startX = viewport ? viewport.width / 2 : 640
    const startY = viewport ? viewport.height / 2 : 360

    // 生成贝塞尔曲线轨迹
    const steps = Math.floor(randomDelay(15, 30))
    const points = bezierCurve({ x: startX, y: startY }, { x: targetX, y: targetY }, steps)

    // 沿着曲线移动鼠标
    for (const point of points) {
      await page.mouse.move(point.x, point.y)
      await page.waitForTimeout(randomDelay(5, 15))
    }
  } catch (error) {
    // 如果曲线移动失败，使用简单移动
    await page.mouse.move(targetX, targetY)
  }
}

/**
 * 人性化点击（带随机延迟和鼠标移动）
 */
async function humanClick(page: Page, selector: string, description: string = '元素'): Promise<boolean> {
  try {
    const element = page.locator(selector).first()
    await element.waitFor({ state: 'visible', timeout: 10000 })

    // 获取元素位置
    const box = await element.boundingBox()
    if (box) {
      // 随机选择点击位置（在元素范围内）
      const clickX = box.x + box.width * (0.3 + Math.random() * 0.4)
      const clickY = box.y + box.height * (0.3 + Math.random() * 0.4)

      // 移动鼠标到目标位置
      await humanMouseMove(page, clickX, clickY)

      // 随机停顿（模拟思考）
      await page.waitForTimeout(randomDelay(100, 300))

      // 点击
      await element.click({ delay: randomDelay(50, 150) })
      return true
    }

    // 如果无法获取位置，直接点击
    await element.click({ delay: randomDelay(50, 150) })
    return true
  } catch (error) {
    return false
  }
}

/**
 * 人性化输入文本（每个字符随机延迟）
 */
async function humanType(page: Page, selector: string, text: string, description: string = '文本'): Promise<boolean> {
  try {
    const element = page.locator(selector).first()
    await element.waitFor({ state: 'visible', timeout: 10000 })

    // 点击输入框
    await element.click({ delay: randomDelay(50, 100) })
    await page.waitForTimeout(randomDelay(100, 300))

    // 清空输入框
    await element.clear()
    await page.waitForTimeout(randomDelay(50, 150))

    // 逐字符输入，每个字符延迟不同
    for (const char of text) {
      await element.type(char, { delay: randomDelay(50, 150) })
      // 偶尔停顿更久（模拟思考或查看）
      if (Math.random() < 0.1) {
        await page.waitForTimeout(randomDelay(200, 500))
      }
    }

    return true
  } catch (error) {
    return false
  }
}

// 验证码正则表达式 - 与 Python 版本保持一致
const CODE_PATTERNS = [
  // AWS/Amazon 验证码格式
  /(?:verification\s*code|验证码|Your code is|code is)[：:\s]*(\d{6})/gi,
  /(?:is|为)[：:\s]*(\d{6})\b/gi,
  // Microsoft 安全代码格式
  /(?:安全代码|security\s*code)[：:\s]*(\d{6})/gi,
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

// Microsoft 安全代码发件人
const MICROSOFT_SENDERS = [
  'account-security-noreply@accountprotection.microsoft.com',
  'microsoft.com',
  'microsoft' // 模糊匹配
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
  timeout: number = 120,
  codeType: 'aws' | 'microsoft' = 'aws'
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

      // 根据类型选择发件人列表
      const senders = codeType === 'microsoft' ? MICROSOFT_SENDERS : AWS_SENDERS
      const senderType = codeType === 'microsoft' ? 'Microsoft' : 'AWS'

      // 搜索最新的邮件 - 只检查最近60秒内收到的邮件
      const now = Date.now()
      const recentThreshold = 60000 // 60秒

      for (const mail of mailData.value || []) {
        const fromEmail = mail.from?.emailAddress?.address?.toLowerCase() || ''
        const isTargetSender = senders.some((s) => fromEmail.includes(s.toLowerCase()))

        // 检查邮件接收时间
        const receivedTime = new Date(mail.receivedDateTime).getTime()
        const isRecent = (now - receivedTime) < recentThreshold

        if (isTargetSender && !checkedIds.has(mail.id)) {
          checkedIds.add(mail.id)

          log(`\n=== 检查 ${senderType} 邮件 ===`)
          log(`  发件人: ${fromEmail}`)
          log(`  主题: ${mail.subject?.substring(0, 50)}`)
          log(`  接收时间: ${mail.receivedDateTime}`)
          log(`  是否为最近邮件: ${isRecent}`)

          // 只处理最近的邮件
          if (!isRecent) {
            log(`  ⚠ 邮件过旧，跳过`)
            continue
          }

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

    // 获取元素位置并移动鼠标
    const box = await element.boundingBox()
    if (box) {
      const clickX = box.x + box.width * (0.3 + Math.random() * 0.4)
      const clickY = box.y + box.height * (0.3 + Math.random() * 0.4)
      await humanMouseMove(page, clickX, clickY)
    }

    // 随机停顿
    await page.waitForTimeout(randomDelay(200, 500))

    // 点击并清空
    await element.click({ delay: randomDelay(50, 100) })
    await page.waitForTimeout(randomDelay(100, 300))
    await element.clear()
    await page.waitForTimeout(randomDelay(50, 150))

    // 逐字符输入
    for (const char of value) {
      await element.type(char, { delay: randomDelay(50, 150) })
      // 偶尔停顿更久
      if (Math.random() < 0.1) {
        await page.waitForTimeout(randomDelay(200, 500))
      }
    }

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

      // 获取元素位置并使用贝塞尔曲线移动鼠标
      const box = await element.boundingBox()
      if (box) {
        const clickX = box.x + box.width * (0.3 + Math.random() * 0.4)
        const clickY = box.y + box.height * (0.3 + Math.random() * 0.4)
        await humanMouseMove(page, clickX, clickY)
      }

      // 随机停顿（模拟思考）
      await page.waitForTimeout(randomDelay(300, 800))

      // 点击
      await element.click({ delay: randomDelay(50, 150) })
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
  log: LogCallback,
  backupEmail?: string,
  backupEmailRefreshToken?: string,
  backupEmailClientId?: string
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

    // 新增步骤5.5: 检测并处理"添加安全信息"页面
    log('\n步骤5.5: 检测是否需要添加安全信息...')
    const securityInfoSelectors = [
      'input[type="email"][placeholder*="example.com"]',
      'input[type="email"][name="EmailAddress"]',
      'input[type="email"]'
    ]

    let needsSecurityInfo = false
    for (const selector of securityInfoSelectors) {
      try {
        const element = page.locator(selector).first()
        await element.waitFor({ state: 'visible', timeout: 5000 })
        const pageText = await page.textContent('body')
        if (pageText && (pageText.includes('保护你的帐户') || pageText.includes('安全信息') || pageText.includes('备用电子邮件'))) {
          needsSecurityInfo = true
          log('✓ 检测到需要添加安全信息')

          // 使用备用邮箱（如果提供）或使用固定的备用邮箱
          const backupEmailToUse = backupEmail || 'backup.verify@outlook.com'
          log(`   输入备用邮箱: ${backupEmailToUse}`)

          await element.click()
          await page.waitForTimeout(200)
          await element.clear()
          await element.fill(backupEmailToUse)
          log('✓ 已输入备用邮箱')

          await page.waitForTimeout(1000)

          // 点击"下一步"按钮
          const nextButtonSelectors = [
            'input#idSIButton9[type="submit"]',
            'input[type="submit"][value="下一步"]',
            'input[type="submit"][value="Next"]',
            'button[type="submit"]'
          ]

          if (await tryClickSelectors(page, nextButtonSelectors, log, '安全信息下一步按钮')) {
            log('✓ 已点击下一步，等待验证码邮件发送...')

            // 如果提供了备用邮箱的 refresh token，则自动获取验证码
            if (backupEmailRefreshToken && backupEmailClientId) {
              // 等待更长时间让邮件到达（15秒）
              log('   等待 Microsoft 发送验证码邮件（15秒）...')
              await page.waitForTimeout(15000)

              log('   正在从备用邮箱获取验证码...')
              const securityCode = await getOutlookVerificationCode(
                backupEmailRefreshToken,
                backupEmailClientId,
                log,
                120,
                'microsoft' // 获取 Microsoft 安全代码
              )

              if (securityCode) {
                log(`   获取到验证码: ${securityCode}`)

                // 等待验证码输入框出现
                log('   等待验证码输入框出现...')
                await page.waitForTimeout(2000)

                // 输入验证码 - 使用更精确的选择器（优先使用最常见的类型）
                const codeInputSelectors = [
                  'input[type="tel"]',  // 验证码输入框通常是 tel 类型
                  'input[aria-label*="code"]',
                  'input[aria-label*="代码"]',
                  'input[placeholder*="代码"]',
                  'input[type="text"]',
                  'input[name="ProofConfirmation"]',
                  'input[type="text"][name="ProofConfirmation"]'
                ]

                let codeInputSuccess = false
                for (const codeSelector of codeInputSelectors) {
                  try {
                    const codeInput = page.locator(codeSelector).first()
                    await codeInput.waitFor({ state: 'visible', timeout: 5000 })

                    // 获取元素位置并移动鼠标
                    const box = await codeInput.boundingBox()
                    if (box) {
                      const clickX = box.x + box.width * (0.3 + Math.random() * 0.4)
                      const clickY = box.y + box.height * (0.3 + Math.random() * 0.4)
                      await humanMouseMove(page, clickX, clickY)
                    }

                    await page.waitForTimeout(randomDelay(200, 400))
                    await codeInput.click({ delay: randomDelay(50, 100) })
                    await page.waitForTimeout(randomDelay(100, 300))
                    await codeInput.clear()
                    await page.waitForTimeout(randomDelay(50, 150))

                    // 逐字输入验证码，每个字符延迟不同
                    for (const char of securityCode) {
                      await codeInput.type(char, { delay: randomDelay(80, 180) })
                      // 偶尔停顿（模拟查看验证码）
                      if (Math.random() < 0.15) {
                        await page.waitForTimeout(randomDelay(200, 400))
                      }
                    }

                    log(`✓ 已输入验证码: ${securityCode}`)
                    codeInputSuccess = true
                    break
                  } catch (error) {
                    log(`   尝试选择器 ${codeSelector} 失败: ${error}`)
                    continue
                  }
                }

                if (!codeInputSuccess) {
                  log('⚠ 未找到验证码输入框，请手动输入')
                  await page.waitForTimeout(30000)
                } else {
                  await page.waitForTimeout(1000)

                  // 点击验证按钮
                  if (await tryClickSelectors(page, nextButtonSelectors, log, '验证按钮')) {
                    log('✓ 验证码验证成功')
                    await page.waitForTimeout(3000)

                    // 处理"保持登录状态"提示
                    log('\n步骤5.6: 处理"保持登录状态"提示...')
                    const staySignedInSelectors = [
                      'input#idSIButton9[value="是"]',
                      'input#idSIButton9[value="Yes"]',
                      'button[type="submit"]:has-text("是")',
                      'button[type="submit"]:has-text("Yes")',
                      'button:has-text("是")',
                      'button:has-text("Yes")'
                    ]

                    if (await tryClickSelectors(page, staySignedInSelectors, log, '"是"按钮（保持登录）', 10000)) {
                      log('✓ 已点击"是"按钮')
                      await page.waitForTimeout(3000)
                    } else {
                      log('未找到"是"按钮，可能已跳过')
                    }
                  }
                }
              } else {
                log('⚠ 无法自动获取验证码，需要手动处理')
                await page.waitForTimeout(60000) // 等待60秒供手动操作
              }
            } else {
              log('⚠ 未提供备用邮箱凭据，无法自动获取验证码')
              log('   请手动在浏览器中完成验证...')
              await page.waitForTimeout(30000) // 等待30秒供手动操作
            }
          }

          break
        }
      } catch {
        continue
      }
    }

    if (!needsSecurityInfo) {
      log('✓ 无需添加安全信息，继续下一步')
    }

    // 步骤6: 等待 Outlook 邮箱加载完成
    log('\n步骤6: 等待 Outlook 邮箱加载完成...')

    // 等待邮箱界面的关键元素出现
    const outlookLoadedSelectors = [
      'button[aria-label="New mail"]',
      'button:has-text("New mail")',
      'button:has-text("新邮件")',
      'span:has-text("Inbox")',
      'span:has-text("收件箱")',
      '[data-automation-type="RibbonSplitButton"]',
      'div[role="main"]'
    ]

    let outlookLoaded = false
    for (const selector of outlookLoadedSelectors) {
      try {
        const element = page.locator(selector).first()
        await element.waitFor({ state: 'visible', timeout: 10000 })
        log('✓ Outlook 邮箱加载完成！')
        outlookLoaded = true
        break
      } catch {
        continue
      }
    }

    if (!outlookLoaded) {
      // 检查 URL 是否已经在 Outlook 页面
      const currentUrl = page.url()
      if (currentUrl.toLowerCase().includes('outlook') || currentUrl.toLowerCase().includes('mail')) {
        log('✓ 已进入 Outlook 邮箱页面')
        outlookLoaded = true
      }
    }

    if (outlookLoaded) {
      log('✓ Outlook 邮箱激活成功！')
    } else {
      log('⚠️ 无法确认 Outlook 邮箱是否完全加载，但继续执行')
    }

    await page.waitForTimeout(1000)
    await browser.close()
    browser = null

    log('\n========== Outlook 邮箱激活完成 ==========')
    return { success: true }
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
 * @param backupEmail 备用邮箱（用于 Outlook 安全验证）
 * @param backupEmailRefreshToken 备用邮箱的 refresh token
 * @param backupEmailClientId 备用邮箱的 client ID
 */
export async function autoRegisterAWS(
  email: string,
  refreshToken: string,
  clientId: string,
  log: LogCallback,
  emailPassword?: string,
  skipOutlookActivation: boolean = false,
  proxyUrl?: string,
  backupEmail?: string,
  backupEmailRefreshToken?: string,
  backupEmailClientId?: string
): Promise<{ success: boolean; ssoToken?: string; name?: string; error?: string }> {
  const password = 'admin123456aA!'
  const randomName = generateRandomName()
  let browser: Browser | null = null

  // 如果是 Outlook 邮箱且提供了密码，先激活（不使用代理）
  if (!skipOutlookActivation && email.toLowerCase().includes('outlook') && emailPassword) {
    log('检测到 Outlook 邮箱，先进行激活（不使用代理）...')
    const activationResult = await activateOutlook(
      email,
      emailPassword,
      log,
      backupEmail,
      backupEmailRefreshToken,
      backupEmailClientId
    )
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
