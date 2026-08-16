/**
 * dsh-sonic — Host half (code.host for cordis_define)
 *
 * This file is the exact `code.host` function body of the dsh-sonic dynamic
 * Cordis plugin. It runs in the DSH host process (Node.js) inside the
 * dynamic-plugin sandbox, so:
 *   - no `import` / `require` / TypeScript;
 *   - standard JS intrinsics (Date, Set, Map, ...) are available;
 *   - Node timers are NOT — use `ctx.interval` / `ctx.timeout` instead;
 *   - `harness` provides package-private RPC handlers and dynamic model tools.
 *
 * Responsibilities:
 *   1. Listen to host events and enqueue notification items:
 *        - `approval/request`        → { kind: 'confirm' }   (user must approve)
 *        - `tools/pre-execute` when the tool is `ask_user_question`
 *                                   → { kind: 'confirm' }   (user must answer)
 *        - `agent/status` running → idle
 *                                   → { kind: 'done' }      (task finished)
 *   2. Expose `drain` to the browser half (client polls every 1s).
 *   3. Accept `report-state` from the browser half (picker selections).
 *   4. Register model tools `sonic_play` and `sonic_status`.
 */
return {
  apply(ctx) {
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
      } catch (err) {
        console.error('sonic: approval/request handler failed', err)
      }
      return next()
    })

    // 需要用户确认：ask_user_question 工具正在等待用户作答
    ctx.on('tools/pre-execute', (exec, next) => {
      try {
        if (exec && exec.name === 'ask_user_question' && !hasPending('confirm')) {
          enqueue({ kind: 'confirm', toolName: 'ask_user_question' })
        }
      } catch (err) {
        console.error('sonic: tools/pre-execute handler failed', err)
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
      } catch (err) {
        console.error('sonic: agent/status handler failed', err)
      }
    })

    // 客户端轮询拉取待播放通知
    harness.handle('drain', () => ({ items: pending.splice(0, pending.length) }))

    // 客户端上报面板选择（enabled/volume/confirm/done）
    harness.handle('report-state', (args) => {
      lastState = args && typeof args === 'object' && args !== null ? {
        enabled: args.enabled === true,
        volume: typeof args.volume === 'number' ? args.volume : undefined,
        confirm: typeof args.confirm === 'string' ? args.confirm : undefined,
        done: typeof args.done === 'string' ? args.done : undefined,
      } : null
      return { ok: true }
    })

    // 模型可调用：播放指定音效（试听/演示）
    const playTool = harness.defineTool({
      name: 'sonic_play',
      description: '立即播放指定的提示音效（试听或演示用）。sound 取值为音效名。',
      parameters: {
        type: 'object',
        properties: {
          sound: {
            type: 'string',
            description: '要播放的音效名：ding 叮 / dingdong 叮咚 / pop 泡泡 / chime 风铃 / success 成功 / beep 哔 / alarm 注意 / marimba 木琴',
            enum: ['ding', 'dingdong', 'pop', 'chime', 'success', 'beep', 'alarm', 'marimba'],
          },
        },
        required: ['sound'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            played: { type: 'string', required: true },
          },
        },
        render: (args, value) => [{ type: 'text', text: '已播放音效: ' + value.played }],
      },
      execute: (args) => {
        const sound = args && typeof args.sound === 'string' ? args.sound : 'ding'
        enqueue({ kind: 'confirm', sound })
        return { played: sound }
      },
    })
    harness.registerTool(ctx, playTool)

    // 模型可调用：查看当前面板选择状态
    const statusTool = harness.defineTool({
      name: 'sonic_status',
      description: '查看音效提醒插件的当前选择状态：是否启用、音量、确认音、完成音。',
      parameters: {
        type: 'object',
        properties: {},
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            enabled: { type: 'boolean', required: true },
            volume: { type: 'number', required: true },
            confirm: { type: 'string', required: true },
            done: { type: 'string', required: true },
          },
        },
        render: (args, value) => [{ type: 'text', text: '音效状态: 启用=' + value.enabled + ' 音量=' + Math.round(value.volume * 100) + '% 确认音=' + value.confirm + ' 完成音=' + value.done }],
      },
      execute: () => {
        const s = lastState
        return {
          enabled: s ? s.enabled : true,
          volume: s && typeof s.volume === 'number' ? s.volume : 0.6,
          confirm: s && typeof s.confirm === 'string' ? s.confirm : 'chime',
          done: s && typeof s.done === 'string' ? s.done : 'success',
        }
      },
    })
    harness.registerTool(ctx, statusTool)
  },
}
