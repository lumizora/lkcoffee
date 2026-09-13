# ☕ Voice Coffee

> 在终端里开口说，完成附近门店查询、咖啡点单与订单查询。

Voice Coffee 是一个 macOS 语音点单实验：本地录音经豆包 ASR 转写，再由 DeepSeek 驱动瑞幸 MCP 完成对话与下单。

```text
☕ Voice Coffee  ·  语音点单助手
Space 录音/停止  Enter 停止并发送  T 重试识别  D 删除录音  Q 退出

✓ 已获取当前位置，可直接查询附近门店
● 正在录音 · Space 停止，Enter 发送
```

## 能做什么

| | 能力 |
| --- | --- |
| 🎙 | 本地麦克风录音与豆包极速 ASR 转写 |
| 📍 | 首次启动申请 macOS 定位权限，查询附近门店 |
| ☕ | 语音查询门店、商品、规格与优惠 |
| 🧾 | 预览最终到手价；明确确认后创建自取订单 |
| 💳 | 在终端展示支付二维码链接，并自动在浏览器打开 |
| 🔎 | 查询订单状态、取餐码；请求取消时显示接口结果或失败原因 |

## 快速开始

### 1. 安装依赖

```bash
brew install ffmpeg
npm install
cp .env.example .env
```

### 2. 配置 `.env`

至少填写豆包 ASR 配置即可录音转文字：

```ini
VOLCENGINE_API_KEY=...
```

如需语音点瑞幸，再填写：

```ini
DEEPSEEK_API_KEY=...
LUCKIN_MCP_TOKEN=...
```

`LUCKIN_MCP_TOKEN` 可在 [瑞幸 MCP 开放平台](https://open.lkcoffee.com/mcp) 登录后创建。不要提交 `.env`。

### 3. 启动

```bash
npm start
```

首次启动会请求 macOS 定位权限。允许后可直接说“帮我看附近有哪些门店”。

## 语音操作

| 按键 | 操作 |
| --- | --- |
| `Space` | 开始录音 / 停止录音 |
| `Enter` | 停止录音并发送识别结果 |
| `T` | 重试识别最近一次录音 |
| `D` | 删除最近一次录音 |
| `Q` | 退出 |

可以直接说：

- “帮我看附近的门店有哪些”
- “临沂沂州里商业街店有什么热门的”
- “来一杯冰的橙C美式，大杯，少糖”
- “看一下实际到手价”
- “确认下单”
- “查一下刚才订单的付款状态”
- “取消这个订单”

## 下单与支付

仅支持到店自取。下单前需要确认门店、商品与规格；系统会先预览价格和优惠。若你只是要求“看实际到手价”，只会显示预览结果，不会创建订单；明确说“确认下单”后才会生成支付订单。

支付二维码链接会同时输出到终端并在 macOS 浏览器中打开。未支付前不会显示取餐码。

## 麦克风与定位排查

默认设备不正确时，先列出 macOS 音频输入设备：

```bash
ffmpeg -f avfoundation -list_devices true -i ""
```

将设备编号填到 `.env`：

```ini
AUDIO_DEVICE=2
```

定位失败时，前往“系统设置 → 隐私与安全性 → 定位服务”，允许 **Voice Coffee** 使用定位；也可以直接说出商圈或门店名。

## 开发

```bash
npm test
npm run test:asr -- path/to/test.wav
```

当前版本是 macOS 终端 MVP：依赖 FFmpeg `avfoundation` 输入，订单与支付由瑞幸 MCP 实时处理。
