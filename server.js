import express from 'express'
import fetch from 'node-fetch'
import fs from 'fs'

const app = express()
app.use(express.json())

// ── 配置文件路径 ──────────────────────────────────────────
// 对应 compose volumes 挂载的目录：./config:/app/config
const CONFIG_PATH = './config/config.json'

// ── 日志工具 ──────────────────────────────────────────────
// 统一带时间戳的日志格式，方便 docker logs 排查
function log(level, ...args) {
  const ts = new Date().toISOString()
  console[level](`[${ts}]`, ...args)
}

// ── 配置加载 ──────────────────────────────────────────────
// 每次请求重新读取，修改 config.json 后无需重启容器
// 如果文件不存在或格式错误，进程直接退出并打印原因
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
  } catch (e) {
    log('error', 'Failed to load config.json:', e.message)
    process.exit(1)
  }
}

// ── 消息提取 ──────────────────────────────────────────────
// 兼容不同 app 的 payload 结构
// 优先级：title > content > desc > body > message > text
// 都没有则将整个 body JSON 序列化兜底，确保永远有内容可发
function buildMessage(body) {
  const parts = [body?.title, body?.content, body?.desc, body?.body, body?.message, body?.text]
    .filter(Boolean)

  const message = parts.length > 0 ? parts.join('\n') : JSON.stringify(body)

  // 日志：打印命中了哪个字段，方便确认提取逻辑是否正确
  const hitFields = ['title', 'content', 'desc', 'body', 'message', 'text'].filter(k => body?.[k])
  log('log', `[buildMessage] hit fields: [${hitFields.join(', ') || 'none → fallback to JSON'}]`)
  log('log', `[buildMessage] extracted: ${message}`)

  return message
}

// ── 模板渲染 ──────────────────────────────────────────────
function renderTemplate(template, message) {
  const raw = JSON.stringify(template)
  // 匹配 {{{message}}} 占位符，替换为合法 JSON 字符串值
  const rendered = raw.replace('"{{{message}}}"', JSON.stringify(message))

  // 日志：打印渲染前后对比，确认替换是否生效
  log('log', `[renderTemplate] before: ${raw}`)
  log('log', `[renderTemplate] after:  ${rendered}`)

  return JSON.parse(rendered)
}

// ── 带退避重试的发送 ──────────────────────────────────────
// delay: 首次重试等待 retryDelay ms，之后每次翻倍（指数退避）
// 避免目标服务故障时被无间隔的重试打垮
async function sendWithRetry(target, payload) {
  const maxRetries = target.retry || 1
  const baseDelay = target.retryDelay || 1000

  log('log', `[${target.name}] sending to: ${target.url}`)
  log('log', `[${target.name}] payload: ${JSON.stringify(payload)}`)

  for (let i = 0; i < maxRetries; i++) {
    log('log', `[${target.name}] attempt ${i + 1}/${maxRetries}`)
    try {
      const res = await fetch(target.url, {
        method: target.method || 'POST',
        headers: target.headers,
        body: JSON.stringify(payload)
      })

      // 日志：无论成功失败都打印响应状态和 body
      const text = await res.text()
      log('log', `[${target.name}] response: ${res.status} ${text}`)

      if (res.ok) return { ok: true, status: res.status }

      // HTTP 错误（4xx/5xx）
      log('warn', `[${target.name}] attempt ${i + 1} failed: ${res.status} ${text}`)
    } catch (e) {
      // 网络错误（连接超时、DNS 失败等）
      log('error', `[${target.name}] attempt ${i + 1} error: ${e.message}`)
    }

    // 最后一次失败不需要等待
    if (i < maxRetries - 1) {
      const delay = baseDelay * Math.pow(2, i) // 指数退避：1s, 2s, 4s...
      log('log', `[${target.name}] retrying in ${delay}ms...`)
      await new Promise(r => setTimeout(r, delay))
    }
  }

  return { ok: false }
}

// ── 鉴权中间件 ────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const config = loadConfig()

  // 未配置 secret 则跳过鉴权（开发环境用）
  if (!config.secret) {
    log('warn', 'no secret configured, auth is disabled')
    return next()
  }

  const token = req.query.token

  if (token !== config.secret) {
    log('warn', `[auth] rejected from ${req.ip}`)
    return res.status(401).json({ error: 'Unauthorized' })
  }

  next()
}

// ── 主路由 ────────────────────────────────────────────────
app.post('/webhook', authMiddleware, async (req, res) => {
  const config = loadConfig()
  const targetName = req.query.target

  log('log', `[incoming] from: ${req.ip}`)
  log('log', `[incoming] body: ${JSON.stringify(req.body)}`)

  // 如果指定了 target，只转发给那个；否则转发给所有
  let targets = config.targets
  if (targetName) {
    const found = config.targets.find(t => t.name === targetName)
    if (!found) {
      log('warn', `[incoming] target not found: ${targetName}`)
      return res.status(400).json({ error: `Target '${targetName}' not found` })
    }
    targets = [found]
  }

  const message = buildMessage(req.body)
  const results = []

  // 并行向所有 targets 发送，提高吞吐量
  // 如果需要保证顺序可改为 for...of 串行
  await Promise.all(
    targets.map(async (target) => {
      const payload = renderTemplate(target.bodyTemplate, message)
      const result = await sendWithRetry(target, payload)
      results.push({ target: target.name, ...result })
      log('log', `[${target.name}] final result: ${result.ok ? 'ok' : 'failed'}`)
    })
  )

  // 无论成功失败都返回 200，避免调用方无限重试
  // 调用方可通过 results 里的 ok 字段判断各 target 的状态
  log('log', `[done] results: ${JSON.stringify(results)}`)
  res.json({ success: true, results })
})

// ── 健康检查 ──────────────────────────────────────────────
// 供 Docker healthcheck 或监控系统使用
app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.listen(3000, () => {
  log('log', 'Webhook gateway running on :3000')
  log('log', 'POST /webhook?token=xxx&target=name  - receive and forward to specific target')
  log('log', 'POST /webhook?token=xxx              - receive and forward to all targets')
  log('log', 'GET  /health                         - healthcheck')
})