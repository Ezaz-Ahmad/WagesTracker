import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(`${root}/assets`, { recursive: true });

await sharp(`${root}/assets/source/icon.svg`, { density: 144 })
  .resize(1024, 1024)
  .png({ compressionLevel: 9, palette: true })
  .toFile(`${root}/assets/icon-only.png`);

await sharp(`${root}/assets/source/splash.svg`, { density: 144 })
  .resize(2732, 2732)
  .png({ compressionLevel: 9, palette: true })
  .toFile(`${root}/assets/splash.png`);
