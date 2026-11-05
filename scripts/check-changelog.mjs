// 更新日志检查 · by 林淮
// 作用：改了功能却没写更新日志，或日志里写了代码，就报错，AI 必须补完才能通过。
// 用法：node scripts/check-changelog.mjs   （已写进 npm run check:changelog 和 prebuild）
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const LOG = 'public/update-log.json';   // 日志文件的位置（放在 public 里，网页才能读到）
const FOREIGN = ['LiTot', 'Litot'];      // 别的项目的名字：出现在日志里就报错（需要时自己往里加）
const IGNORE = /^(.*\.md$|\.github\/|\.trae\/|scripts\/|package-lock\.json$|\.gitignore$)|(^|\/)(update-log|version)\.json$/;
const sh = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const errs = [];
const fail = (m) => errs.push('✗ ' + m);

if (!existsSync(LOG)) { console.error('✗ 找不到 ' + LOG + '。请先按 UPDATE_POPUP_GUIDE.md 建立更新日志。'); process.exit(1); }
let logs; try { logs = JSON.parse(readFileSync(LOG, 'utf8')); } catch (e) { console.error('✗ ' + LOG + ' 不是合法的 JSON：' + e.message); process.exit(1); }
const top = logs[0] || {};

/* 1. 最新一条的格式 */
if (!/^\d+\.\d+\.\d+$/.test(top.version || '')) fail('最新一条缺少版本号 version（格式 1.3.0）');
if (!/^\d{4}-\d{2}-\d{2}$/.test(top.date || '')) fail('最新一条缺少日期 date（格式 2026-11-04）');
if (!/^\d{8}-\d+$/.test(top.id || '')) fail('最新一条缺少 id（格式 20261104-1，日期加当天第几次更新，每次发布都要新的）');
if (logs.slice(1).some((l) => l.id === top.id)) fail('最新一条的 id 和旧的重复了，每次发布 id 都要不一样');
if (!top.title) fail('最新一条缺少 title（一句话概括这次更新）');
if (!Array.isArray(top.apps) || !top.apps.length) fail('最新一条没有 apps（哪个应用更新了什么）');
const vn = (v) => String(v).split('.').map(Number);
const gt = (a, b) => { const x = vn(a), y = vn(b); for (let i = 0; i < 3; i++) if ((x[i]||0) !== (y[i]||0)) return (x[i]||0) > (y[i]||0); return false; };
if (logs[1] && !gt(top.version, logs[1].version)) fail('最新一条的版本号必须比上一条大（现在是 ' + top.version + ' 对 ' + logs[1].version + '）');

/* 2. 逐条检查：大白话、够详细、不许出现代码 */
const CODE = /`|\.(css|tsx?|jsx?|json|html|mjs)\b|className|function\s*\(|=>|<\/?\w+>|\{\s*\w+\s*:|\b(const|let|var|import|export|px|z-index|padding|margin|flex|props|state|hook)\b/i;
(top.apps || []).forEach((a) => {
  if (!a.app) fail('有一块 apps 缺少应用名 app');
  (a.changes || []).forEach((c, i) => {
    const where = '「' + (a.app || '?') + '」第 ' + (i + 1) + ' 条';
    if (!['new', 'improve', 'fix'].includes(c.type)) fail(where + '：type 只能是 new / improve / fix');
    if (!c.text || c.text.length < 20) fail(where + '：text 太短，要写详细——说清楚之前什么样、现在什么样（至少 20 个字）');
    if (FOREIGN.some((w) => ((c.head||'') + (c.text||'') + (a.app||'')).includes(w))) fail(where + '：出现了别的项目的内容。更新日志只能写这个项目这次真正改了什么（对照 git diff），不能照抄参考图或别的项目');
    if (CODE.test((c.head || '') + ' ' + (c.text || ''))) fail(where + '：里面出现了代码/文件名/样式词，更新日志必须写成大白话，不许写代码');
  });
});

/* 3. 版本号一致（有 package.json 时） */
if (existsSync('package.json')) { try { const pv = JSON.parse(readFileSync('package.json', 'utf8')).version; if (pv && top.version && pv !== top.version) fail('package.json 的版本是 ' + pv + '，更新日志最新是 ' + top.version + '，两边要一致'); } catch {} }

/* 4. 改了功能文件却没动日志（线上构建环境跳过，只在本地检查） */
if (!(process.env.CI || process.env.VERCEL || process.env.GITHUB_ACTIONS) && sh('git rev-parse --is-inside-work-tree') === 'true') {
  const last = sh('git log -1 --format=%H -- ' + LOG);
  const set = new Set();
  if (last) sh('git diff --name-only ' + last + '..HEAD').split('\n').forEach((f) => f && set.add(f));
  sh('git status --porcelain').split('\n').forEach((l) => { if (l.trim()) set.add(l.slice(3).split(' -> ').pop().replace(/"/g, '')); });
  const logTouched = set.has(LOG);
  const real = [...set].filter((f) => !IGNORE.test(f));
  if (real.length && !logTouched) fail('改了 ' + real.length + ' 个功能文件（如 ' + real.slice(0, 3).join('、') + '），但没有在 ' + LOG + ' 最前面加新的更新记录。请按 UPDATE_POPUP_GUIDE.md 补上并升版本号。');
}

if (errs.length) { console.error('\n更新日志检查没通过：\n' + errs.join('\n') + '\n\n这一步没过，任务就不算完成。补好后重新运行 npm run check:changelog。\n'); process.exit(1); }
console.log('✓ 更新日志检查通过（最新 v' + top.version + '）');
