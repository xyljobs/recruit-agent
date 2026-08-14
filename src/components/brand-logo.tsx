import { useId } from 'react';

/**
 * 统一品牌 Logo：蓝色渐变圆角底 + 白色"靶心环内的人"标记，
 * 寓意"以人才为中心的精准决策"。与 src/app/icon.svg (favicon) 同一设计。
 */
export function BrandLogo({ className }: { className?: string }) {
  const gradientId = `brand-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="人才决策Agent"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3B82F6" />
          <stop offset="1" stopColor="#1D4ED8" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="14" fill={`url(#${gradientId})`} />
      {/* 靶心环：精准决策 */}
      <circle cx="32" cy="32" r="18" fill="none" stroke="#FFFFFF" strokeWidth="4.5" />
      {/* 环内的人：以人才为中心 */}
      <circle cx="32" cy="27" r="5.25" fill="#FFFFFF" />
      <path d="M23 41.5c0-6 4-9.75 9-9.75s9 3.75 9 9.75z" fill="#FFFFFF" />
    </svg>
  );
}
