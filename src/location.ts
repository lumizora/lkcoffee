import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const helper = fileURLToPath(new URL("../native/LocationHelper.app/Contents/MacOS/LocationHelper", import.meta.url));

export function locate(run = execFile) {
  return new Promise((resolve, reject) => run(helper, [], { timeout: 15_000 }, (error, stdout, stderr) => {
    if (error) return reject(new Error(stderr?.trim() || "定位超时；请允许 Voice Coffee 使用定位服务"));
    try {
      const location = JSON.parse(stdout);
      if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) throw new Error();
      resolve({ latitude: location.latitude, longitude: location.longitude });
    } catch { reject(new Error("位置数据无效")); }
  }));
}
