# Kiro Auto Register - 并行注册增强版

> 基于 [Pluviobyte/Kiro-auto-register](https://github.com/Pluviobyte/Kiro-auto-register) 的并行注册增强版本，配合 [AIClient-2-API](https://github.com/justlovemaki/AIClient-2-API) 实现完整的 AWS Builder ID 批量注册和使用流程

## 📖 项目简介

本项目是 [Pluviobyte/Kiro-auto-register](https://github.com/Pluviobyte/Kiro-auto-register) 的功能增强版本，**专注于批量并行注册场景**。

### 项目关系

```
Pluviobyte/Kiro-auto-register (原始项目)
    ↓ Fork + 增强
本项目 (并行注册增强版)
    ↓ 保存凭据到
AIClient-2-API (配套使用)
```

- **原始项目**: [Pluviobyte/Kiro-auto-register](https://github.com/Pluviobyte/Kiro-auto-register) - 基础的 AWS Builder ID 注册工具
- **本项目**: 增强版本，新增并行注册、断点续传、灵活的辅助邮箱配置等功能
- **配套项目**: [AIClient-2-API](https://github.com/justlovemaki/AIClient-2-API) - 使用注册的账号提供 API 服务

### 完整工作流程

1. **本项目** → 批量注册 AWS Builder ID 账号
2. **本项目** → 保存凭据到 AIClient-2-API 的 `configs/kiro/` 目录
3. **AIClient-2-API** → 读取凭据并提供 API 服务

### 与原项目的主要区别

| 特性 | 原项目 | 本增强版 |
|------|--------|----------|
| **并发能力** | ❌ 单线程顺序执行 | ✅ 可配置并发数（推荐 2-3） |
| **辅助邮箱** | ❌ 不支持 | ✅ 独立索引 + 自定义映射 |
| **断点续传** | ❌ 不支持 | ✅ 完整状态管理 |
| **配置预览** | ❌ 不支持 | ✅ Dry-Run 模式 |
| **人工介入** | ❌ 不支持 | ✅ 自动暂停和恢复 |
| **进度监控** | ❌ 基础日志 | ✅ 实时进度显示 |

### 新增功能

**核心能力：**
- 🚀 **并行注册系统**：使用 p-queue 管理并发任务，支持 2-3 个账号同时注册
- 📊 **完整状态管理**：每个任务 7 个步骤独立追踪，支持任意步骤恢复
- 🔄 **断点续传**：程序崩溃或人工介入后可无缝恢复
- 🎯 **灵活的辅助邮箱配置**：
  - 独立索引模式：主邮箱索引 30-32，辅助邮箱索引 5-7
  - 自定义映射模式：通过 mapping.txt 精确指定（如 30→5, 31→10, 32→15）
- 🔍 **Dry-Run 模式**：预览配置和账号对应关系，避免配置错误
- ⚠️ **强制辅助邮箱**：提升安全性，防止验证码获取失败

**技术实现：**
- 新增 `parallel-register.ts`（1,219 行）：完整的并行注册引擎
- 新增 `src/main/awsOidc.ts`（473 行）：AWS OIDC 客户端注册模块
- 增强 `src/main/autoRegister.ts`：支持辅助邮箱验证码获取
- 与 AIClient-2-API 打通数据链路：自动保存凭据到指定目录

## 🚀 快速开始

### 前置要求

1. **Node.js**（推荐 v18+）
2. **AIClient-2-API**（用于使用注册的账号）：
   ```bash
   git clone https://github.com/justlovemaki/AIClient-2-API.git
   cd AIClient-2-API
   # 按照其 README 完成安装
   ```

3. **安装本项目依赖**：
   ```bash
   git clone https://github.com/Rupert-WLLP-Bai/Kiro-auto-register.git
   cd Kiro-auto-register
   npm install
   ```

### 准备账号文件

创建 `accounts.txt` 文件，每行一个账号，格式：`email|password|refresh_token|client_id`

**示例：**
```
example1@outlook.com|YourPassword123!|M.C509_xxx...|9e5f94bc-xxx...
example2@outlook.com|YourPassword123!|M.C509_xxx...|9e5f94bc-xxx...
```

**重要：** ⚠️ 必须提前清洗掉 `refresh_token` 末尾的 `$$` 符号

### 基本使用

#### 1. 预览配置（推荐先运行）

```bash
npx tsx parallel-register.ts \
  --accounts-file accounts.txt \
  --start-index 30 \
  --backup-start-index 5 \
  --count 3 \
  --dry-run
```

#### 2. 独立索引模式（同一文件）

```bash
npx tsx parallel-register.ts \
  --accounts-file accounts.txt \
  --start-index 30 \
  --backup-start-index 5 \
  --count 3
```

**结果：**
- 主邮箱：第 30、31、32 行
- 辅助邮箱：第 5、6、7 行

#### 3. 自定义映射模式

创建 `mapping.txt`：
```
30:5
31:10
32:15
```

运行：
```bash
npx tsx parallel-register.ts \
  --accounts-file accounts.txt \
  --backup-mapping-file mapping.txt \
  --count 3
```

**结果：**
- 账号 30 → 辅助账号 5
- 账号 31 → 辅助账号 10
- 账号 32 → 辅助账号 15

## 📋 命令行参数

### 必需参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `--accounts-file` | 账号文件路径 | `accounts.txt` |
| `--start-index` | 主邮箱起始行号（从 0 开始） | `30` |
| `--count` | 注册账号数量 | `5` |
| `--backup-start-index` 或 `--backup-mapping-file` | 辅助邮箱配置（二选一） | `5` 或 `mapping.txt` |

### 可选参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--concurrency` | 并发任务数 | `2` |
| `--delay-min` | 任务启动最小延迟（秒） | `5` |
| `--delay-max` | 任务启动最大延迟（秒） | `15` |
| `--max-retries` | 失败重试次数 | `2` |
| `--backup-accounts-file` | 独立辅助邮箱文件 | 无 |
| `--dry-run` | 预览模式（不执行注册） | `false` |
| `--resume` | 恢复中断的任务 | - |
| `--aiclient-path` | AIClient-2-API 路径 | 自动检测 |

## 🎯 高级用法

### 场景 1：大批量注册（推荐）

```bash
# 先预览配置
npx tsx parallel-register.ts \
  --accounts-file accounts.txt \
  --start-index 0 \
  --backup-start-index 50 \
  --count 20 \
  --dry-run

# 确认无误后执行
npx tsx parallel-register.ts \
  --accounts-file accounts.txt \
  --start-index 0 \
  --backup-start-index 50 \
  --count 20 \
  --concurrency 3
```

### 场景 2：使用代理

```bash
npx tsx parallel-register.ts \
  --accounts-file accounts.txt \
  --start-index 0 \
  --backup-start-index 50 \
  --count 5 \
  --proxy http://127.0.0.1:7890
```

### 场景 3：断点续传

```bash
# 程序中断后直接恢复
npx tsx parallel-register.ts --resume

# 或从指定步骤恢复
npx tsx parallel-register.ts --resume --resume-from-step 3
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

1. **辅助邮箱必需**：为了安全性，必须配置辅助邮箱（用于接收验证码）
2. **清洗 refresh_token**：必须删除末尾的 `$$` 符号
3. **并发建议**：推荐设置为 2-3，避免触发反自动化检测
4. **索引从 0 开始**：第一行是索引 0，第二行是索引 1
5. **先用 Dry-Run**：建议先用 `--dry-run` 预览配置，确认无误后再执行

## 🛠️ 故障排除

### 问题 1：提示"必须提供辅助邮箱配置"

**解决**：添加 `--backup-start-index` 或 `--backup-mapping-file` 参数

```bash
# 正确示例
npx tsx parallel-register.ts \
  --accounts-file accounts.txt \
  --start-index 0 \
  --backup-start-index 50 \
  --count 5
```

### 问题 2：refresh_token 无效

**原因**：refresh_token 末尾有 `$$` 符号

**解决**：使用文本编辑器批量替换 `$$` 为空

### 问题 3：无法获取验证码

**原因**：辅助邮箱凭据无效或邮箱未激活

**解决**：
1. 确保辅助邮箱的 refresh_token 和 client_id 正确
2. 或手动输入验证码后使用 `--resume` 继续

## 📊 性能数据

基于实际测试：
- **单账号注册时间**：约 2-3 分钟
- **并发 2 个账号**：总时间约 3-4 分钟（效率提升 ~50%）
- **并发 3 个账号**：总时间约 4-5 分钟（效率提升 ~60%）
- **推荐配置**：并发 2-3，延迟 5-15 秒

## 📝 开发说明

### 项目结构

```
.
├── parallel-register.ts        # 并行注册主程序（1,219 行）
├── src/main/
│   ├── autoRegister.ts         # AWS 注册核心逻辑（增强版）
│   └── awsOidc.ts              # AWS OIDC API 模块（新增）
├── package.json
└── README.md
```

### 技术栈

- **TypeScript**：类型安全
- **Playwright**：浏览器自动化
- **p-queue**：并发队列管理
- **ora**：终端进度显示
- **Microsoft Graph API**：自动获取验证码

### 代码统计

- 新增代码：~2,400 行
- 核心文件：3 个
- 依赖包：新增 2 个（p-queue, ora）

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 🔗 相关项目

- [Pluviobyte/Kiro-auto-register](https://github.com/Pluviobyte/Kiro-auto-register) - 原始项目
- [AIClient-2-API](https://github.com/justlovemaki/AIClient-2-API) - 配套的 API 服务项目

## ⚠️ 已知问题

### AIClient-2-API 中的 Claude Haiku 问题

在使用 AIClient-2-API 时发现，调用 Claude Haiku 模型会出现问题。**解决方案**：将所有请求路由到 Sonnet 模型。

如果遇到此问题，可以自行在 AIClient-2-API 项目中进行 patch 修改。

---

**注意**：本项目仅供学习和研究使用，请遵守相关服务条款。
