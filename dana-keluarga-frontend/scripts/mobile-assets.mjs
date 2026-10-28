import sharp from "sharp";
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

// Derive native assets from the existing vector logo; no new artwork is required.
const logo = await readFile(
  new URL("../public/logo-mark.svg", import.meta.url),
);
const root = path.resolve(import.meta.dirname, "..");
const res = path.join(root, "android/app/src/main/res");
const background = "#56b7c1";
const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [density, size] of Object.entries(sizes)) {
  const folder = path.join(res, `mipmap-${density}`);
  for (const name of ["ic_launcher", "ic_launcher_round"]) {
    await sharp(logo)
      .resize(size, size)
      .flatten({ background })
      .png()
      .toFile(path.join(folder, `${name}.png`));
  }
  const canvas = Math.round((size * 108) / 48);
  const mark = await sharp(logo)
    .resize(Math.round(canvas * 0.6))
    .png()
    .toBuffer();
  await sharp({
    create: {
      width: canvas,
      height: canvas,
      channels: 4,
      background: "#00000000",
    },
  })
    .composite([{ input: mark, gravity: "centre" }])
    .png()
    .toFile(path.join(folder, "ic_launcher_foreground.png"));
}
await writeFile(
  path.join(res, "values/ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="ic_launcher_background">${background}</color></resources>\n`,
);
const assets = path.join(root, "ios/App/App/Assets.xcassets");
await sharp(logo)
  .resize(1024, 1024)
  .flatten({ background })
  .png()
  .toFile(path.join(assets, "AppIcon.appiconset/AppIcon-512@2x.png"));
const splashLogo = await sharp(logo).resize(384).png().toBuffer();
const splash = await sharp({
  create: { width: 2732, height: 2732, channels: 3, background: "#f8f5ef" },
})
  .composite([{ input: splashLogo, gravity: "centre" }])
  .png()
  .toBuffer();
for (const name of await readdir(path.join(assets, "Splash.imageset"))) {
  if (name.endsWith(".png"))
    await writeFile(path.join(assets, "Splash.imageset", name), splash);
}
for (const dir of await readdir(res)) {
  if (!dir.startsWith("drawable")) continue;
  const file = path.join(res, dir, "splash.png");
  try {
    const { width, height } = await sharp(file).metadata();
    const mark = await sharp(logo)
      .resize(Math.round(Math.min(width, height) * 0.3))
      .png()
      .toBuffer();
    const output = await sharp({
      create: { width, height, channels: 3, background: "#f8f5ef" },
    })
      .composite([{ input: mark, gravity: "centre" }])
      .png()
      .toBuffer();
    await writeFile(file, output);
  } catch (error) {
    if (dir !== "drawable-v24") throw error;
  }
}
console.log("Ikon dan splash Android/iOS diperbarui dari logo Dana Keluarga.");
