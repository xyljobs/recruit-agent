import type { NextConfig } from 'next';

// 部署到共享域名子路径（如 https://example.com/zhaopin）时注入 NEXT_PUBLIC_BASE_PATH；
// 未设置时保持根路径部署，行为不变。
const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() || undefined;

const nextConfig: NextConfig = {
  output: 'standalone',
  basePath,
  devIndicators: false, // 隐藏开发模式左下角 Next.js Dev Tools 指示器
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*',
        pathname: '/**',
      },
    ],
  },
  // 页面 HTML 禁用浏览器缓存：重建重启后普通刷新即可看到新版本，
  // 无需手动强制刷新；/_next 静态资源与 /api 接口不受影响，仍保留原有缓存策略。
  async headers() {
    return [
      {
        source: '/((?!_next/|api/).*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'private, no-cache, no-store, must-revalidate',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
