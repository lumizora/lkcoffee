type HoldOptions = { initialDelayMs?: number; releaseDelayMs?: number };

export function createHoldRelease(release: () => void, { initialDelayMs = 600, releaseDelayMs = 100 }: HoldOptions = {}) {
  let timer: Timer | undefined;
  let repeating = false;
  return {
    pulse() {
      clearTimeout(timer);
      timer = setTimeout(() => { timer = undefined; repeating = false; release(); }, repeating ? releaseDelayMs : initialDelayMs);
      repeating = true;
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
      repeating = false;
    },
  };
}
