# Voice Recorder Spike

macOS 终端录音后调用豆包录音文件极速版 ASR。

```bash
cp .env.example .env
# 填入 VOLCENGINE_API_KEY；AUDIO_DEVICE 默认 0
npm test
npm start
```

如果默认麦克风不对，先运行：

```bash
ffmpeg -f avfoundation -list_devices true -i ""
```

把音频设备编号或名称填入 `AUDIO_DEVICE`。先验证 API：

```bash
npm run test:asr -- path/to/test.wav
```

瑞幸语音对话需要额外配置 `DEEPSEEK_API_KEY` 和 `LUCKIN_MCP_TOKEN`；后者在 [瑞幸 MCP 开放平台](https://open.lkcoffee.com/mcp) 登录后创建。当前版本可查询门店、商品和订单；下单或取消需要后续明确确认，不会自动执行。

首次 `npm start` 会请求 macOS 定位权限，用于查询附近门店；允许后坐标仅保留在当前运行会话。
