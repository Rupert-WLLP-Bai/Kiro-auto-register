# Kiro Auto Register - 并行注册增强版

> 基于 [Pluviobyte/Kiro-auto-register](https://github.com/Pluviobyte/Kiro-auto-register) 的并行注册增强版本

## 📖 项目简介

本项目是 AWS Builder ID 批量注册工具，支持并行注册、断点续传、灵活的辅助邮箱配置等功能。

### 主要特性

- 🚀 **并行注册**：支持 2-3 个账号同时注册，大幅提升效率
- 🔄 **断点续传**：程序中断后可无缝恢复，不会丢失进度
- 🎯 **灵活配置**：支持独立索引和自定义映射两种辅助邮箱配置方式
- 🔍 **预览模式**：Dry-Run 模式预览配置，避免配置错误
- 📊 **状态管理**：完整的任务状态追踪和进度显示

## 🚀 快速开始

### 前置要求

1. **Node.js**（推荐 v18+）
2. 安装依赖：
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

#### 2. 独立索引模式

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
| `--proxy` | 代理地址 | 无 |

## 🎯 使用场景

### 场景 1：大批量注册

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
```

## 🔧 注册流程

程序会自动完成以下步骤：

1. 激活 Outlook 邮箱
2. 注册 AWS Builder ID
3. 注册 AWS OIDC 客户端
4. 获取设备授权码
5. 浏览器自动授权
6. 轮询获取 Token
7. 保存凭据

每个步骤完成后都会保存状态，支持断点续传。

## ⚠️ 注意事项

1. **辅助邮箱必需**：必须配置辅助邮箱用于接收验证码
2. **清洗 refresh_token**：必须删除末尾的 `$$` 符号
3. **并发建议**：推荐设置为 2-3，避免触发反自动化检测
4. **索引从 0 开始**：第一行是索引 0，第二行是索引 1
5. **先用 Dry-Run**：建议先用 `--dry-run` 预览配置

## 🛠️ 故障排除

### 问题 1：提示"必须提供辅助邮箱配置"

**解决**：添加 `--backup-start-index` 或 `--backup-mapping-file` 参数

```bash
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

**解决**：
1. 确保辅助邮箱的 refresh_token 和 client_id 正确
2. 或手动输入验证码后使用 `--resume` 继续

## 📊 性能参考

- **单账号注册时间**：约 2-3 分钟
- **并发 2 个账号**：总时间约 3-4 分钟
- **并发 3 个账号**：总时间约 4-5 分钟
- **推荐配置**：并发 2-3，延迟 5-15 秒

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 🔗 相关项目

- [Pluviobyte/Kiro-auto-register](https://github.com/Pluviobyte/Kiro-auto-register) - 原始项目
- [AIClient-2-API](https://github.com/justlovemaki/AIClient-2-API) - 配套的 API 服务项目

---

**注意**：本项目仅供学习和研究使用，请遵守相关服务条款。
