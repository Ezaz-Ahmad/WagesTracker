import sharp from "sharp";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- the production verifier is a directly executed ESM build script.
import { assertSameDecodedPng } from "../../../scripts/verify-ios-assets.mjs";

async function image(width: number, height: number, rgba: Uint8Array): Promise<Buffer> {
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

describe("cross-platform iOS asset verification", () => {
  it("rejects a one-pixel RGBA change even when dimensions match", async () => {
    const baselinePixels = new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255]);
    const changedPixels = new Uint8Array(baselinePixels);
    changedPixels[4] = 254;
    await expect(assertSameDecodedPng("icon.png", await image(2, 1, baselinePixels), await image(2, 1, changedPixels)))
      .rejects.toThrow("decoded RGBA pixel data differs");
  });

  it("rejects a dimension change before comparing pixels", async () => {
    await expect(assertSameDecodedPng(
      "splash.png",
      await image(1, 1, new Uint8Array([0, 0, 0, 255])),
      await image(2, 1, new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]))
    )).rejects.toThrow("dimensions changed from 1x1 to 2x1");
  });

  it("rejects transparency in a production app icon", async () => {
    const pixels = new Uint8Array([255, 0, 0, 254]);
    const png = await image(1, 1, pixels);
    await expect(assertSameDecodedPng("AppIcon.png", png, png, { requireOpaque: true }))
      .rejects.toThrow("production app icon contains transparency");
  });
});
