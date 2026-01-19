import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Play,
  Square,
  Upload,
  Trash2,
  Copy,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Mail,
  Key,
  RefreshCw,
  AlertCircle,
  Terminal,
  Zap,
  Download
} from 'lucide-react'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Badge } from '../ui/badge'
import { useAccountsStore } from '@/store/accounts'
import { useAutoRegisterStore, type RegisterAccount } from '@/store/autoRegister'
import { v4 as uuidv4 } from 'uuid'

export function AutoRegisterPage() {
  const [inputText, setInputText] = useState('')
  const logEndRef = useRef<HTMLDivElement>(null)
  
  // 使用全局 store
  const {
    accounts,
    isRunning,
    logs,
    concurrency,
    skipOutlookActivation,
    addAccounts,
    clearAccounts,
    updateAccountStatus,
    addLog,
    clearLogs,
    setIsRunning,
    setConcurrency,
    setSkipOutlookActivation,
    requestStop,
    resetStop,
    getStats
  } = useAutoRegisterStore()
  
  const { addAccount, saveToStorage, proxyUrl, setProxy, accounts: existingAccounts } = useAccountsStore()

  // 检查邮箱是否已存在
  const isEmailExists = useCallback((email: string): boolean => {
    const emailLower = email.toLowerCase()
    return Array.from(existingAccounts.values()).some(
      acc => acc.email.toLowerCase() === emailLower
    )
  }, [existingAccounts])

  // 监听来自主进程的实时日志
  useEffect(() => {
    const unsubscribe = window.api.onAutoRegisterLog((data) => {
      addLog(`[${data.email.split('@')[0]}] ${data.message}`)
    })
    return () => unsubscribe()
  }, [addLog])

  // 自动滚动到日志底部
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const parseAccounts = (text: string): RegisterAccount[] => {
    const lines = text.trim().split('\n')
    const parsed: RegisterAccount[] = []
    
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      
      const parts = trimmed.split('|')
      if (parts.length >= 1 && parts[0].includes('@')) {
        const email = parts[0].trim()
        // 检查是否已存在
        const exists = isEmailExists(email)
        parsed.push({
          id: uuidv4(),
          email,
          password: parts[1]?.trim() || '',
          refreshToken: parts[2]?.trim() || '',
          clientId: parts[3]?.trim() || '',
          status: exists ? 'exists' : 'pending'
        })
      }
    }
    
    return parsed
  }

  const handleImport = () => {
    const parsed = parseAccounts(inputText)
    if (parsed.length === 0) {
      alert('没有找到有效的邮箱账号')
      return
    }
    const existsCount = parsed.filter(a => a.status === 'exists').length
    addAccounts(parsed)
    setInputText('')
    addLog(`导入了 ${parsed.length} 个邮箱账号${existsCount > 0 ? `，其中 ${existsCount} 个已存在` : ''}`)
  }

  const handleImportFile = async () => {
    try {
      const result = await window.api.openFile({
        filters: [{ name: '文本文件', extensions: ['txt'] }]
      })
      
      if (result && 'content' in result) {
        const parsed = parseAccounts(result.content)
        if (parsed.length > 0) {
          const existsCount = parsed.filter(a => a.status === 'exists').length
          addAccounts(parsed)
          addLog(`从文件导入了 ${parsed.length} 个邮箱账号${existsCount > 0 ? `，其中 ${existsCount} 个已存在` : ''}`)
        }
      }
    } catch (error) {
      addLog(`导入文件失败: ${error}`)
    }
  }

  const handleClear = () => {
    if (isRunning) {
      alert('请先停止注册')
      return
    }
    clearAccounts()
  }

  // 使用 SSO Token 导入账号
  const importWithSsoToken = async (account: RegisterAccount, ssoToken: string, name: string) => {
    try {
      addLog(`[${account.email}] 正在通过 SSO Token 导入账号...`)
      
      const result = await window.api.importFromSsoToken(ssoToken, 'us-east-1')
      
      if (result.success && result.data) {
        const { data } = result
        
        // 确定 idp 类型
        const idpValue = data.idp as 'Google' | 'Github' | 'BuilderId' | 'AWSIdC' | 'Internal' || 'BuilderId'
        
        // 确定订阅类型
        let subscriptionType: 'Free' | 'Pro' | 'Pro_Plus' | 'Enterprise' | 'Teams' = 'Free'
        const subType = data.subscriptionType?.toUpperCase() || ''
        if (subType.includes('PRO_PLUS') || subType.includes('PRO+')) {
          subscriptionType = 'Pro_Plus'
        } else if (subType.includes('PRO')) {
          subscriptionType = 'Pro'
        } else if (subType.includes('ENTERPRISE')) {
          subscriptionType = 'Enterprise'
        } else if (subType.includes('TEAMS')) {
          subscriptionType = 'Teams'
        }
        
        addAccount({
          email: data.email || account.email,
          nickname: name,
          idp: idpValue,
          credentials: {
            accessToken: data.accessToken,
            csrfToken: '',
            refreshToken: data.refreshToken,
            clientId: data.clientId,
            clientSecret: data.clientSecret,
            region: data.region || 'us-east-1',
            authMethod: 'IdC',
            expiresAt: Date.now() + (data.expiresIn || 3600) * 1000
          },
          subscription: { 
            type: subscriptionType,
            title: data.subscriptionTitle
          },
          usage: data.usage ? {
            current: data.usage.current,
            limit: data.usage.limit,
            percentUsed: data.usage.limit > 0 ? (data.usage.current / data.usage.limit) * 100 : 0,
            lastUpdated: Date.now()
          } : { current: 0, limit: 50, percentUsed: 0, lastUpdated: Date.now() },
          tags: [],
          status: 'active',
          lastUsedAt: Date.now()
        })
        
        saveToStorage()
        addLog(`[${account.email}] ✓ 已成功添加到账号管理器`)
        return true
      } else {
        addLog(`[${account.email}] ✗ SSO Token 导入失败: ${result.error?.message || '未知错误'}`)
        return false
      }
    } catch (error) {
      addLog(`[${account.email}] ✗ 导入出错: ${error}`)
      return false
    }
  }

  // 单个账号注册任务（使用全局 store 的 shouldStop）
  const registerSingleAccount = async (account: RegisterAccount): Promise<void> => {
    // 检查全局停止标志
    if (useAutoRegisterStore.getState().shouldStop) return
    if (account.status === 'success' || account.status === 'exists') return
    
    try {
      updateAccountStatus(account.id, { status: 'registering' })
      addLog(`[${account.email}] 开始注册...`)
      
      // 调用主进程的自动注册功能
      const result = await window.api.autoRegisterAWS({
        email: account.email,
        emailPassword: account.password,
        refreshToken: account.refreshToken,
        clientId: account.clientId,
        skipOutlookActivation: useAutoRegisterStore.getState().skipOutlookActivation,
        proxyUrl: proxyUrl || undefined
      })
      
      if (result.success && result.ssoToken) {
        updateAccountStatus(account.id, { 
          status: 'success', 
          ssoToken: result.ssoToken,
          awsName: result.name
        })
        addLog(`[${account.email}] ✓ 注册成功!`)
        
        // 使用 SSO Token 导入账号
        await importWithSsoToken(account, result.ssoToken, result.name || account.email.split('@')[0])
        
      } else {
        updateAccountStatus(account.id, { 
          status: 'failed', 
          error: result.error || '注册失败'
        })
        addLog(`[${account.email}] ✗ 注册失败: ${result.error}`)
      }
      
    } catch (error) {
      updateAccountStatus(account.id, { 
        status: 'failed', 
        error: String(error)
      })
      addLog(`[${account.email}] ✗ 错误: ${error}`)
    }
  }

  const startRegistration = async () => {
    // 过滤掉已存在和已成功的账号
    const pendingAccounts = accounts.filter(a => a.status === 'pending' || a.status === 'failed')
    
    if (pendingAccounts.length === 0) {
      alert('没有需要注册的账号（已存在或已成功的账号会被跳过）')
      return
    }
    
    setIsRunning(true)
    resetStop()
    addLog(`========== 开始批量注册 (并发数: ${concurrency}) ==========`)
    addLog(`待注册: ${pendingAccounts.length} 个，已跳过: ${accounts.length - pendingAccounts.length} 个`)
    
    // 并发执行注册任务
    const runConcurrent = async () => {
      const queue = [...pendingAccounts]
      const running: Promise<void>[] = []
      
      while (queue.length > 0 || running.length > 0) {
        // 检查全局停止标志
        if (useAutoRegisterStore.getState().shouldStop) {
          addLog('用户停止了注册')
          break
        }
        
        // 填充到并发数
        while (queue.length > 0 && running.length < concurrency) {
          const account = queue.shift()!
          const task = registerSingleAccount(account).then(() => {
            // 任务完成后从 running 中移除
            const index = running.indexOf(task)
            if (index > -1) running.splice(index, 1)
          })
          running.push(task)
        }
        
        // 等待任意一个任务完成
        if (running.length > 0) {
          await Promise.race(running)
        }
      }
    }
    
    await runConcurrent()
    
    setIsRunning(false)
    const stats = getStats()
    addLog(`========== 注册完成: 成功 ${stats.success}，失败 ${stats.failed} ==========`)
  }

  const stopRegistration = () => {
    requestStop()
    addLog('正在停止注册...')
  }

  const copyToken = (token: string) => {
    navigator.clipboard.writeText(token)
  }

  const getStatusBadge = (status: RegisterAccount['status']) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />等待</Badge>
      case 'exists':
        return <Badge variant="outline" className="text-orange-500 border-orange-500"><AlertCircle className="w-3 h-3 mr-1" />已存在</Badge>
      case 'activating':
        return <Badge variant="default" className="bg-purple-500"><Zap className="w-3 h-3 mr-1 animate-pulse" />激活中</Badge>
      case 'registering':
        return <Badge variant="default"><Loader2 className="w-3 h-3 mr-1 animate-spin" />注册中</Badge>
      case 'getting_code':
        return <Badge variant="default"><Mail className="w-3 h-3 mr-1" />获取验证码</Badge>
      case 'success':
        return <Badge variant="default" className="bg-green-500"><CheckCircle className="w-3 h-3 mr-1" />成功</Badge>
      case 'failed':
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />失败</Badge>
    }
  }

  // 单个 Outlook 激活任务
  const activateSingleOutlook = async (account: RegisterAccount): Promise<void> => {
    if (useAutoRegisterStore.getState().shouldStop) return
    
    try {
      updateAccountStatus(account.id, { status: 'activating' })
      addLog(`[${account.email}] 开始激活 Outlook...`)
      
      const result = await window.api.activateOutlook({
        email: account.email,
        emailPassword: account.password
      })
      
      if (result.success) {
        updateAccountStatus(account.id, { status: 'pending' })
        addLog(`[${account.email}] ✓ Outlook 激活成功!`)
      } else {
        addLog(`[${account.email}] ⚠ Outlook 激活可能未完成: ${result.error}`)
      }
      
    } catch (error) {
      addLog(`[${account.email}] ✗ 激活错误: ${error}`)
    }
  }

  // 仅激活 Outlook 邮箱（支持并发）
  const activateOutlookOnly = async () => {
    const outlookAccounts = accounts.filter(a => 
      a.email.toLowerCase().includes('outlook') && 
      a.password && 
      a.status !== 'exists' && 
      a.status !== 'success'
    )
    
    if (outlookAccounts.length === 0) {
      alert('没有找到需要激活的 Outlook 邮箱账号')
      return
    }
    
    setIsRunning(true)
    resetStop()
    addLog(`========== 开始批量激活 Outlook (并发数: ${concurrency}) ==========`)
    
    // 并发执行激活任务
    const runConcurrent = async () => {
      const queue = [...outlookAccounts]
      const running: Promise<void>[] = []
      
      while (queue.length > 0 || running.length > 0) {
        if (useAutoRegisterStore.getState().shouldStop) {
          addLog('用户停止了激活')
          break
        }
        
        while (queue.length > 0 && running.length < concurrency) {
          const account = queue.shift()!
          const task = activateSingleOutlook(account).then(() => {
            const index = running.indexOf(task)
            if (index > -1) running.splice(index, 1)
          })
          running.push(task)
        }
        
        if (running.length > 0) {
          await Promise.race(running)
        }
      }
    }
    
    await runConcurrent()
    
    setIsRunning(false)
    addLog('========== Outlook 激活流程完成 ==========')
  }

  const stats = getStats()

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">AWS 自动注册</h1>
          <p className="text-muted-foreground">
            自动注册 AWS Builder ID 并添加到账号管理器
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <input
            type="text"
            placeholder="代理地址 (如 http://127.0.0.1:7890)"
            value={proxyUrl}
            onChange={(e) => setProxy(true, e.target.value)}
            disabled={isRunning}
            className="px-3 py-1.5 border rounded-lg bg-background text-sm w-56"
          />
          <div className="flex items-center gap-1">
            <span className="text-sm text-muted-foreground">并发:</span>
            <select
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              disabled={isRunning}
              className="px-2 py-1.5 border rounded-lg bg-background text-sm w-16"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={skipOutlookActivation}
              onChange={(e) => setSkipOutlookActivation(e.target.checked)}
              disabled={isRunning}
              className="rounded"
            />
            跳过激活
          </label>
          <Button variant="outline" onClick={activateOutlookOnly} disabled={isRunning || accounts.length === 0}>
            <Zap className="w-4 h-4 mr-2" />
            激活 Outlook
          </Button>
          {isRunning ? (
            <Button variant="destructive" onClick={stopRegistration}>
              <Square className="w-4 h-4 mr-2" />
              停止
            </Button>
          ) : (
            <Button onClick={startRegistration} disabled={accounts.length === 0}>
              <Play className="w-4 h-4 mr-2" />
              开始注册
            </Button>
          )}
        </div>
      </div>

      {/* 统计信息 */}
      {accounts.length > 0 && (
        <div className="grid grid-cols-6 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{stats.total}</div>
              <div className="text-sm text-muted-foreground">总数</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-yellow-500">{stats.pending}</div>
              <div className="text-sm text-muted-foreground">等待中</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-blue-500">{stats.running}</div>
              <div className="text-sm text-muted-foreground">进行中</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-green-500">{stats.success}</div>
              <div className="text-sm text-muted-foreground">成功</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-red-500">{stats.failed}</div>
              <div className="text-sm text-muted-foreground">失败</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-orange-500">{stats.exists}</div>
              <div className="text-sm text-muted-foreground">已存在</div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* 左侧：输入区域 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5" />
              邮箱账号
            </CardTitle>
            <CardDescription>
              格式: 邮箱|密码|refresh_token|client_id (每行一个)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <textarea
              className="w-full h-32 p-3 border rounded-lg bg-background resize-none font-mono text-sm"
              placeholder="example@outlook.com|password|M.C509_xxx...|9e5f94bc-xxx..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={isRunning}
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleImport} disabled={isRunning || !inputText}>
                <RefreshCw className="w-4 h-4 mr-2" />
                解析添加
              </Button>
              <Button variant="outline" onClick={handleImportFile} disabled={isRunning}>
                <Upload className="w-4 h-4 mr-2" />
                从文件导入
              </Button>
              <Button variant="outline" onClick={handleClear} disabled={isRunning}>
                <Trash2 className="w-4 h-4 mr-2" />
                清空
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 右侧：日志 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="flex items-center gap-2">
              <Terminal className="w-5 h-5" />
              运行日志
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={clearLogs}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <div className="h-48 overflow-auto bg-black/90 rounded-lg p-3 font-mono text-xs space-y-0.5">
              {logs.length === 0 ? (
                <div className="text-gray-500">暂无日志</div>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className={
                    log.includes('✓') ? 'text-green-400' : 
                    log.includes('✗') || log.includes('错误') || log.includes('失败') ? 'text-red-400' : 
                    log.includes('=====') ? 'text-yellow-400' :
                    log.includes('[stderr]') ? 'text-orange-400' :
                    'text-gray-300'
                  }>
                    {log}
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 账号列表 */}
      {accounts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="w-5 h-5" />
              注册列表
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2 text-left text-sm font-medium">序号</th>
                    <th className="px-4 py-2 text-left text-sm font-medium">邮箱</th>
                    <th className="px-4 py-2 text-left text-sm font-medium">姓名</th>
                    <th className="px-4 py-2 text-left text-sm font-medium">状态</th>
                    <th className="px-4 py-2 text-left text-sm font-medium">Token</th>
                    <th className="px-4 py-2 text-left text-sm font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account, index) => (
                    <tr key={account.id} className="border-t">
                      <td className="px-4 py-2 text-sm">{index + 1}</td>
                      <td className="px-4 py-2 text-sm font-mono">{account.email}</td>
                      <td className="px-4 py-2 text-sm">{account.awsName || '-'}</td>
                      <td className="px-4 py-2">{getStatusBadge(account.status)}</td>
                      <td className="px-4 py-2 text-sm font-mono">
                        {account.ssoToken ? account.ssoToken.substring(0, 20) + '...' : '-'}
                      </td>
                      <td className="px-4 py-2">
                        {account.ssoToken && (
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => copyToken(account.ssoToken!)}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 使用说明 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            使用说明
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>1. 输入邮箱账号信息，格式: <code className="bg-muted px-1 rounded">邮箱|密码|refresh_token|client_id</code></p>
          <p className="pl-4 text-xs">
            - 密码: 邮箱密码（用于 Outlook 激活）<br/>
            - refresh_token: OAuth2 刷新令牌 (M.C509_xxx...)<br/>
            - client_id: Graph API 客户端ID (9e5f94bc-xxx...)
          </p>
          <p>2. <strong>账号重复检测</strong>: 导入时自动检测已存在的账号，显示"已存在"状态并跳过注册</p>
          <p>3. <strong>批量并发</strong>: 支持同时打开多个浏览器窗口进行注册，最多 10 个并发</p>
          <p>4. <strong>Outlook 激活</strong>: 新注册的 Outlook 邮箱需要先激活才能正常接收验证码</p>
          <p className="pl-4 text-xs">
            - 点击"激活 Outlook"可以批量激活邮箱<br/>
            - 勾选"跳过激活"可以跳过激活步骤（适合已激活的邮箱）
          </p>
          <p>5. <strong>代理设置</strong>: 输入代理地址用于 AWS 注册（Outlook 激活和获取验证码不使用代理）</p>
          <p>6. 点击"开始注册"，程序会并发完成 AWS Builder ID 注册</p>
          <p className="text-yellow-500 flex items-center gap-1">
            <AlertCircle className="w-4 h-4" />
            首次使用需要安装浏览器: 在终端运行 <code className="bg-muted px-1 rounded">npx playwright install chromium</code>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
