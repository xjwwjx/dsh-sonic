/**
 * dsh-sonic — Browser half (code.client for cordis_define)
 *
 * This file is the exact `code.client` function body of the dsh-sonic dynamic
 * Cordis plugin. It runs as the body of an async function in the DSH Web page,
 * so:
 *   - no `import` / `require` / JSX / TypeScript — build UI with
 *     `React.createElement(...)`;
 *   - `setTimeout` / `setInterval` / `fetch` are withheld — use
 *     `inject: ['timer']` + `ctx.interval(...)`;
 *   - browser globals such as `AudioContext` / `window` remain reachable, so
 *     sound is synthesized with the Web Audio API — no audio files needed.
 *
 * Responsibilities:
 *   1. Poll `host.call('drain')` every 1s and play queued notifications.
 *   2. Report picker selections to the host via `host.call('report-state', ...)`
 *      so the model can read them with the `sonic_status` tool.
 *   3. Render a picker panel (master switch, volume, per-event sound chips)
 *      inside the cordis_run card via the `tool.view.cordis` slot (key 'self').
 */
return {
  inject: ['timer'],
  apply(ctx) {
    const state = {
      enabled: true,
      volume: 0.6,
      confirm: 'chime',
      done: 'success',
    }

    // 向 Host 上报当前选择（让模型可通过 sonic_status 查看）
    const report = () => {
      host.call('report-state', {
        enabled: state.enabled,
        volume: state.volume,
        confirm: state.confirm,
        done: state.done,
      }).catch(() => {})
    }

    // ---------- Web Audio 合成音效（无需音频文件） ----------
    let audioCtx = null
    const ensureCtx = () => {
      if (audioCtx) return audioCtx
      const AC = (typeof AudioContext !== 'undefined') ? AudioContext
        : (typeof window !== 'undefined' && window.webkitAudioContext) || null
      if (!AC) return null
      audioCtx = new AC()
      return audioCtx
    }

    const tone = (ac, note) => {
      const at = ac.currentTime + (note.at || 0)
      const dur = note.dur || 0.3
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.type = note.type || 'sine'
      osc.frequency.setValueAtTime(note.freq, at)
      if (note.endFreq) osc.frequency.exponentialRampToValueAtTime(note.endFreq, at + dur)
      const peak = Math.max(note.gain || 0.25, 0.0001)
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(peak, at + (note.attack || 0.008))
      gain.gain.exponentialRampToValueAtTime(0.0001, at + dur)
      osc.connect(gain)
      gain.connect(ac.destination)
      osc.start(at)
      osc.stop(at + dur + 0.06)
    }

    const PRESETS = {
      ding: { label: '叮', desc: '单音清脆', notes: [{ freq: 1046.5, at: 0, dur: 0.55, gain: 0.32, type: 'sine' }] },
      dingdong: { label: '叮咚', desc: '门铃双音', notes: [
        { freq: 1318.5, at: 0, dur: 0.4, gain: 0.3, type: 'sine' },
        { freq: 1046.5, at: 0.18, dur: 0.55, gain: 0.3, type: 'sine' },
      ] },
      pop: { label: '泡泡', desc: '轻快气泡', notes: [{ freq: 620, endFreq: 190, at: 0, dur: 0.16, gain: 0.4, type: 'triangle', attack: 0.004 }] },
      chime: { label: '风铃', desc: '柔和三连音', notes: [
        { freq: 1568, at: 0, dur: 0.7, gain: 0.16, type: 'sine' },
        { freq: 2093, at: 0.13, dur: 0.7, gain: 0.16, type: 'sine' },
        { freq: 2637, at: 0.26, dur: 0.9, gain: 0.14, type: 'sine' },
      ] },
      success: { label: '成功', desc: '上扬琶音', notes: [
        { freq: 523.25, at: 0, dur: 0.3, gain: 0.26, type: 'triangle' },
        { freq: 659.25, at: 0.09, dur: 0.3, gain: 0.26, type: 'triangle' },
        { freq: 783.99, at: 0.18, dur: 0.3, gain: 0.26, type: 'triangle' },
        { freq: 1046.5, at: 0.27, dur: 0.6, gain: 0.28, type: 'triangle' },
      ] },
      beep: { label: '哔', desc: '电子短哔', notes: [{ freq: 1000, at: 0, dur: 0.13, gain: 0.16, type: 'square', attack: 0.004 }] },
      alarm: { label: '注意', desc: '提醒双音', notes: [
        { freq: 880, at: 0, dur: 0.24, gain: 0.26, type: 'triangle' },
        { freq: 659.25, at: 0.24, dur: 0.24, gain: 0.26, type: 'triangle' },
        { freq: 880, at: 0.48, dur: 0.3, gain: 0.28, type: 'triangle' },
      ] },
      marimba: { label: '木琴', desc: '木琴敲击', notes: [{ freq: 784, endFreq: 610, at: 0, dur: 0.42, gain: 0.3, type: 'sine', attack: 0.004 }] },
    }

    const playPreset = (name) => {
      const ac = ensureCtx()
      if (!ac) return
      if (ac.state === 'suspended') {
        const resume = ac.resume()
        if (resume && typeof resume.catch === 'function') resume.catch(() => {})
      }
      const preset = PRESETS[name]
      if (!preset) return
      const scale = state.volume
      for (const note of preset.notes) {
        tone(ac, Object.assign({}, note, { at: 0.03 + (note.at || 0), gain: (note.gain || 0.25) * scale }))
      }
    }

    const playFor = (kind) => playPreset(kind === 'confirm' ? state.confirm : state.done)

    // ---------- 轮询 Host 通知（每 1 秒） ----------
    const poll = () => {
      if (!state.enabled) return
      host.call('drain').then((res) => {
        const items = res && Array.isArray(res.items) ? res.items : []
        for (const item of items) {
          if (!item) continue
          if (typeof item.sound === 'string' && PRESETS[item.sound]) {
            playPreset(item.sound)
          } else if (item.kind === 'confirm' || item.kind === 'done') {
            playFor(item.kind)
          }
        }
      }).catch(() => {})
    }
    ctx.interval(poll, 1000)

    // ---------- 选择器 UI（Run 卡片内） ----------
    function SoundPicker(props) {
      const { presets } = props
      const [enabled, setEnabled] = React.useState(state.enabled)
      const [volume, setVolume] = React.useState(state.volume)
      const [confirm, setConfirm] = React.useState(state.confirm)
      const [done, setDone] = React.useState(state.done)
      const names = Object.keys(presets)

      const chip = (name, selected, onPick) => {
        const p = presets[name]
        return React.createElement('button', {
          key: name,
          type: 'button',
          className: 'sonic-chip' + (selected ? ' sonic-chip--on' : ''),
          title: p.desc,
          onClick: () => onPick(name),
        }, p.label)
      }
      const section = (title, selected, onPick) => React.createElement('div', { className: 'sonic-group' },
        React.createElement('div', { className: 'sonic-group-title' }, title),
        React.createElement('div', { className: 'sonic-chips' }, names.map((n) => chip(n, selected === n, onPick))),
      )

      return React.createElement('div', { className: 'sonic' },
        React.createElement('div', { className: 'sonic-header' },
          React.createElement('span', { className: 'sonic-title' }, '🔔 音效提醒'),
          React.createElement('label', { className: 'sonic-toggle' },
            React.createElement('input', {
              type: 'checkbox',
              checked: enabled,
              onChange: (e) => {
                state.enabled = e.target.checked
                setEnabled(e.target.checked)
                report()
              },
            }),
            React.createElement('span', null, enabled ? '已启用' : '已静音'),
          ),
        ),
        React.createElement('div', { className: 'sonic-row' },
          React.createElement('span', { className: 'sonic-row-label' }, '音量'),
          React.createElement('input', {
            type: 'range',
            min: 0,
            max: 1,
            step: 0.05,
            value: volume,
            onChange: (e) => {
              state.volume = Number(e.target.value)
              setVolume(state.volume)
              report()
            },
          }),
          React.createElement('span', { className: 'sonic-vol' }, Math.round(volume * 100) + '%'),
        ),
        section('🛎 需要用户确认时', confirm, (n) => {
          state.confirm = n
          setConfirm(n)
          playPreset(n)
          report()
        }),
        section('✅ 任务完成时', done, (n) => {
          state.done = n
          setDone(n)
          playPreset(n)
          report()
        }),
        React.createElement('div', { className: 'sonic-hint' }, '点击音效按钮可试听并设为对应场景的提示音'),
      )
    }

    const slots = ctx.get('slots')
    if (slots !== undefined) {
      slots.inject('tool.view.cordis', () => slots.register(
        { name: 'tool.view.cordis', key: 'self' },
        () => React.createElement(SoundPicker, { presets: PRESETS }),
      ))
    }

    report()

    styles.insert('.sonic { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 13px; } '
      + '.sonic-header { display: flex; align-items: center; justify-content: space-between; } '
      + '.sonic-title { font-weight: 600; } '
      + '.sonic-toggle { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; color: var(--dsw-alias-label-secondary); user-select: none; } '
      + '.sonic-row { display: flex; align-items: center; gap: 8px; } '
      + '.sonic-row input[type=range] { flex: 1; } '
      + '.sonic-row-label { color: var(--dsw-alias-label-secondary); } '
      + '.sonic-vol { min-width: 42px; text-align: right; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; } '
      + '.sonic-group { display: flex; flex-direction: column; gap: 4px; } '
      + '.sonic-group-title { color: var(--dsw-alias-label-secondary); font-size: 12px; } '
      + '.sonic-chips { display: flex; flex-wrap: wrap; gap: 6px; } '
      + '.sonic-chip { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-radius: 999px; padding: 3px 12px; font-size: 13px; cursor: pointer; line-height: 1.4; } '
      + '.sonic-chip:hover { border-color: var(--dsw-alias-brand-primary); } '
      + '.sonic-chip--on { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); font-weight: 600; } '
      + '.sonic-hint { color: var(--dsw-alias-label-secondary); font-size: 11px; }')
  },
}
