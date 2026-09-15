import { createDecipheriv } from "node:crypto";

type VoiceMedia = { full_url?: string; encrypt_query_param?: string; aes_key?: string };
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type Converter = (input: Uint8Array) => Promise<Buffer>;

const maxBytes = 100 * 1024 * 1024;

function mediaUrl(media: VoiceMedia): string {
  if (media.full_url?.trim()) return media.full_url.trim();
  if (!media.encrypt_query_param?.trim()) throw new Error("iLink 语音缺少下载地址");
  const base = process.env.ILINK_CDN_BASE_URL?.trim() || "https://novac2c.cdn.weixin.qq.com/c2c";
  const url = new URL("download", base.endsWith("/") ? base : `${base}/`);
  url.searchParams.set("encrypted_query_param", media.encrypt_query_param);
  return url.toString();
}

function aesKey(value: string): Buffer {
  const decoded = Buffer.from(value.trim(), "base64");
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32 && /^[0-9a-f]{32}$/i.test(decoded.toString("ascii"))) return Buffer.from(decoded.toString("ascii"), "hex");
  if (/^[0-9a-f]{32}$/i.test(value.trim())) return Buffer.from(value.trim(), "hex");
  throw new Error("iLink 语音 AES 密钥格式无效");
}

function decrypt(input: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(input), decipher.final()]);
}

async function fetchBytes(url: string, fetcher: Fetcher): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.MEDIA_DOWNLOAD_TIMEOUT_MS ?? 30_000));
  try {
    const response = await fetcher(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`iLink 语音下载失败：${response.status}`);
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > maxBytes) throw new Error("iLink 语音超过 100 MiB 限制");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error("iLink 语音超过 100 MiB 限制");
    return bytes;
  } finally {
    clearTimeout(timer);
  }
}

export async function pcmFromFfmpeg(input: Uint8Array): Promise<Buffer> {
  if (!Bun.which("ffmpeg")) throw new Error("未找到 ffmpeg，请先安装：brew install ffmpeg");
  const process = Bun.spawn(["ffmpeg", "-v", "error", "-i", "pipe:0", "-ar", "16000", "-ac", "1", "-f", "s16le", "pipe:1"], { stdin: input, stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).arrayBuffer(), new Response(process.stderr).text()]);
  if (code) throw new Error(`iLink 语音转换失败：${stderr.trim() || code}`);
  return Buffer.from(stdout);
}

export async function downloadVoice(
  voice: { media?: VoiceMedia },
  fetcher: Fetcher = fetch,
  convert: Converter = pcmFromFfmpeg,
): Promise<{ pcm: Buffer }> {
  if (!voice.media?.aes_key) throw new Error("iLink 语音缺少 AES 密钥");
  return { pcm: await convert(decrypt(await fetchBytes(mediaUrl(voice.media), fetcher), aesKey(voice.media.aes_key))) };
}
