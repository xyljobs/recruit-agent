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
};

export default nextConfig;
