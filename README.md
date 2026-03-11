# Kiro Auto Register

一个以 Bun 为主的 AWS Builder ID 批量注册工具。当前保留 Electron 界面，但主入口已经调整为批量注册 CLI。

## 环境要求

- Bun 1.3+
- Chromium 浏览器依赖

安装浏览器依赖：

```bash
bun run install-browser
```

## 安装

```bash
bun install
cp .env.example .env
```

在 `.env` 中配置：

```bash
AWS_REGISTER_PASSWORD=your-strong-password
```

说明：

- 这个密码用于 AWS Builder ID 注册流程
- 账号文件中的第二列仍然是邮箱密码，仅用于 Outlook 激活

## 账号文件格式

输入文件继续使用文本格式，每行一个账号：

```text
email|email_password|refresh_token|client_id
```

示例：

```text
alice@outlook.com|OutlookPassword123|M.C509_xxx|9e5f94bc-xxx
bob@outlook.com||M.C509_yyy|9e5f94bc-yyy
```

支持：

- 空行
- 以 `#` 开头的注释行

## CLI 用法

```bash
bun run register:batch -- \
  --input accounts.txt \
  --concurrency 3 \
  --out results.json \
  --success-out success.txt \
  --fail-out failed.txt
```

可选参数：

- `--skip-outlook-activation`
- `--proxy <url>`
- `--out <path>`
- `--success-out <path>`
- `--fail-out <path>`

执行完成后会输出：

- 结构化 JSON 结果文件
- 成功账号文本文件
- 失败账号文本文件

返回码：

- `0`：全部成功
- `1`：存在失败或输入无效行

## Electron

Electron 仍然可用：

```bash
bun run dev
```

主进程注册能力与 CLI 共用同一套注册核心和 `.env` 配置。

## 测试

```bash
bun run test
```
