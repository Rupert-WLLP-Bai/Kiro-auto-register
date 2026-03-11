# 开发文档

本文档记录项目的技术实现细节、架构设计和开发过程中的问题。

## 项目关系

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

## 完整工作流程

1. **本项目** → 批量注册 AWS Builder ID 账号
2. **本项目** → 保存凭据到 AIClient-2-API 的 `configs/kiro/` 目录
3. **AIClient-2-API** → 读取凭据并提供 API 服务

## 与原项目的主要区别

| 特性 | 原项目 | 本增强版 |
|------|--------|----------|
| **并发能力** | ❌ 单线程顺序执行 | ✅ 可配置并发数（推荐 2-3） |
| **辅助邮箱** | ❌ 不支持 | ✅ 独立索引 + 自定义映射 |
| **断点续传** | ❌ 不支持 | ✅ 完整状态管理 |
| **配置预览** | ❌ 不支持 | ✅ Dry-Run 模式 |
| **人工介入** | ❌ 不支持 | ✅ 自动暂停和恢复 |
| **进度监控** | ❌ 基础日志 | ✅ 实时进度显示 |

## 技术实现

### 核心模块

**1. 并行注册引擎** (`parallel-register.ts` - 1,219 行)
- 使用 p-queue 管理并发任务队列
- 支持 2-3 个账号同时注册
- 完整的状态持久化和恢复机制
- 实时进度显示和错误处理

**2. AWS OIDC 客户端** (`src/main/awsOidc.ts` - 473 行)
- AWS OIDC 客户端注册
- 设备授权流程
- Token 轮询和刷新
- 与 AIClient-2-API 的数据对接

**3. 自动注册核心** (`src/main/autoRegister.ts` - 增强版)
- Outlook 邮箱激活流程
- AWS Builder ID 注册流程
- 支持辅助邮箱验证码获取
- 人类行为模拟（鼠标移动、随机延迟、逐字符输入）
- 验证码和验证挑战检测
- 人工介入和超时处理机制

### 技术栈

- **TypeScript**: 类型安全的开发体验
- **Playwright**: 浏览器自动化框架
- **p-queue**: 并发队列管理
- **ora**: 终端进度显示
- **Microsoft Graph API**: 自动获取邮箱验证码

### 代码统计

- **新增代码**: ~2,400 行
- **核心文件**: 3 个主要模块
- **新增依赖**: p-queue, ora
- **增强功能**: 人类行为模拟、验证码检测、人工介入

## 项目结构

```
.
├── parallel-register.ts        # 并行注册主程序（1,219 行）
├── src/main/
│   ├── autoRegister.ts         # AWS 注册核心逻辑（增强版，1,696 行）
│   └── awsOidc.ts              # AWS OIDC API 模块（473 行）
├── package.json
├── README.md                   # 用户使用文档
└── DEVELOPMENT.md              # 本文档（开发文档）
```

## 状态管理

### 状态文件格式

程序会自动创建 `.parallel-register-state.json` 文件：

```json
{
  "sessionId": "2026-01-22T10-30-45",
  "startTime": "2026-01-22T10:30:45.123Z",
  "config": {
    "accountsFile": "accounts.txt",
    "startIndex": 0,
    "count": 5,
    "concurrency": 2,
    "backupStartIndex": 50
  },
  "tasks": [
    {
      "taskId": "task-0",
      "email": "example@outlook.com",
      "status": "completed",
      "currentStep": 7,
      "completedSteps": [1, 2, 3, 4, 5, 6, 7],
      "ssoToken": "xxx...",
      "clientId": "xxx...",
      "clientSecret": "xxx..."
    }
  ]
}
```

### 任务状态

- `pending`: 等待执行
- `running`: 正在执行
- `completed`: 已完成
- `failed`: 失败
- `manual_intervention`: 需要人工介入

### 步骤追踪

每个任务包含 7 个步骤：

1. 激活 Outlook 邮箱
2. 注册 AWS Builder ID
3. 注册 AWS OIDC 客户端
4. 获取设备授权码
5. 浏览器自动授权
6. 轮询获取 Token
7. 保存凭据到 AIClient-2-API

## 人类行为模拟

### 实现细节

**1. 鼠标移动模拟**
- 使用贝塞尔曲线生成自然的鼠标轨迹
- 随机点击位置（元素的 30-70% 区域）
- 避免总是点击元素中心

**2. 输入模拟**
- 逐字符输入，每个字符延迟 50-150ms
- 10% 概率出现较长停顿（200-500ms）模拟思考
- 输入前后添加随机延迟

**3. 延迟随机化**
- 所有固定延迟都被随机化（30+ 处）
- 1 秒延迟 → 800-1200ms
- 2 秒延迟 → 1800-2200ms
- 3 秒延迟 → 2500-3500ms

**4. 表单填充**
- 移除所有 `fill()` 瞬间填充
- 使用 `humanFillElement()` 函数：
  - 鼠标移动到随机位置
  - 点击输入框
  - 清空内容
  - 逐字符输入

### 关键函数

```typescript
// 贝塞尔曲线鼠标移动
function bezierCurve(start, end, steps)

// 人类化鼠标移动
async function humanMouseMove(page, targetX, targetY)

// 人类化点击
async function humanClick(page, selector, description)

// 人类化输入
async function humanType(page, selector, text, description)

// 人类化表单填充
async function humanFillElement(page, element, value, description)
```

## 验证码和人工介入

### 验证码检测

**检测方法：**
1. 检测常见验证码元素（iframe、class、id）
2. 检测 URL 关键词（captcha、challenge、verify）
3. 检测页面文本内容

**触发条件：**
- 检测到验证码元素
- 检测到新窗口弹出
- SSO Token 获取超时（2 分钟）

### 人工介入机制

**流程：**
1. 检测到需要人工介入
2. 暂停自动化，保持浏览器打开
3. 每 3 秒检测一次是否完成
4. 显示剩余等待时间（最多 10 分钟）
5. 完成后自动继续执行

**适用场景：**
- Outlook 激活超时
- AWS 注册超时
- 验证码或验证挑战
- 任何需要手动操作的情况

## 已知问题

### 1. AIClient-2-API 中的 Claude Haiku 问题

**问题描述：**
在使用 AIClient-2-API 时，调用 Claude Haiku 模型会出现问题。

**解决方案：**
将所有请求路由到 Sonnet 模型。可以在 AIClient-2-API 项目中进行 patch 修改。

### 2. 并发限制

**问题描述：**
并发数过高（>3）可能触发反自动化检测。

**解决方案：**
- 推荐并发数：2-3
- 任务启动延迟：5-15 秒
- 使用随机延迟避免固定模式

### 3. 辅助邮箱必需

**问题描述：**
为了提高成功率，必须配置辅助邮箱用于接收验证码。

**解决方案：**
- 使用 `--backup-start-index` 或 `--backup-mapping-file`
- 确保辅助邮箱的 refresh_token 有效
- 提前激活辅助邮箱

## 性能优化

### 并发策略

- **单线程**: 2-3 分钟/账号
- **并发 2**: 3-4 分钟/2 账号（效率提升 ~50%）
- **并发 3**: 4-5 分钟/3 账号（效率提升 ~60%）

### 优化建议

1. **合理设置并发数**: 2-3 为最佳
2. **使用代理**: 避免 IP 限制
3. **分批执行**: 大批量任务分多次执行
4. **监控状态**: 及时处理失败任务

## 开发历史

### 主要版本

- **v1.0**: 基础并行注册功能
- **v1.1**: 新增辅助邮箱独立索引
- **v1.2**: 新增自定义映射功能
- **v1.3**: 新增人工介入机制
- **v1.4**: 增强人类行为模拟

### 最近更新

**2026-01-22**: 增强人类行为模拟
- 新增 `humanFillElement()` 函数
- 优化鼠标移动轨迹（贝塞尔曲线）
- 随机化所有固定延迟（30+ 处）
- 新增验证码和验证挑战检测
- 增强 SSO Token 获取流程

## 贡献指南

### 开发环境

```bash
# 克隆仓库
git clone https://github.com/Rupert-WLLP-Bai/Kiro-auto-register.git
cd Kiro-auto-register

# 安装依赖
npm install

# 开发模式运行
npx tsx parallel-register.ts --help
```

### 代码规范

- 使用 TypeScript 严格模式
- 遵循 ESLint 规则
- 添加详细的注释
- 保持函数单一职责

### 提交规范

```
feat: 新功能
fix: 修复 bug
docs: 文档更新
refactor: 代码重构
perf: 性能优化
test: 测试相关
chore: 构建/工具相关
```

## 许可证

MIT License

---

**维护者**: Rupert-WLLP-Bai
**最后更新**: 2026-01-22
