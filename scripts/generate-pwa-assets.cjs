// One-off PWA asset generator — run with `node scripts/generate-pwa-assets.cjs`
// whenever the source icon (public/favicon.png) changes. Produces:
//  - Standard + maskable manifest icons (public/icons/icon-*.png)
//  - iOS home-screen icon (public/icons/apple-touch-icon.png)
//  - iOS apple-touch-startup-image launch screens for the current device
//    lineup (public/icons/splash/*.png) — iOS does not synthesize its own
//    splash screen from the manifest the way Android/Chrome does, so without
//    these the app flashes blank white before SplashScreen.tsx can mount.
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'public', 'favicon.png');
const ICONS_DIR = path.join(ROOT, 'public', 'icons');
const SPLASH_DIR = path.join(ICONS_DIR, 'splash');

const SPLASH_BG = '#0A2540'; // matches theme-color + SplashScreen.tsx dark background
const ICON_PAD_BG = { r: 241, g: 244, b: 246 }; // sampled from favicon.png's own backdrop

fs.mkdirSync(ICONS_DIR, { recursive: true });
fs.mkdirSync(SPLASH_DIR, { recursive: true });

// Standard (non-maskable) manifest icons — direct resize, no padding change.
const STANDARD_SIZES = [192, 512];

// Maskable icons need the artwork to sit inside the center ~80% safe zone,
// so we pad the source out before resizing rather than just downscaling it.
const MASKABLE_SIZES = [192, 512];
const MASKABLE_PAD_RATIO = 0.22; // extra margin added on each side

// iOS home screen icon (no alpha, no pre-rounding needed — iOS masks it).
const APPLE_TOUCH_ICON_SIZE = 180;

// Portrait apple-touch-startup-image sizes covering the current device
// lineup: [cssWidth, cssHeight, dpr, label]
const SPLASH_DEVICES = [
  [440, 956, 3, 'iphone-16-pro-max'],
  [402, 874, 3, 'iphone-16-pro'],
  [430, 932, 3, 'iphone-15-plus-15-pro-max-14-pro-max'],
  [393, 852, 3, 'iphone-15-15-pro-14-pro'],
  [428, 926, 3, 'iphone-14-plus-13-pro-max-12-pro-max'],
  [390, 844, 3, 'iphone-14-13-13-pro-12-12-pro'],
  [414, 896, 3, 'iphone-11-pro-max-xs-max'],
  [414, 896, 2, 'iphone-11-xr'],
  [375, 812, 3, 'iphone-x-xs-11pro-12mini-13mini'],
  [414, 736, 3, 'iphone-8plus-7plus-6splus'],
  [375, 667, 2, 'iphone-8-7-6s-se2-se3'],
  [320, 568, 2, 'iphone-se1-5s'],
  [1024, 1366, 2, 'ipad-pro-12.9'],
  [834, 1194, 2, 'ipad-pro-11-air'],
  [834, 1112, 2, 'ipad-air-pro-10.5'],
  [768, 1024, 2, 'ipad-mini-9.7'],
  [810, 1080, 2, 'ipad-10.2'],
];

async function makeStandardIcons() {
  for (const size of STANDARD_SIZES) {
    await sharp(SOURCE).resize(size, size).png().toFile(path.join(ICONS_DIR, `icon-${size}.png`));
  }
}

async function makeMaskableIcons() {
  for (const size of MASKABLE_SIZES) {
    const innerSize = Math.round(size * (1 - MASKABLE_PAD_RATIO * 2));
    const pad = Math.round((size - innerSize) / 2);
    const inner = await sharp(SOURCE).resize(innerSize, innerSize).toBuffer();
    await sharp({
      create: { width: size, height: size, channels: 3, background: ICON_PAD_BG },
    })
      .composite([{ input: inner, left: pad, top: pad }])
      .png()
      .toFile(path.join(ICONS_DIR, `icon-maskable-${size}.png`));
  }
}

async function makeAppleTouchIcon() {
  await sharp(SOURCE)
    .resize(APPLE_TOUCH_ICON_SIZE, APPLE_TOUCH_ICON_SIZE)
    .flatten({ background: ICON_PAD_BG })
    .png()
    .toFile(path.join(ICONS_DIR, 'apple-touch-icon.png'));
}

async function makeSplashScreens() {
  const manifest = [];
  for (const [cssW, cssH, dpr, label] of SPLASH_DEVICES) {
    const w = cssW * dpr;
    const h = cssH * dpr;
    const iconSize = Math.round(Math.min(w, h) * 0.3);
    const icon = await sharp(SOURCE).resize(iconSize, iconSize).toBuffer();
    const fileName = `splash-${label}-${w}x${h}.png`;
    await sharp({
      create: { width: w, height: h, channels: 3, background: SPLASH_BG },
    })
      .composite([{ input: icon, left: Math.round((w - iconSize) / 2), top: Math.round((h - iconSize) / 2) }])
      .png()
      .toFile(path.join(SPLASH_DIR, fileName));
    manifest.push({ cssW, cssH, dpr, fileName });
  }
  fs.writeFileSync(path.join(SPLASH_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

(async () => {
  await makeStandardIcons();
  await makeMaskableIcons();
  await makeAppleTouchIcon();
  const splashManifest = await makeSplashScreens();
  console.log(`Generated ${STANDARD_SIZES.length} standard icons, ${MASKABLE_SIZES.length} maskable icons, 1 apple-touch-icon, ${splashManifest.length} splash screens.`);
})();
