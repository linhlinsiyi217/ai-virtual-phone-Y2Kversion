// 与 scripts/compare-ui.py 等价的本地比较器（本机没有 Python 时使用）
// 用法：
//   node scripts/compare-ui.cjs                                  # 依次比对 8 张画面
//   node scripts/compare-ui.cjs --base http://localhost:3000 --only library,profile
//   node scripts/compare-ui.cjs --base file:///F:/tmp/out --route "/{name}.html"
// 说明：需要 playwright-core 与 sharp；浏览器用 --exe 指定（默认找本机 chromium）。
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function load(name) {
  try {
    return require(name);
  } catch {
    return require(path.join(ROOT, "node_modules", name));
  }
}

const { chromium } = load("playwright-core");
const sharp = load("sharp");

const NAMES = ["library", "profile", "soul", "relations", "suggest1", "suggest3", "motion", "features"];
const FILES = Object.fromEntries(NAMES.map((n, i) => [n, `${i + 1}-${n}.png`]));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const base = arg("base", "http://localhost:3000");
const route = arg("route", "/dev/ui-preview?screen={name}");
const design = arg("design", path.join(ROOT, "design", "png"));
const selector = arg("selector", ".ph");
const only = arg("only", "");
const limit = Number(arg("limit", "9"));
const blur = Number(arg("blur", "10"));
const level = Number(arg("level", "16"));
const out = arg("out", path.join(ROOT, "design", "diff"));
const exe = arg("exe", process.env.CHROMIUM_PATH || "");

/** 本机装的无头浏览器路径，没指定时按常见位置找 */
function findChrome() {
  if (exe) return exe;
  const roots = [
    path.join(process.env.LOCALAPPDATA || "", "ms-playwright"),
    path.join(process.env.HOME || "", ".cache", "ms-playwright"),
  ];
  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root)) {
      if (!dir.startsWith("chromium")) continue;
      const hit = [
        path.join(root, dir, "chrome-win64", "chrome.exe"),
        path.join(root, dir, "chrome-linux", "chrome"),
        path.join(root, dir, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
      ].find((file) => fs.existsSync(file));
      if (hit) return hit;
    }
  }
  return undefined;
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: findChrome() });
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: 2 });

  let bad = 0;
  for (const name of only ? only.split(",") : NAMES) {
    const url = `${base.replace(/\/$/, "")}${route.replace("{name}", name)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(900);
    const el = await page.$(selector);
    if (!el) {
      console.log(`✗ ${name}: 找不到 ${selector}`);
      bad += 1;
      continue;
    }
    const minePng = await el.screenshot();
    const mineMeta = await sharp(minePng).metadata();
    const refPath = path.join(design, FILES[name]);
    const refMeta = await sharp(refPath).metadata();
    if (Math.abs(mineMeta.width / mineMeta.height - refMeta.width / refMeta.height) > 0.02) {
      console.log(`✗ ${name}: 尺寸比例不对 ${mineMeta.width}x${mineMeta.height} / ${refMeta.width}x${refMeta.height}`);
      bad += 1;
      continue;
    }
    const size = { width: refMeta.width, height: refMeta.height };
    const a = await sharp(minePng).grayscale().resize(size).blur(blur).raw().toBuffer();
    const b = await sharp(refPath).grayscale().resize(size).blur(blur).raw().toBuffer();
    const total = size.width * size.height;
    const heat = Buffer.alloc(total);
    let diffCount = 0;
    for (let i = 0; i < total; i += 1) {
      const d = Math.abs(a[i] - b[i]);
      if (d > level) diffCount += 1;
      heat[i] = Math.min(255, d * 6);
    }
    const pct = (diffCount / total) * 100;
    const ok = pct <= limit;
    if (!ok) bad += 1;
    await sharp(heat, { raw: { width: size.width, height: size.height, channels: 1 } })
      .png()
      .toFile(path.join(out, `diff-${name}.png`));
    console.log(
      `${ok ? "✓" : "✗"} ${name.padEnd(10)} 差异 ${pct.toFixed(2).padStart(6)}%  (允许 ${limit}%)${ok ? "" : ` → 看 ${out}/diff-${name}.png`}`,
    );
  }

  await browser.close();
  console.log(bad ? `\n还有 ${bad} 张不一致，改完再跑一遍` : "\n全部一致");
  process.exit(bad ? 1 : 0);
})();
