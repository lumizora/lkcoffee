# iLink ClawBot 接入设计

## 目标

增加独立的 `bun run bot` 运行入口。它使用 `/Users/passer/Downloads/bun-ilink-clawbot-demo/.data` 中已有的 iLink 会话，接收微信文字或语音，并将内容交给现有 `CoffeeAgent`，把回复以微信文本发送回原会话。

## 运行与数据流

`bot` 不启动 Ink、本地麦克风、TTS 或 macOS 定位。启动时读取演示项目的 `account.json` 和轮询游标，调用 `notifystart`，长轮询 `getupdates`。文字与 iLink 返回的语音转写文本直接调用 `CoffeeAgent.ask()`；没有转写的语音暂不处理。回复携带接收消息的 `context_token` 调用 `sendmessage`。退出时调用 `notifystop`。

## 最小实现

把 iLink 协议、存储和消息收发代码放入 `src/ilink/`。新建 `src/bot.ts` 负责把 iLink 的标准化文本交给 `CoffeeAgent`。登录、登出 CLI、二维码依赖、媒体下载和解码不迁入；账户凭据始终在演示项目的 `.data/`，不会复制或提交到本仓库。

需要的环境变量沿用现有 `DEEPSEEK_*`、`LUCKIN_MCP_*`；iLink 协议配置沿用演示项目的 `ILINK_*` 默认值。无法读取会话时给出明确错误，提示用户在演示项目完成登录；单条消息失败记录错误并继续下一次轮询。

## 验证

新增 Bun 单元测试，使用伪造 iLink 收件箱和 `CoffeeAgent` 客户端，断言文字消息与含转写的语音都会得到带原 `context_token` 的回复。执行 `bun test` 和 `bun run typecheck`；然后以已有会话运行 `bun run bot`，无需扫码登录，并从微信发送一条文本确认端到端收发。
