import { defineConfig } from 'tsup';

// Worker 独立打包配置：Docker 镜像（Next standalone）不含 node_modules，
// 必须把 zod / @supabase/supabase-js 等依赖一并 bundle 进 dist-workers。
export default defineConfig({
  entry: ['scripts/match-batch-worker.ts', 'scripts/integration-outbox-worker.ts'],
  format: ['cjs'],
  platform: 'node',
  outDir: 'dist-workers',
  clean: true,
  noExternal: [/.*/],
});
