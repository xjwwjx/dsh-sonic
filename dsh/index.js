// dsh-sonic — Host half (static bundle plugin, mounted in the host composition)
//
// Mirrors the @liustack/modlens zero-dependency pattern: plain ESM, node
// builtins only, no imports from dsh packages.
//
// Responsibilities:
//   1. Listen to host events and enqueue notification items:
//        - `approval/request`        → { kind: 'confirm' }   (user must approve)
//        - `tools/pre-execute` when the tool is `ask_user_question`
//                                   → { kind: 'confirm' }   (user must answer)
//        - `agent/status` running → idle
//                                   → { kind: 'done' }      (task finished)
//   2. Serve the browser half through HTTP routes (webServer service, web
//      profile only — the same optional-inject pattern as modlens):
//        - GET  /sonic/drain  → { items: [...] }  (pending notifications)
//        - GET  /sonic/state  → current panel selections
//        - POST /sonic/state  ← panel selections reported by the browser
//   3. Register model tools `sonic_play` (play any sound) and `sonic_status`
//      (read the current panel selections).
//
// The queue and the last known panel state live in this process's memory, so
// they survive page reloads but not a process restart — the same durability
// as every other static plugin's in-memory state.

export const name = 'dsh-sonic'
export const inject = ['tools']

const DEFAULT_STATE = { enabled: true, volume: 0.6, confirm: 'chime', done: 'success' }
const SOUND_NAMES = ['ding', 'dingdong', 'pop', 'chime', 'success', 'beep', 'alarm', 'marimba']

export function apply(ctx, config = {}) {
  const pending = []
  const running = new Set()
  let lastDoneAt = 0
  let lastState = null

  const enqueue = (item) => {
    pending.push(item)
    if (pending.length > 50) pending.shift()
  }
  const hasPending = (kind) => pending.some((n) => n.kind === kind)

  // 需要用户确认：审批请求（沙箱提权、插件运行授权、工具审批等）
  ctx.on('approval/request', (req, next) => {
    try {
      if (!hasPending('confirm')) {
        enqueue({
          kind: 'confirm',
          toolName: req && typeof req.toolName === 'string' ? req.toolName : undefined,
          reason: req && typeof req.reason === 'string' ? req.reason : undefined,
        })
      }
    } catch (error) {
      console.error(`[dsh-sonic] approval/request handler: ${error?.message ?? error}`)
    }
    return next()
  })

  // 需要用户确认：ask_user_question 工具正在等待用户作答
  ctx.on('tools/pre-execute', (exec, next) => {
    try {
      if (exec && exec.name === 'ask_user_question' && !hasPending('confirm')) {
        enqueue({ kind: 'confirm', toolName: 'ask_user_question' })
      }
    } catch (error) {
      console.error(`[dsh-sonic] tools/pre-execute handler: ${error?.message ?? error}`)
    }
    return next()
  })

  // 任务完成：agent 从 running 变为 idle（1.5s 窗口内合并子代理爆发式完成）
  ctx.on('agent/status', (payload) => {
    try {
      const agent = payload && payload.agent
      const status = payload && payload.status
      if (!agent || typeof agent.id !== 'string') return
      if (status === 'running') {
        running.add(agent.id)
      } else if (status === 'idle' && running.delete(agent.id)) {
        const now = Date.now()
        if (now - lastDoneAt > 1500 && !hasPending('done')) {
          lastDoneAt = now
          enqueue({ kind: 'done' })
        }
      }
    } catch (error) {
      console.error(`[dsh-sonic] agent/status handler: ${error?.message ?? error}`)
    }
  })

  // Browser RPC over HTTP (webServer exists only under the web profile).
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (scope) => {
      scope.webServer.register({
        name: 'dsh-sonic-drain',
        kind: 'exact',
        path: '/sonic/drain',
        handler: async (req, res) => {
          try {
            if (req.method !== 'GET') {
              res.writeHead(405).end()
              return
            }
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ items: pending.splice(0, pending.length) }))
          } catch (error) {
            res.writeHead(500, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: String(error?.message ?? error) }))
          }
        },
      })
      scope.webServer.register({
        name: 'dsh-sonic-state',
        kind: 'exact',
        path: '/sonic/state',
        handler: async (req, res) => {
          try {
            if (req.method === 'GET') {
              res.writeHead(200, { 'content-type': 'application/json' })
              res.end(JSON.stringify(lastState ?? DEFAULT_STATE))
              return
            }
            if (req.method === 'POST') {
              const chunks = []
              for await (const chunk of req) chunks.push(chunk)
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
              lastState = {
                enabled: body.enabled === true,
                volume: typeof body.volume === 'number' ? body.volume : undefined,
                confirm: typeof body.confirm === 'string' ? body.confirm : undefined,
                done: typeof body.done === 'string' ? body.done : undefined,
              }
              res.writeHead(200, { 'content-type': 'application/json' })
              res.end(JSON.stringify({ ok: true }))
              return
            }
            res.writeHead(405).end()
          } catch (error) {
            res.writeHead(500, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: String(error?.message ?? error) }))
          }
        },
      })
    })
  }

  // Model tools: play any sound / read the panel state.
  try {
    ctx.tools.register({
      name: 'sonic_play',
      description: '立即播放指定的提示音效（试听或演示用）。sound 取值为音效名。',
      parameters: {
        type: 'object',
        properties: {
          sound: {
            type: 'string',
            description: '音效名：ding 叮 / dingdong 叮咚 / pop 泡泡 / chime 风铃 / success 成功 / beep 哔 / alarm 注意 / marimba 木琴',
            enum: SOUND_NAMES,
          },
        },
        required: ['sound'],
      },
      output: {
        schema: { type: 'object', properties: { played: { type: 'string' } } },
        render: (_args, value) => [{ type: 'text', text: `已播放音效: ${value.played}` }],
      },
      async execute(args) {
        const sound = args && typeof args.sound === 'string' && SOUND_NAMES.includes(args.sound) ? args.sound : 'ding'
        enqueue({ kind: 'confirm', sound })
        return { played: sound }
      },
    })
    ctx.tools.register({
      name: 'sonic_status',
      description: '查看音效提醒插件的当前选择状态：是否启用、音量、确认音、完成音。',
      parameters: { type: 'object', properties: {} },
      output: {
        schema: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            volume: { type: 'number' },
            confirm: { type: 'string' },
            done: { type: 'string' },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `音效状态: 启用=${value.enabled} 音量=${Math.round((value.volume ?? 0) * 100)}% 确认音=${value.confirm} 完成音=${value.done}`,
        }],
      },
      async execute() {
        const s = lastState
        return {
          enabled: s ? s.enabled : DEFAULT_STATE.enabled,
          volume: s && typeof s.volume === 'number' ? s.volume : DEFAULT_STATE.volume,
          confirm: s && typeof s.confirm === 'string' ? s.confirm : DEFAULT_STATE.confirm,
          done: s && typeof s.done === 'string' ? s.done : DEFAULT_STATE.done,
        }
      },
    })
  } catch (error) {
    console.error(`[dsh-sonic] tool registration: ${error?.message ?? error}`)
  }
}
