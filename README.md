# dsh-sonic 🔔 音效提醒

> 音效提醒插件（动态 Cordis Plugin）—— 当需要用户确认或任务完成时，在浏览器端播放提示音效。
> 面向 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) Web。

## 功能

- **需要用户确认时** 播放「确认音」：审批请求（沙箱提权、插件运行授权、工具审批）、`ask_user_question` 等待作答
- **任务完成时** 播放「完成音」：agent 由 `running` 转为 `idle`
- **8 种音效** 全部由 Web Audio API 实时合成，无需任何音频文件：

| 音效 | key | 特点 |
|---|---|---|
| 叮 | `ding` | 单音清脆 |
| 叮咚 | `dingdong` | 门铃双音 |
| 泡泡 | `pop` | 轻快气泡 |
| 风铃 | `chime` | 柔和三连音 |
| 成功 | `success` | 上扬琶音 |
| 哔 | `beep` | 电子短哔 |
| 注意 | `alarm` | 提醒双音 |
| 木琴 | `marimba` | 木琴敲击 |

- **Run 卡片内选择面板**：一键静音、音量滑块、分别挑选「确认音 / 完成音」，点击即试听
- **模型工具**：
  - `sonic_play` —— 立即播放指定音效（试听/演示）
  - `sonic_status` —— 读取当前面板选择状态

## 工作原理

```
┌─ Host (Node.js) ──────────────────────────────────┐
│  approval/request ─┐                              │
│  ask_user_question ─┼─► 通知队列 ──┬── drain ◄────┼──┐  每 1s 轮询
│  agent/status idle ─┘              │              │  │
│                    report-state ◄──┼──── 面板选择 ─┼──┘
│                    sonic_play ─────┘              │
└───────────────────────────────────────────────────┘
        ┌───────────────────────────────────────────┐
        │ 浏览器 (Client)                            │
        │  轮询 drain → 按事件播放对应音效            │
        │  Web Audio 合成 8 种音效                   │
        │  Run 卡片内选择面板（tool.view.cordis）     │
        └───────────────────────────────────────────┘
```

## 使用方式（动态插件）

这是一个**动态 Cordis 插件**：不需要构建、不需要安装依赖，直接把 `src/host.js` 与 `src/client.js` 的内容分别作为 `code.host` / `code.client` 通过 `cordis_define` 定义，再 `cordis_run` 激活即可。

首次激活会请求授权；批准后浏览器端加载完成，音效即刻生效。

## 文件结构

```
dsh-sonic/
├── src/
│   ├── host.js      # Host 半体（事件监听、通知队列、模型工具）
│   └── client.js    # 浏览器半体（Web Audio 音效、轮询、选择面板）
├── package.json
├── README.md
└── LICENSE
```

## 自定义音效

音效是 Web Audio 合成的一组音符（`PRESETS`，见 `src/client.js`），每个音符支持：

- `freq` / `endFreq` —— 起始/结束频率（滑音）
- `at` / `dur` —— 开始时间与时长
- `type` —— 波形（`sine` / `triangle` / `square` 等）
- `gain` / `attack` —— 音量与起音

想加新音效，往 `PRESETS` 里加一个条目，并在 Host 端 `sonic_play` 的 `enum` 中补充即可。

## License

[MIT](./LICENSE)
