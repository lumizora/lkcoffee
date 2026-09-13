import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { spawn as spawnProcess } from "node:child_process";

export class Recorder {
  constructor({ recordingDir, device = "0", spawn = spawnProcess, onError = () => {} }) {
    this.recordingDir = recordingDir;
    this.device = device || "0";
    this.spawn = spawn;
    this.onError = onError;
    this.child = null;
    this.file = null;
  }

  isRecording() {
    return this.child !== null;
  }

  async start() {
    if (this.isRecording()) throw new Error("正在录音");
    await mkdir(this.recordingDir, { recursive: true });
    this.file = join(this.recordingDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.wav`);
    const child = this.spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "warning", "-f", "avfoundation", "-i", `:${this.device}`,
      "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", this.file,
    ]);
    this.child = child;
    child.once("error", (error) => {
      if (this.child === child) { this.child = null; this.onError(error); }
    });
    child.once("close", (code) => {
      if (this.child === child) {
        this.child = null;
        if (code !== 0) this.onError(new Error(`FFmpeg 启动失败（退出码 ${code}）`));
      }
    });
    return this.file;
  }

  async stop() {
    if (!this.child) throw new Error("当前没有录音");
    const child = this.child;
    const file = this.file;
    return new Promise((resolve, reject) => {
      child.once("error", (error) => { this.child = null; reject(error); });
      child.once("close", async (code) => {
        this.child = null;
        try {
          if (code !== 0) throw new Error(`FFmpeg 退出码 ${code}`);
          if ((await stat(file)).size <= 44) throw new Error("录音文件为空");
          resolve(file);
        } catch (error) { reject(error); }
      });
      child.stdin.write("q\n");
    });
  }
}
