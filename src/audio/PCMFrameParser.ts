export const PCM_FRAME_BYTES = 640;

export class PCMFrameParser {
  #pending = new Uint8Array();

  push(chunk: Uint8Array): Uint8Array[] {
    const data = new Uint8Array(this.#pending.length + chunk.length);
    data.set(this.#pending);
    data.set(chunk, this.#pending.length);

    const frames: Uint8Array[] = [];
    let offset = 0;
    while (data.length - offset >= PCM_FRAME_BYTES) {
      frames.push(data.slice(offset, offset + PCM_FRAME_BYTES));
      offset += PCM_FRAME_BYTES;
    }
    this.#pending = data.slice(offset);
    return frames;
  }
}
