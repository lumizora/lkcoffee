import { expect, test } from "bun:test";
import { PCMFrameParser } from "../../src/audio/PCMFrameParser";

test("emits strict 640-byte frames across chunk boundaries", () => {
  const parser = new PCMFrameParser();

  expect(parser.push(new Uint8Array(960)).map((frame) => frame.byteLength)).toEqual([640]);
  expect(parser.push(new Uint8Array(320)).map((frame) => frame.byteLength)).toEqual([640]);
});
