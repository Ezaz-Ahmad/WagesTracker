import { copyFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const frontend = fileURLToPath(new URL("../", import.meta.url));
const catalog = fileURLToPath(new URL("../../ios/App/App/Assets.xcassets/", import.meta.url));
const darkAppearance = [{ appearance: "luminosity", value: "dark" }];

// capacitor-assets generates the default catalog. Append the approved dark
// renditions after each generation so CI cannot silently erase them.
const iconFolder = `${catalog}/AppIcon.appiconset`;
const iconContents = JSON.parse(await readFile(`${iconFolder}/Contents.json`, "utf8"));
iconContents.images = iconContents.images.filter(image => !image.appearances);
iconContents.images.push({ idiom: "universal", size: "1024x1024", filename: "AppIcon-Dark.png", platform: "ios", appearances: darkAppearance });
await copyFile(`${frontend}/assets/icon-dark.png`, `${iconFolder}/AppIcon-Dark.png`);
await writeFile(`${iconFolder}/Contents.json`, `${JSON.stringify(iconContents, null, 2)}\n`);

// capacitor-assets already registers splash-dark.png with luminosity=dark.
