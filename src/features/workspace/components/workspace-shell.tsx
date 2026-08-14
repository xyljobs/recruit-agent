'use client';

import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Building2,
  ChevronRight,
  Database,
  Library,
  LogOut,
  ShieldCheck,
  User,
  UserCog,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { BrandLogo } from '@/components/brand-logo';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { authFetch, clearAuthToken } from '@/lib/auth-client';
import { cn } from '@/lib/utils';
import { WorkspaceDataProvider } from '../hooks/use-workspace-data';
import type { WorkspaceUser } from '../types';

// 招聘决策流程步骤：按业务先后顺序串联展示
const FLOW_STEPS = [
  { href: '/jobs', label: '职位与标准', desc: 'JD 解析 · 定标准' },
  { href: '/shortlists', label: '候选人短名单', desc: '智能匹配 · 人工决策' },
  { href: '/outcomes', label: '沟通与结果', desc: '话术 · 触达 · 复盘' },
  { href: '/analytics', label: '决策看板', desc: '指标 · 校准' },
] as const;

// 配置类入口，不属于业务流程，独立放在右侧
const CONFIG_NAV_ITEMS = [
  { href: '/candidates', label: '候选人库', icon: Users },
  { href: '/interview-bank', label: '面试题库', icon: Library },
  { href: '/data-sources', label: '数据源', icon: Database },
] as const;

// 仅管理员可见的配置入口
const ADMIN_NAV_ITEMS = [
  { href: '/team', label: '团队成员', icon: UserCog },
] as const;

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<WorkspaceUser | null>(null);
  const [userLoading, setUserLoading] = useState(true);

  const loadUser = useCallback(async () => {
    try {
      const response = await authFetch('/api/auth/me');
      const result = await response.json();
      if (result.success && result.authenticated) {
        if (result.data.must_change_password === true) {
          router.replace('/change-password');
          return;
        }
        setUser(result.data);
      } else {
        clearAuthToken();
        router.push('/login');
      }
    } catch {
      router.push('/login');
    } finally {
      setUserLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadUser();
  }, [loadUser]);

  async function handleLogout() {
    try {
      await authFetch('/api/auth/logout', { method: 'POST' });
      clearAuthToken();
      router.push('/login');
    } catch {
      toast.error('登出失败');
    }
  }

  // 组织切换 = 登出当前会话后重新登录目标组织，会话不跨租户复用
  async function handleSwitchOrganization(slug: string) {
    const currentSlug = user?.current_organization?.slug ?? '';
    if (!slug || slug === currentSlug) return;
    try {
      await authFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // 登出失败不阻断切换，跳转登录页后由用户重新认证
    }
    clearAuthToken();
    router.push(`/login?org=${encodeURIComponent(slug)}`);
  }

  if (userLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <WorkspaceDataProvider>
      <div className="min-h-screen bg-gray-50">
        <div className="sticky top-0 z-50 bg-white shadow-sm">
        <header className="border-b">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
            <Link href="/analytics" className="flex items-center gap-3">
              <BrandLogo className="h-10 w-10 drop-shadow-lg drop-shadow-blue-500/30" />
              <div>
                <h1 className="text-xl font-bold text-gray-900">人才决策Agent</h1>
                <p className="hidden text-xs text-gray-500 sm:block">
                  企业私有部署的招聘决策副驾驶
                </p>
              </div>
            </Link>
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="hidden border-blue-200 bg-blue-50 text-blue-700 sm:flex">
                人工决策优先
              </Badge>
              {user.organizations && user.organizations.length > 0 && (
                <Select
                  value={user.current_organization?.slug || undefined}
                  onValueChange={(value) => void handleSwitchOrganization(value)}
                >
                  <SelectTrigger
                    aria-label="当前组织，可切换"
                    title="当前组织（租户），点击切换"
                    className="h-9 w-auto max-w-52 gap-2 border-slate-200 bg-white"
                  >
                    <Building2 className="h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
                    <SelectValue placeholder={user.company || '选择组织'} />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {user.organizations.map((organization) => (
                      <SelectItem key={organization.id} value={organization.slug}>
                        {organization.name}
                        {organization.slug === user.current_organization?.slug ? '（当前）' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {user && (
                <div className="flex items-center gap-2 pl-3 border-l">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                    <User className="h-4 w-4 text-blue-600" />
                  </div>
                  <div className="hidden sm:block">
                    <p className="text-sm font-medium text-gray-900">{user.name}</p>
                    <p className="text-xs text-gray-500">
                      {user.email}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => router.push('/security')}
                    aria-label="账号安全"
                    title="账号安全"
                  >
                    <ShieldCheck className="h-4 w-4 text-gray-500" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleLogout}
                    aria-label="退出登录"
                    title="退出登录"
                  >
                    <LogOut className="h-4 w-4 text-gray-500" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        </header>

        <nav
          aria-label="招聘决策流程"
          className="max-w-7xl mx-auto overflow-x-auto px-4 py-3"
        >
          <div className="flex min-w-max items-stretch gap-2 sm:gap-3">
            {FLOW_STEPS.map((step, index) => {
              const isActive = pathname === step.href;
              return (
                <Fragment key={step.href}>
                  {index > 0 && (
                    <div aria-hidden="true" className="flex items-center">
                      <div className="h-px w-4 bg-gray-300 sm:w-8" />
                      <ChevronRight className="-ml-1 h-4 w-4 text-gray-300" />
                    </div>
                  )}
                  <Link
                    href={step.href}
                    aria-label={`流程第 ${index + 1} 步：${step.label}`}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'group flex items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors',
                      isActive
                        ? 'border-blue-200 bg-blue-50 shadow-sm'
                        : 'border-gray-200 bg-white hover:border-blue-200 hover:bg-blue-50/50',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                        isActive
                          ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/30'
                          : 'bg-gray-100 text-gray-500 group-hover:bg-blue-100 group-hover:text-blue-600',
                      )}
                    >
                      {index + 1}
                    </span>
                    <span className="flex flex-col">
                      <span
                        className={cn(
                          'text-sm font-medium leading-tight',
                          isActive ? 'text-blue-700' : 'text-gray-800',
                        )}
                      >
                        {step.label}
                      </span>
                      <span
                        className={cn(
                          'text-[11px] leading-tight',
                          isActive ? 'text-blue-500' : 'text-gray-400',
                        )}
                      >
                        {step.desc}
                      </span>
                    </span>
                  </Link>
                </Fragment>
              );
            })}

            <div className="ml-1 flex items-center gap-1 border-l border-gray-200 pl-3 sm:ml-2">
              {[...CONFIG_NAV_ITEMS, ...(user.role === 'admin' ? ADMIN_NAV_ITEMS : [])].map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-label={item.label}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-medium transition-colors',
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </nav>
        </div>

        <main className="max-w-7xl mx-auto px-4 py-6">
          {children}
        </main>
      </div>
    </WorkspaceDataProvider>
  );
}
