# 界面对比 · by 林淮
# 作用：把项目里做出来的页面截图，和设计图逐张对比，告诉你哪一张还不一样、差在哪里，并生成“差异图”。
# 用法：
#   pip install playwright pillow numpy ; playwright install chromium
#   python scripts/compare-ui.py --base http://localhost:3000 --route "/dev/ui-preview?screen={name}"
# 要求：预览页里每个画面都用 design/sample-data.json 的示例数据，外面套设计稿里的 <div class="ph">（390x844 的手机外框）。
# 说明：对比前会先把两张图都模糊一点，避免“字体不同导致文字边缘不一样”被误判；形状、位置、圆角、颜色、间距不一样就会被抓出来。
import argparse, asyncio, io, pathlib, sys
import numpy as np
from PIL import Image, ImageFilter
from playwright.async_api import async_playwright

NAMES = ['library', 'profile', 'soul', 'relations', 'suggest1', 'suggest3', 'motion', 'features']
FILES = {n: f'{i+1}-{n}.png' for i, n in enumerate(NAMES)}
ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:3000')
ap.add_argument('--route', default='/dev/ui-preview?screen={name}')
ap.add_argument('--design', default='design/png')
ap.add_argument('--selector', default='.ph')
ap.add_argument('--only', default='')
ap.add_argument('--limit', type=float, default=9.0, help='允许的差异百分比（参考值，真正的判断看差异图）')
ap.add_argument('--blur', type=float, default=10)
ap.add_argument('--level', type=int, default=16)
ap.add_argument('--out', default='design/diff')
a = ap.parse_args()

def prep(im, size):
    return np.asarray(im.convert('L').resize(size).filter(ImageFilter.GaussianBlur(a.blur)), dtype=np.int16)

async def main():
    out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)
    bad = 0
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': 900, 'height': 1000}, device_scale_factor=2)
        for n in (a.only.split(',') if a.only else NAMES):
            url = a.base.rstrip('/') + a.route.format(name=n) if not a.base.startswith('file:') else a.base
            await pg.goto(url); await pg.wait_for_timeout(900)
            el = await pg.query_selector(a.selector) if not a.base.startswith('file:') else (await pg.query_selector_all('.it > .ph, .it > .pn'))[NAMES.index(n)]
            if not el: print(f'✗ {n}: 找不到 {a.selector}'); bad += 1; continue
            mine = Image.open(io.BytesIO(await el.screenshot())).convert('RGB')
            ref = Image.open(pathlib.Path(a.design) / FILES[n]).convert('RGB')
            size = ref.size
            if abs(mine.size[0] / mine.size[1] - ref.size[0] / ref.size[1]) > 0.02: print(f'✗ {n}: 尺寸比例不对 {mine.size} / {ref.size}'); bad += 1; continue
            d = np.abs(prep(mine, size) - prep(ref, size))
            pct = float((d > a.level).mean() * 100)
            ok = pct <= a.limit; bad += (not ok)
            heat = Image.fromarray(np.clip(d * 6, 0, 255).astype('uint8')); heat.save(out / f'diff-{n}.png')
            print(('✓' if ok else '✗'), f'{n:10s} 差异 {pct:5.2f}%  (允许 {a.limit}%)', '' if ok else f'→ 看 {out}/diff-{n}.png，越亮越不一样')
        await b.close()
    print('\n全部一致' if not bad else f'\n还有 {bad} 张不一致，改完再跑一遍'); sys.exit(1 if bad else 0)
asyncio.run(main())
