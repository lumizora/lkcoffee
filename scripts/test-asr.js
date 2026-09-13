import { access } from "node:fs/promises";
import { VolcengineASR } from "../src/asr/volcengine.js";

const file = process.argv[2];
if (!file) throw new Error("用法：npm run test:asr -- path/to/test.wav");
await access(file);
const result = await new VolcengineASR({
  apiKey: process.env.VOLCENGINE_API_KEY,
  resourceId: process.env.VOLCENGINE_RESOURCE_ID,
  url: process.env.VOLCENGINE_ASR_URL,
}).transcribe(file);
console.log(result.text);
