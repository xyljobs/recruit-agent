/**
 * basePath 工具。
 *
 * 部署到共享域名的子路径（如 https://example.com/zhaopin）时，通过
 * NEXT_PUBLIC_BASE_PATH=/zhaopin 启用。Next.js 会自动为 Link / router.push /
 * redirect()（next/navigation）/ 静态资源补前缀，但原生 fetch、window.location、
 * NextResponse.redirect 与原生 <a href> 不会，需要用 withBasePath 手动补齐。
 * 未设置时所有函数保持恒等行为，不影响根路径部署。
 */
const RAW_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH?.trim().replace(/\/+$/, '') ?? '';

export function getBasePath(): string {
  return RAW_BASE_PATH;
}

/** 给以 `/` 开头的站内路径补上 basePath；已含前缀或非站内路径原样返回。 */
export function withBasePath(path: string): string {
  if (!RAW_BASE_PATH || !path.startsWith('/')) {
    return path;
  }
  if (path === RAW_BASE_PATH || path.startsWith(`${RAW_BASE_PATH}/`)) {
    return path;
  }
  return `${RAW_BASE_PATH}${path}`;
}
