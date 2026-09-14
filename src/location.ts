import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const helper = fileURLToPath(new URL("../native/LocationHelper.app/Contents/MacOS/LocationHelper", import.meta.url));

export type Location = { latitude: number; longitude: number };
type Run = (file: string, args: string[], options: { timeout: number }, done: (error: Error | null, stdout: string, stderr: string) => void) => void;

const execute: Run = (file, args, options, done) => {
  execFile(file, args, options, (error, stdout, stderr) => done(error, stdout.toString(), stderr.toString()));
};

export function locate(run: Run = execute): Promise<Location> {
  return new Promise<Location>((resolve, reject) => run(helper, [], { timeout: 15_000 }, (error, stdout, stderr) => {
    if (error) return reject(new Error(stderr?.trim() || "定位超时；请允许 Voice Coffee 使用定位服务"));
    try {
      const location = JSON.parse(stdout);
      if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) throw new Error();
      resolve({ latitude: location.latitude, longitude: location.longitude });
    } catch { reject(new Error("位置数据无效")); }
  }));
}
