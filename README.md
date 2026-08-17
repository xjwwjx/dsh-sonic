# dsh-sonic 🔔 音效提醒

> 音效提醒插件 —— 当需要用户确认或任务完成时，在浏览器端播放提示音效。
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

- **设置面板**（设置 → 通用）：一键静音、音量滑块、分别挑选「确认音 / 完成音」，点击即试听；选择自动保存并同步给模型
- **模型工具**：
  - `sonic_play` —— 立即播放指定音效（试听/演示）
  - `sonic_status` —— 读取当前面板选择状态

## 工作原理

```
┌─ Host (宿主组合内静态插件) ───────────────────────┐
│  approval/request ─┐                             │
│  ask_user_question ─┼─► 通知队列 ──┬─ GET /sonic/drain ──┐
│  agent/status idle ─┘              │  (webServer 路由)   │
│                  POST /sonic/state ◄── 面板选择 ─────────┤
│                  sonic_play (工具) ─┘                     │
└──────────────────────────────────────────────────────────┘
        ┌──────────────────────────────────────────────────┐
        │ 浏览器 (Client)                                   │
        │  每 1s 轮询 /sonic/drain → 播放对应音效           │
        │  Web Audio 合成 8 种音效                          │
        │  设置 → 通用 内的选择面板（settings.general.item）│
        └──────────────────────────────────────────────────┘
```

## 安装（永久挂载）

作为一个 **bundle 插件**随 Web profile 自动加载（机制与 `@liustack/modlens` 相同）：

1. 把本包链接进 profile：在 `~/.dsh/profiles/web/package.json` 的 `dependencies` 加
   `"dsh-sonic": "file:<本包路径>"`，并在 `dsh.profile.bundles` 列表加 `"dsh-sonic"`
2. 在 profile 目录执行 `pnpm install`（生成本包的链接）
3. 重启 DeepSeek Harness Web —— 插件随组合自动加载，进程重启后依然在

`cordis.patch.yml` 会自动插入插件行（`- id: dsh-sonic, name: dsh-sonic`）。

> 动态版（会话内 `cordis_define` 加载）的源码保留在 `examples/dynamic-host.js` 与
> `examples/dynamic-client.js`，仅作参考；动态版在进程重启后会丢失，静态版不会。

## 文件结构

```
dsh-sonic/
├── dsh/
│   ├── index.js      # Host 半体（事件监听、通知队列、webServer 路由、模型工具）
│   └── client.js     # 浏览器半体（Web Audio 音效、轮询、设置面板）
├── examples/         # 动态版源码（参考）
├── cordis.patch.yml  # bundle 插件行补丁
├── package.json
├── README.md
└── LICENSE
```

## 自定义音效

音效是 Web Audio 合成的一组音符（`PRESETS`，见 `dsh/client.js`），每个音符支持：

- `freq` / `endFreq` —— 起始/结束频率（滑音）
- `at` / `dur` —— 开始时间与时长
- `type` —— 波形（`sine` / `triangle` / `square` 等）
- `gain` / `attack` —— 音量与起音

想加新音效，往 `PRESETS` 里加一个条目，并在 Host 端 `sonic_play` 的 `enum` 中补充即可。

## License

[MIT](./LICENSE)
