// 生成 public/version.json · by 林淮
// 每次构建都会换一个新的 buildId，网页靠它发现“有新发布了”，不再只看版本号。
// 用法：写进 package.json 的 prebuild：  node scripts/gen-version.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
const sh = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const logs = JSON.parse(readFileSync('public/update-log.json', 'utf8'));
const top = logs[0] || {};
const buildId = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || sh('git rev-parse HEAD') || String(Date.now())).slice(0, 12);
mkdirSync('public', { recursive: true });
writeFileSync('public/version.json', JSON.stringify({ buildId, version: top.version, logId: top.id, builtAt: new Date().toISOString() }, null, 2));
console.log('✓ version.json  build ' + buildId + '  v' + top.version);
