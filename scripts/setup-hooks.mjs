// 让提交前的更新日志检查自动生效（npm install 时会自动运行，没有 git 也不会报错）
import { execSync } from 'node:child_process';
try { execSync('git config core.hooksPath .githooks', { stdio: 'ignore' }); console.log('✓ 提交检查已启用'); } catch {}
