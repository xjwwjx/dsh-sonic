// dsh-sonic — Browser half (static bundle plugin)
//
// Hand-written lazy-CJS bundle protocol (window.__ModuleLoader__.load with a
// factory returning cordis-plugin exports) — no build step, no imports from
// dsh client packages, the same zero-dependency stance as the host half. The
// factory receives `require`, which resolves against the platform module
// table (react is a seed word there).
//
// Responsibilities:
//   1. Poll GET /sonic/drain every 1s and play queued notifications.
//   2. Synthesize 8 sound effects with the Web Audio API — no audio files.
//   3. Render the picker (master switch, volume, per-event sound chips) as a
//      row in Settings → General (slot `settings.general.item`), and report
//      selections to the host (POST /sonic/state) so they survive page
//      reloads and stay readable via the `sonic_status` model tool.
window.__ModuleLoader__.load({
  id: 'dsh-sonic',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

    var state = { enabled: true, volume: 0.6, confirm: 'chime', done: 'success' }

    // ---------- Web Audio 合成音效（无需音频文件） ----------
    var audioCtx = null
    function ensureCtx() {
      if (audioCtx) return audioCtx
      var AC = (typeof AudioContext !== 'undefined') ? AudioContext
        : (typeof window !== 'undefined' && window.webkitAudioContext) || null
      if (!AC) return null
      audioCtx = new AC()
      return audioCtx
    }

    function tone(ac, note) {
      var at = ac.currentTime + (note.at || 0)
      var dur = note.dur || 0.3
      var osc = ac.createOscillator()
      var gain = ac.createGain()
      osc.type = note.type || 'sine'
      osc.frequency.setValueAtTime(note.freq, at)
      if (note.endFreq) osc.frequency.exponentialRampToValueAtTime(note.endFreq, at + dur)
      var peak = Math.max(note.gain || 0.25, 0.0001)
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(peak, at + (note.attack || 0.008))
      gain.gain.exponentialRampToValueAtTime(0.0001, at + dur)
      osc.connect(gain)
      gain.connect(ac.destination)
      osc.start(at)
      osc.stop(at + dur + 0.06)
    }

    var PRESETS = {
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

    function playPreset(name) {
      var ac = ensureCtx()
      if (!ac) return
      if (ac.state === 'suspended') {
        var resume = ac.resume()
        if (resume && typeof resume.catch === 'function') resume.catch(function () {})
      }
      var preset = PRESETS[name]
      if (!preset) return
      var scale = state.volume
      for (var i = 0; i < preset.notes.length; i++) {
        var note = preset.notes[i]
        tone(ac, {
          freq: note.freq,
          endFreq: note.endFreq,
          at: 0.03 + (note.at || 0),
          dur: note.dur,
          gain: (note.gain || 0.25) * scale,
          type: note.type,
          attack: note.attack,
        })
      }
    }

    function playFor(kind) {
      playPreset(kind === 'confirm' ? state.confirm : state.done)
    }

    // ---------- Host 通信 ----------
    function reportState() {
      fetch('/sonic/state', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(state),
      }).catch(function () {})
    }

    function loadState() {
      fetch('/sonic/state').then(function (r) { return r.json() }).then(function (s) {
        if (!s || typeof s !== 'object') return
        if (typeof s.enabled === 'boolean') state.enabled = s.enabled
        if (typeof s.volume === 'number') state.volume = s.volume
        if (typeof s.confirm === 'string' && PRESETS[s.confirm]) state.confirm = s.confirm
        if (typeof s.done === 'string' && PRESETS[s.done]) state.done = s.done
      }).catch(function () {})
    }

    function poll() {
      if (!state.enabled) return
      fetch('/sonic/drain').then(function (r) { return r.json() }).then(function (data) {
        var items = data && Array.isArray(data.items) ? data.items : []
        for (var i = 0; i < items.length; i++) {
          var item = items[i]
          if (!item) continue
          if (typeof item.sound === 'string' && PRESETS[item.sound]) playPreset(item.sound)
          else if (item.kind === 'confirm' || item.kind === 'done') playFor(item.kind)
        }
      }).catch(function () {})
    }

    // ---------- 选择器 UI（设置 → 通用） ----------
    function SoundPicker() {
      var enabledPair = React.useState(state.enabled)
      var volumePair = React.useState(state.volume)
      var confirmPair = React.useState(state.confirm)
      var donePair = React.useState(state.done)
      var enabled = enabledPair[0]
      var setEnabled = enabledPair[1]
      var volume = volumePair[0]
      var setVolume = volumePair[1]
      var confirm = confirmPair[0]
      var setConfirm = confirmPair[1]
      var done = donePair[0]
      var setDone = donePair[1]

      var names = Object.keys(PRESETS)

      function chip(name, selected, onPick) {
        return React.createElement('button', {
          key: name,
          type: 'button',
          className: 'dsh-sonic-chip' + (selected ? ' dsh-sonic-chip--on' : ''),
          title: PRESETS[name].desc,
          onClick: function () { onPick(name) },
        }, PRESETS[name].label)
      }

      function section(title, selected, onPick) {
        var chips = names.map(function (n) { return chip(n, selected === n, onPick) })
        return React.createElement('div', { className: 'dsh-sonic-group' },
          React.createElement('div', { className: 'dsh-sonic-group-title' }, title),
          React.createElement('div', { className: 'dsh-sonic-chips' }, chips),
        )
      }

      return React.createElement('div', { className: 'dsh-sonic' },
        React.createElement('div', { className: 'dsh-sonic-header' },
          React.createElement('span', { className: 'dsh-sonic-title' }, '🔔 音效提醒'),
          React.createElement('label', { className: 'dsh-sonic-toggle' },
            React.createElement('input', {
              type: 'checkbox',
              checked: enabled,
              onChange: function (e) {
                state.enabled = e.target.checked
                setEnabled(e.target.checked)
                reportState()
              },
            }),
            React.createElement('span', null, enabled ? '已启用' : '已静音'),
          ),
        ),
        React.createElement('div', { className: 'dsh-sonic-row' },
          React.createElement('span', { className: 'dsh-sonic-row-label' }, '音量'),
          React.createElement('input', {
            type: 'range',
            min: 0,
            max: 1,
            step: 0.05,
            value: volume,
            onChange: function (e) {
              state.volume = Number(e.target.value)
              setVolume(state.volume)
              reportState()
            },
          }),
          React.createElement('span', { className: 'dsh-sonic-vol' }, Math.round(volume * 100) + '%'),
        ),
        section('🛎 需要用户确认时', confirm, function (n) {
          state.confirm = n
          setConfirm(n)
          playPreset(n)
          reportState()
        }),
        section('✅ 任务完成时', done, function (n) {
          state.done = n
          setDone(n)
          playPreset(n)
          reportState()
        }),
        React.createElement('div', { className: 'dsh-sonic-hint' }, '点击音效按钮可试听并设为对应场景的提示音；选择会自动保存并同步给模型（sonic_status）。'),
      )
    }

    // ---------- 插件本体 ----------
    exports.name = 'dsh-sonic'
    exports.inject = []
    exports.apply = function (ctx) {
      var slots = ctx.get('slots')
      if (slots) {
        slots.inject('settings.general.item', function () {
          return slots.register(
            { name: 'settings.general.item', id: 'dsh-sonic' },
            function () { return React.createElement(SoundPicker, null) },
          )
        })
      }

      var style = document.createElement('style')
      style.textContent = '.dsh-sonic { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 13px; } '
        + '.dsh-sonic-header { display: flex; align-items: center; justify-content: space-between; } '
        + '.dsh-sonic-title { font-weight: 600; } '
        + '.dsh-sonic-toggle { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; color: var(--dsw-alias-label-secondary); user-select: none; } '
        + '.dsh-sonic-row { display: flex; align-items: center; gap: 8px; } '
        + '.dsh-sonic-row input[type=range] { flex: 1; } '
        + '.dsh-sonic-row-label { color: var(--dsw-alias-label-secondary); } '
        + '.dsh-sonic-vol { min-width: 42px; text-align: right; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; } '
        + '.dsh-sonic-group { display: flex; flex-direction: column; gap: 4px; } '
        + '.dsh-sonic-group-title { color: var(--dsw-alias-label-secondary); font-size: 12px; } '
        + '.dsh-sonic-chips { display: flex; flex-wrap: wrap; gap: 6px; } '
        + '.dsh-sonic-chip { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-radius: 999px; padding: 3px 12px; font-size: 13px; cursor: pointer; line-height: 1.4; } '
        + '.dsh-sonic-chip:hover { border-color: var(--dsw-alias-brand-primary); } '
        + '.dsh-sonic-chip--on { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); font-weight: 600; } '
        + '.dsh-sonic-hint { color: var(--dsw-alias-label-secondary); font-size: 11px; }'
      document.head.appendChild(style)
      ctx.effect(function () {
        return function () {
          if (style.parentNode) style.parentNode.removeChild(style)
        }
      })

      setInterval(poll, 1000)
      loadState()
    }

    return module.exports
  },
})
