# AWS Builder ID 自动注册工具 - Agent 使用指南

## 项目概述

这是一个基于 Electron + TypeScript 的 AWS Builder ID 自动注册工具，实现了从 Outlook 邮箱激活到 AWS Builder ID 注册的完全自动化流程。

**核心功能**：
- Outlook 邮箱离线验证码获取（Microsoft Graph API）
- AWS Builder ID 浏览器自动化注册（Playwright）
- 批量账号注册和管理
- 自动导出注册结果

## 快速开始

### 1. 环境准备

```bash
# 安装依赖
npm install

# 或使用 pnpm
pnpm install
```

**系统要求**：
- Node.js 18+
- macOS / Windows / Linux

### 2. 准备邮箱数据

创建邮箱列表文件，格式为：`邮箱|密码|refresh_token|client_id`

**文件位置**：项目根目录下的 `ids.txt` 或 `ids_cleaned.txt`

**示例格式**：
```
user1@outlook.com|password123|M.C509_SN1.2.U.-CqgBa...|9e5f94bc-e65a-4f06-adc5-9d24e20c07d4
user2@outlook.com|password456|M.C509_SN1.2.U.-DrbCb...|9e5f94bc-e65a-4f06-adc5-9d24e20c07d4
```

**获取 refresh_token 和 client_id**：
1. 访问 [Microsoft Azure Portal](https://portal.azure.com/)
2. 注册应用程序获取 `client_id`
3. 使用 OAuth 2.0 Device Flow 获取 `refresh_token`
4. 参考文档：[Outlook OAuth2 登录验证逻辑](./AWS-Builder-ID-自动化技术总结.md#outlook-oauth2-登录验证逻辑)

### 3. 启动应用

```bash
# 开发模式
npm run dev

# 或
pnpm dev
```

### 4. 使用流程

#### 步骤 1：导入邮箱列表
1. 点击"导入邮箱列表"按钮
2. 选择准备好的邮箱文件（`ids.txt` 或 `ids_cleaned.txt`）
3. 系统会自动解析并显示邮箱列表

#### 步骤 2：开始批量注册
1. 点击"开始批量注册"按钮
2. 系统会自动执行以下流程：
   - 使用 Microsoft Graph API 刷新 access_token
   - 启动 Playwright 浏览器
   - 访问 AWS Builder ID 注册页面
   - 输入邮箱地址
   - 自动获取验证码（离线模式）
   - 输入验证码和个人信息
   - 完成注册

#### 步骤 3：监控注册进度
- 界面会实时显示每个账号的注册状态
- 状态包括：等待中、进行中、成功、失败
- 可以查看详细的错误信息

#### 步骤 4：导出注册结果
1. 注册完成后，点击"导出已注册账号"按钮
2. 系统会生成 `kiro-accounts-{timestamp}.txt` 文件
3. 文件包含所有成功注册的账号信息

**导出文件格式**：
```json
{
  "email": "user@outlook.com",
  "builderId": "arn:aws:iam::123456789012:user/john.doe",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "region": "us-east-1",
  "registeredAt": "2026-01-19T10:30:00Z"
}
```

## 核心功能说明

### 1. 离线验证码获取

**工作原理**：
- 使用 Microsoft Graph API 获取邮件
- 无需打开浏览器登录邮箱
- 速度快，成功率高

**关键代码位置**：
- `src/main/autoRegister.ts` - `getVerificationCodeOffline()` 函数

**API 端点**：
```
GET https://graph.microsoft.com/v1.0/me/messages
```

### 2. 浏览器自动化

**工作原理**：
- 使用 Playwright 控制浏览器
- 模拟真实用户操作
- 实现反检测机制

**关键代码位置**：
- `src/main/autoRegister.ts` - `registerWithBrowser()` 函数

**反检测技巧**：
- 随机延迟（100-300ms）
- 模拟人类输入速度
- 隐藏 webdriver 特征

### 3. 批量注册管理

**工作原理**：
- 队列式处理，避免并发过高
- 失败自动重试（最多 3 次）
- 实时状态更新

**关键代码位置**：
- `src/main/autoRegister.ts` - `batchRegister()` 函数

## 常见问题处理

### 问题 1：refresh_token 过期

**现象**：
```
Error: invalid_grant - The refresh token has expired
```

**解决方案**：
1. 重新获取 refresh_token
2. 更新邮箱列表文件
3. 重新导入

### 问题 2：验证码获取失败

**现象**：
```
Error: 未找到验证码邮件
```

**可能原因**：
- 邮件延迟（AWS 发送邮件需要 5-30 秒）
- 邮件被过滤到垃圾箱
- refresh_token 无效

**解决方案**：
1. 等待 30-60 秒后重试
2. 检查邮箱垃圾箱
3. 验证 refresh_token 是否有效

### 问题 3：浏览器启动失败

**现象**：
```
Error: Failed to launch browser
```

**解决方案**：
```bash
# macOS
brew install chromium

# Ubuntu/Debian
sudo apt-get install chromium-browser

# 或重新安装 Playwright
npx playwright install chromium
```

### 问题 4：注册时遇到 CAPTCHA

**现象**：
页面显示人机验证

**解决方案**：
1. 降低注册频率（每个账号间隔 30-60 秒）
2. 使用不同的 IP 地址（代理）
3. 手动完成人机验证后继续

### 问题 5：同一邮箱不能重复注册

**现象**：
```
Error: Email already registered
```

**解决方案**：
- 使用邮箱别名（Gmail: user+1@gmail.com）
- 使用不同的邮箱账号

## 高级配置

### 1. 修改注册参数

编辑 `src/main/autoRegister.ts`：

```typescript
// 修改验证码等待时间（默认 60 秒）
const MAX_WAIT_TIME = 60000

// 修改重试次数（默认 3 次）
const MAX_RETRIES = 3

// 修改浏览器 headless 模式（默认 false）
const browser = await playwright.chromium.launch({
  headless: false  // 改为 true 可以隐藏浏览器窗口
})
```

### 2. 自定义验证码提取规则

编辑 `src/main/autoRegister.ts` 中的 `CODE_PATTERNS`：

```typescript
const CODE_PATTERNS = [
  /verification code is[：:\s]*(\d{6})/gi,
  /(?:verification\s*code|验证码)[：:\s]*(\d{6})/gi,
  // 添加自定义规则
  /your code[：:\s]*(\d{6})/gi
]
```

### 3. 配置 AWS 区域

默认使用 `us-east-1`，可以修改：

```typescript
const region = 'us-west-2'  // 或其他区域
```

## 与 AIClient-2-API 集成

### 1. 导出凭证格式

注册完成后，导出的文件可以直接用于 AIClient-2-API：

```bash
# 复制导出文件到 AIClient-2-API 配置目录
cp kiro-accounts-*.txt /path/to/AIClient-2-API/configs/kiro/
```

### 2. AIClient-2-API 配置

编辑 `configs/claude-kiro-oauth.json`：

```json
{
  "credentials": [
    {
      "uuid": "account-1",
      "profileArn": "arn:aws:iam::123456789012:user/john.doe",
      "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "region": "us-east-1",
      "authMethod": "social"
    }
  ]
}
```

### 3. 验证集成

```bash
# 在 AIClient-2-API 目录下
npm run kiro:usage

# 应该能看到新添加的账号
```

## 项目结构

```
Kiro-auto-register/
├── src/
│   ├── main/
│   │   ├── index.ts              # Electron 主进程
│   │   └── autoRegister.ts       # 自动注册核心逻辑
│   ├── preload/
│   │   └── index.ts              # Preload 脚本
│   └── renderer/
│       └── src/
│           ├── components/       # React 组件
│           └── store/            # Zustand 状态管理
├── ids.txt                       # 邮箱列表（需自行创建）
├── kiro-accounts-*.txt           # 导出的注册结果
└── README-AGENT.md               # 本文档
```

## 开发调试

### 1. 查看日志

```bash
# 主进程日志
# macOS: ~/Library/Logs/kiro-auto-register/
# Windows: %USERPROFILE%\AppData\Roaming\kiro-auto-register\logs\
# Linux: ~/.config/kiro-auto-register/logs/

# 或在开发模式下查看控制台输出
npm run dev
```

### 2. 调试浏览器自动化

设置 `headless: false` 可以看到浏览器操作过程：

```typescript
const browser = await playwright.chromium.launch({
  headless: false,
  slowMo: 100  // 减慢操作速度，便于观察
})
```

### 3. 测试单个账号

修改 `src/main/autoRegister.ts`：

```typescript
// 只处理第一个账号
const testAccount = accounts[0]
await registerSingleAccount(testAccount)
```

## 性能优化建议

### 1. 批量注册优化

```typescript
// 控制并发数量（建议 3-5 个）
const BATCH_SIZE = 3

// 批次之间延迟（避免触发速率限制）
const BATCH_DELAY = 5000  // 5 秒
```

### 2. 内存优化

```typescript
// 及时关闭浏览器实例
await browser.close()

// 清理缓存
await page.context().clearCookies()
```

### 3. 网络优化

```typescript
// 使用代理（如果需要）
const browser = await playwright.chromium.launch({
  proxy: {
    server: 'http://proxy.example.com:8080'
  }
})
```

## 安全注意事项

1. **敏感数据保护**：
   - `ids.txt` 和 `ids_cleaned.txt` 已添加到 `.gitignore`
   - 不要将包含敏感信息的文件提交到 Git

2. **Token 安全**：
   - refresh_token 是长期凭证，需要妥善保管
   - 建议加密存储

3. **日志脱敏**：
   - 日志中只打印 token 的前 10 个字符
   - 不要在日志中打印完整的密码和 token

## 相关文档

- [AWS Builder ID 自动化注册技术总结](./AWS-Builder-ID-自动化技术总结.md)
- [Kiro 注册机技术解析](../quartz-blog/content/posts/SecondaryDevelopment/Kiro%20注册机.md)
- [AWS Builder ID 完整自动化链路实现](../quartz-blog/content/posts/SecondaryDevelopment/AWS%20Builder%20ID%20完整自动化链路实现.md)

## 版本信息

- **当前版本**：v1.0.0
- **最后更新**：2026-01-19
- **技术栈**：Electron 38.1.2 + React 19.1 + Playwright + TypeScript

## 许可证

本项目仅供学习和研究使用，请勿用于商业用途。
