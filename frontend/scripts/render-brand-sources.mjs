import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(`${root}/assets`, { recursive: true });

async function writePng(pipeline, path) {
  await writeFile(path, await pipeline.png({ compressionLevel: 9 }).toBuffer());
}

// The approved artwork is the source of truth. Generate every shipping
// rendition from it, including both native and resolved in-app appearances.
for (const [appearance, background] of [["graphite", "#f3f2f2"], ["dark", "#000000"]]) {
  const source = `${root}/assets/source/logo-${appearance}.png`;
  const icon = await sharp(source).resize(1024, 1024).removeAlpha()
    .png({ compressionLevel: 9 }).toBuffer();
  await writeFile(`${root}/assets/${appearance === "graphite" ? "icon-only" : "icon-dark"}.png`, icon);
  await writePng(sharp(source).resize(128, 128), `${root}/public/logo-${appearance}.png`);
  await writePng(sharp(source).resize(32, 32), `${root}/public/favicon${appearance === "dark" ? "-dark" : ""}.png`);
  const splashLogo = await sharp(icon).resize(680, 680).toBuffer();
  await writePng(sharp({ create: { width: 2732, height: 2732, channels: 3, background } })
    .composite([{ input: splashLogo, gravity: "centre" }]), `${root}/assets/splash${appearance === "dark" ? "-dark" : ""}.png`);
}

for (const [filename, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  await writePng(sharp(`${root}/assets/source/logo-graphite.png`).resize(size, size).removeAlpha(), `${root}/public/${filename}`);
}
