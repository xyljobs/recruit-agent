/**
 * 种子数据脚本 - Demo数据初始化
 * 运行: pnpm seed:demo
 * 核心逻辑位于 src/lib/demo/demo-data.ts，与 /api/demo/reset 共用，保证页面与命令行基线一致。
 */

import dotenv from 'dotenv';
import path from 'path';

// 优先加载 .env.local，再 fallback .env
const envLocal = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envLocal });
dotenv.config(); // fallback to .env
import { seedDemoData } from '../src/lib/demo/demo-data';

// 仅在直接运行时执行
const isDirectRun = (() => {
  if (!process.argv[1]) return false;
  const invokedPath = path.resolve(process.argv[1]);
  const modulePath = typeof __filename !== 'undefined' ? path.resolve(__filename) : '';
  return invokedPath.toLowerCase() === modulePath.toLowerCase();
})();

if (isDirectRun) {
  seedDemoData()
    .then(() => {
      console.log('\n种子脚本执行完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('种子脚本执行失败:', error);
      process.exit(1);
    });
}

export { seedDemoData };
