/**
 * 演示数据一键重置脚本
 * 运行: pnpm seed:reset               # 清空演示业务数据并自动重跑 seed，恢复基线
 * 运行: pnpm seed:reset -- --dry-run  # 仅预览各表将删除的记录数，不实际删除
 *
 * 范围：
 * - 目标组织：主演示组织（slug: drill）+ 第二演示组织（slug: lanwan-precision）
 * - 删除：候选人、职位、匹配、短名单、复盘、校准、搜索、Boss 任务、
 *         简历批处理任务、集成连接、邀请、限流计数等全部业务数据
 * - 保留：组织（含 AI 执行模式与 approved_cloud_processors 审批）、账号、
 *         组织成员关系、登录会话、审计日志、钉钉 MCP 凭证与表格预设
 * 核心逻辑位于 src/lib/demo/demo-data.ts，与 /api/demo/reset 共用。
 */

import dotenv from 'dotenv';
import path from 'path';

// 优先加载 .env.local，再 fallback .env
const envLocal = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envLocal });
dotenv.config();
import { DEMO_ORG_SLUGS, resetDemoBusinessData, seedDemoData } from '../src/lib/demo/demo-data';

const DRY_RUN = process.argv.includes('--dry-run');

async function resetDemoData() {
  if (DRY_RUN) {
    console.log('🔍 DRY RUN 模式：仅预览删除范围，不实际删除任何数据\n');
  } else {
    console.log('开始重置演示数据...\n');
  }

  // 1. 定位演示组织并清空业务数据
  const result = await resetDemoBusinessData({ dryRun: DRY_RUN });
  console.log(`定位到演示组织：${result.orgs.map((org) => `“${org.name}”(slug: ${org.slug})`).join('、')}\n`);

  if (DRY_RUN) {
    console.log('各表将删除的记录数：');
    for (const stat of result.perTable) {
      console.log(`  - ${stat.table}: ${stat.count} 条`);
    }
    console.log('\n（DRY RUN 未做任何修改）');
    return;
  }

  for (const stat of result.perTable) {
    console.log(`  ✅ ${stat.table}: 删除 ${stat.count} 条`);
  }
  console.log(`\n业务数据清理完成，共删除 ${result.totalDeleted} 条记录`);

  // 2. 自动重跑 seed 恢复演示基线
  console.log('\n========================================');
  console.log('开始重跑 seed 恢复演示基线...');
  console.log('========================================');
  await seedDemoData();
}

// 仅在直接运行时执行
const isDirectRun = (() => {
  if (!process.argv[1]) return false;
  const invokedPath = path.resolve(process.argv[1]);
  const modulePath = typeof __filename !== 'undefined' ? path.resolve(__filename) : '';
  return invokedPath.toLowerCase() === modulePath.toLowerCase();
})();

if (isDirectRun) {
  resetDemoData()
    .then(() => {
      console.log('\n演示数据重置完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('演示数据重置失败:', error);
      process.exit(1);
    });
}
