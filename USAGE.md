# 批量注册使用说明

## 快速使用

只需要告诉我两个信息：
1. **注册第几个号**（主账号）
2. **辅助邮箱是第几个号**（backup账号）

## 固定配置

- **AIClient 路径**: `/Users/pejoyll/Desktop/code/2026/AIClient-2-API`
- **代理**: 不使用代理
- **账号数据**: `ids_cleaned.txt`

## 账号数据格式

```
邮箱|密码|refresh_token|client_id
```

## 使用示例

### 示例 1: 注册第27个号，辅助邮箱用第3个号

```bash
npx tsx batch-register.ts \
  --email CarlaSanstrom68@outlook.com \
  --password qxdu87823558 \
  --refresh-token "M.C531_BAY.0.U.-CpBO*JsWpAp..." \
  --client-id 9e5f94bc-e8a4-4e73-b8be-63364c29d753 \
  --aiclient-path /Users/pejoyll/Desktop/code/2026/AIClient-2-API \
  --backup-email LailaArnau1115@outlook.com \
  --backup-refresh-token "M.C545_BAY.0.U.-CouYI*l233R..." \
  --backup-client-id 9e5f94bc-e8a4-4e73-b8be-63364c29d753
```

## 脚本功能

1. ✅ 激活 Outlook 邮箱
2. ✅ 注册 AWS Builder ID
3. ✅ 自动浏览器授权
4. ✅ 获取 AWS OIDC Token
5. ✅ 保存到 AIClient-2-API 的 `configs/kiro` 目录

## 注意事项

- 账号索引从 0 开始计数（第1个号 = 索引0，第27个号 = 索引27）
- 所有账号的 client_id 都是相同的：`9e5f94bc-e8a4-4e73-b8be-63364c29d753`
- 密码固定为：`admin123456aA!`（在代码中硬编码）
