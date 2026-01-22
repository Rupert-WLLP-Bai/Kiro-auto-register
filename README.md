# Kiro Auto Register

> 自动化批量注册 AWS Builder ID 并生成 Kiro IDE 凭证的工具

## 📖 项目简介

本项目与 [AIClient-2-API](https://github.com/justlovemaki/AIClient-2-API) 联动使用，主要解决 **Kiro IDE 的注册和凭证生成问题**，支持批量导入 Outlook 邮箱进行自动化注册。

### 核心功能

- ✅ **批量注册 AWS Builder ID**：自动完成邮箱验证、密码设置等步骤
- ✅ **自动激活 Outlook 邮箱**：确保邮箱能正常接收验证码
- ✅ **自动获取验证码**：通过 Microsoft Graph API 自动读取邮箱验证码
- ✅ **生成 Kiro 凭证**：自动保存到 AIClient-2-API 配置目录
- ✅ **并行注册**：支持多账号并发注册，提高效率
- ✅ **断点续传**：支持中断后恢复，人工介入后继续执行
- ✅ **独立辅助邮箱**：主邮箱和辅助邮箱可使用不同的起始索引

## 🚀 快速开始

### 前置要求

1. **安装 Node.js**（推荐 v18 或更高版本）
2. **安装 AIClient-2-API**：
   ```bash
   git clone https://github.com/justlovemaki/AIClient-2-API.git
   cd AIClient-2-API
   # 按照其 README 完成安装
   ```

3. **安装依赖**：
   ```bash
   npm install
   ```

### 准备账号文件

#### 1. 主邮箱文件格式

创建 `accounts.txt` 文件，每行一个账号，格式如下：

```
email|password|refresh_token|client_id
```

**示例：**
```
example1@outlook.com|YourPassword123!|M.C509_xxx...|9e5f94bc-xxx...
example2@outlook.com|YourPassword123!|M.C509_xxx...|9e5f94bc-xxx...
```

**重要：**
- ⚠️ **必须提前清洗掉 `refresh_token` 末尾的 `$$` 符号**
- 每个字段用 `|` 分隔
- 不要有空行

#### 2. 辅助邮箱文件格式（可选）

如果需要使用独立的辅助邮箱文件，创建 `backup-accounts.txt`：

```
backup_email|backup_refresh_token|backup_client_id
```

**示例：**
```
backup1@outlook.com|M.C509_xxx...|9e5f94bc-xxx...
backup2@outlook.com|M.C509_xxx...|9e5f94bc-xxx...
```

### 基本使用

#### 最简单的用法

```bash
npx tsx parallel-register.ts \
  --accounts-file accounts.txt \
  --start-index 0 \
  --count 5
```

这将从第 0 行开始，注册 5 个账号。

#### 使用独立的辅助邮箱文件

```bash
npx tsx parallel-register.ts \
  --accounts-file main-accounts.txt \
  --start-index 10 \
  --backup-accounts-file backup-accounts.txt \
  --backup-start-index 5 \
  --count 3
```

**结果：**
- 主邮箱：使用 `main-accounts.txt` 的第 10、11、12 行
- 辅助邮箱：使用 `backup-accounts.txt` 的第 5、6、7 行

## 📋 命令行参数

### 必需参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `--accounts-file` | 主邮箱账号文件路径 | `accounts.txt` |
| `--start-index` | 起始行号（从 0 开始） | `0` |
| `--count` | 注册账号数量 | `5` |

### 可选参数

#### 辅助邮箱配置

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--backup-accounts-file` | 辅助邮箱文件路径 | 无（从主文件读取） |
| `--backup-start-index` | 辅助邮箱起始行号 | 与主邮箱相同 |

#### 并发和性能

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--concurrency` | 最大并发任务数 | `2` |
| `--delay-min` | 任务启动最小延迟（秒） | `5` |
| `--delay-max` | 任务启动最大延迟（秒） | `15` |
| `--max-retries` | 失败自动重试次数 | `2` |

#### 断点续传

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--resume` | 恢复上次中断的任务 | - |
| `--state-file` | 状态文件路径 | `.parallel-register-state.json` |
| `--resume-from-step` | 从指定步骤继续（1-7） | 从状态文件读取 |

#### 其他选项

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--aiclient-path` | AIClient-2-API 路径 | `/Users/pejoyll/Desktop/code/2026/AIClient-2-API` |
| `--skip-activation` | 跳过 Outlook 激活 | `false` |
| `--proxy` | HTTP 代理地址 | 无 |

## 🎯 使用场景

### 场景 1：批量注册新账号

```bash
npx tsx parallel-register.ts \
  --accounts-file accounts.txt \
  --start-index 0 \
  --count 10 \
  --concurrency 3
```

### 场景 2：使用代理

```bash
npx tsx parallel-register.ts \
  --accounts-file accounts.txt \
  --start-index 0 \
  --count 5 \
  --proxy http://127.0.0.1:7890
```

### 场景 3：遇到需要人工介入的情况

```bash
# 第一次运行
npx tsx parallel-register.ts \
  --accounts-file accounts.txt \
  --start-index 0 \
  --count 5

# 如果遇到需要人工处理的情况，程序会暂停并提示：
# 🚨 [task-2] 需要人工介入！
#    任务: example@outlook.com
#    步骤: 步骤2 - AWS Builder ID 注册
#    原因: 无法获取验证码
#    操作: 请手动完成注册后，使用以下命令继续:
#    npx tsx parallel-register.ts --resume --resume-from-step 3

# 手动完成后，运行恢复命令：
npx tsx parallel-register.ts --resume --resume-from-step 3
```

### 场景 4：程序崩溃后恢复

```bash
# 如果程序意外中断（Ctrl+C 或崩溃），直接恢复：
npx tsx parallel-register.ts --resume
```

## 🔧 注册流程

程序会自动完成以下 7 个步骤：

1. **步骤 1**：激活 Outlook 邮箱（确保能接收验证码）
2. **步骤 2**：注册 AWS Builder ID（自动填写邮箱、姓名、验证码、密码）
3. **步骤 3**：注册 AWS OIDC 客户端
4. **步骤 4**：获取设备授权码
5. **步骤 5**：浏览器自动授权
6. **步骤 6**：轮询获取 Token
7. **步骤 7**：保存凭据到 AIClient-2-API

每个步骤完成后都会保存状态，支持断点续传。

## 📊 状态文件

程序会自动创建 `.parallel-register-state.json` 文件，记录每个任务的执行状态：

```json
{
  "sessionId": "2026-01-22T10-30-45",
  "startTime": "2026-01-22T10:30:45.123Z",
  "config": {
    "accountsFile": "accounts.txt",
    "startIndex": 0,
    "count": 5,
    "concurrency": 2
  },
  "tasks": [
    {
      "taskId": "task-0",
      "email": "example@outlook.com",
      "status": "completed",
      "currentStep": 7,
      "completedSteps": [1, 2, 3, 4, 5, 6, 7],
      "ssoToken": "xxx..."
    }
  ]
}
```

## ⚠️ 注意事项

### 账号文件准备

1. **清洗 refresh_token**：
   - ❌ 错误：`M.C509_xxx...$$`
   - ✅ 正确：`M.C509_xxx...`
   - 必须删除末尾的 `$$` 符号

2. **格式要求**：
   - 使用 `|` 分隔字段
   - 不要有空行
   - 确保每行格式一致

3. **索引从 0 开始**：
   - 第一行是索引 0
   - 第二行是索引 1
   - 以此类推

### 并发建议

- 建议并发数设置为 2-3，避免触发反自动化检测
- 任务间会自动添加随机延迟（5-15 秒）

### 人工介入

以下情况可能需要人工介入：
- 验证码获取失败
- 遇到 CAPTCHA
- 邮箱需要额外验证
- 网络问题导致超时

程序会自动暂停并提示，其他任务继续执行。

## 🛠️ 故障排除

### 问题 1：refresh_token 无效

**原因**：refresh_token 末尾有 `$$` 符号

**解决**：使用文本编辑器批量替换 `$$` 为空

### 问题 2：无法获取验证码

**原因**：
- 辅助邮箱凭据未提供或无效
- 邮箱未激活

**解决**：
1. 确保提供了有效的辅助邮箱凭据
2. 或手动输入验证码后使用 `--resume` 继续

### 问题 3：浏览器授权失败

**原因**：网络问题或页面加载超时

**解决**：
1. 检查网络连接
2. 使用 `--proxy` 参数设置代理
3. 手动完成授权后使用 `--resume --resume-from-step 6` 继续

## 📝 开发说明

### 项目结构

```
.
├── parallel-register.ts        # 主程序（并行注册）
├── src/
│   └── main/
│       ├── autoRegister.ts     # AWS 注册核心逻辑
│       └── awsOidc.ts          # AWS OIDC API 模块
├── package.json
└── README.md
```

### 技术栈

- **TypeScript**：类型安全的 JavaScript
- **Playwright**：浏览器自动化
- **p-queue**：并发队列管理
- **ora**：终端进度显示
- **Microsoft Graph API**：自动获取邮箱验证码

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 🔗 相关项目

- [AIClient-2-API](https://github.com/justlovemaki/AIClient-2-API) - Kiro IDE 的 API 客户端

## ⭐ Star History

如果这个项目对你有帮助，请给个 Star ⭐️

---

**注意**：本项目仅供学习和研究使用，请遵守相关服务条款。
