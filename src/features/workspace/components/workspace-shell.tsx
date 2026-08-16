'use client';

import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Building2,
  ChevronDown,
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
import { BrandLogo } from '@/components/brand-logo';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { authFetch, clearAuthToken } from '@/lib/auth-client';
import { cn } from '@/lib/utils';
import { WorkspaceDataProvider } from '../hooks/use-workspace-data';
import type { WorkspaceUser } from '../types';

// 招聘决策流程步骤：按业务先后顺序串联展示
const FLOW_STEPS = [
  { href: '/jobs', label: '职位与标准', desc: 'JD 解析 · 定标准' },
  { href: '/candidates', label: '候选人库', desc: '简历入库 · 绑定职位' },
  { href: '/shortlists', label: '候选人短名单', desc: '智能匹配 · 人工决策' },
  { href: '/interview-guides', label: '面试提纲', desc: '提纲编辑 · 记录回答' },
  { href: '/outcomes', label: '沟通与结果', desc: '话术 · 触达 · 复盘' },
  { href: '/analytics', label: '决策看板', desc: '指标 · 校准' },
] as const;

// 配置类入口收进 header「管理」菜单：不属于业务流程，低频访问，不再占用流程导航行
const CONFIG_NAV_ITEMS = [
  { href: '/talent-pool', label: '人才资源池', icon: Users },
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

  // 会话失效时必须同时清除 HttpOnly cookie：仅清 sessionStorage 的话，
  // proxy 的 /login 已登录守卫仍会判定已登录并把登录页 307 弹回工作区，
  // 与 /api/auth/me 的 401 形成重定向死循环（页面永久"加载中"）。
  // logout 接口在任何情况下都会清除 cookie，失败也不阻断跳转登录页。
  const clearLocalSession = useCallback(async () => {
    try {
      await authFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // 登出接口不可用时仍清除本地 token，由用户重新认证
    }
    clearAuthToken();
  }, []);

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
        await clearLocalSession();
        router.push('/login');
      }
    } catch {
      await clearLocalSession();
      router.push('/login');
    } finally {
      setUserLoading(false);
    }
  }, [router, clearLocalSession]);

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
      <div className="min-h-screen flex items-center justify-center bg-muted/50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <WorkspaceDataProvider>
      <div className="min-h-screen bg-muted/50">
        <div className="sticky top-0 z-50 bg-card shadow-sm">
        <header className="border-b">
          {/* 三段式 header：logo 靠左 · 配置入口居中 · 组织与账号靠右 */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-4 px-6 py-2">
            <Link href="/analytics" className="flex min-w-0 items-center gap-3 justify-self-start">
              <BrandLogo className="h-8 w-8 shrink-0 drop-shadow-lg drop-shadow-blue-500/30" />
              <h1 className="truncate text-lg font-bold leading-tight text-foreground">人才决策Agent <span className="mx-1 font-normal text-muted-foreground">|</span> 人才智能匹配系统</h1>
            </Link>
            {/* 配置类入口平铺居中：不属于业务流程，低频访问 */}
            <div className="flex items-center justify-self-center">
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
                      'flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
            <div className="flex min-w-0 items-center justify-end gap-2 justify-self-end sm:gap-3">
              {/* 组织切换收进账号菜单（切换组织子菜单）：顶栏不再常驻组织切换器 */}
              {/* 账号操作收进下拉菜单：顶栏只保留头像+身份，安全设置/退出以带文字菜单项展示 */}
              {user && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      className="h-auto min-w-0 gap-2 px-1.5 py-1"
                      aria-label="账号菜单"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15">
                        <User className="h-4 w-4 text-primary" />
                      </div>
                      <div className="hidden min-w-0 text-left lg:block">
                        <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                      </div>
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel className="font-normal">
                      <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                      <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground">
                        <Building2 className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
                        {user.current_organization?.name ?? user.company ?? '当前组织'}
                      </p>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {user.organizations && user.organizations.length > 1 && (
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger aria-label="切换组织">
                          <Building2 className="h-4 w-4" aria-hidden="true" />
                          切换组织
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          {user.organizations.map((organization) => {
                            const isCurrent = organization.slug === user.current_organization?.slug;
                            return (
                              <DropdownMenuItem
                                key={organization.id}
                                disabled={isCurrent}
                                onClick={() => void handleSwitchOrganization(organization.slug)}
                              >
                                {organization.name}
                                {isCurrent ? '（当前）' : ''}
                              </DropdownMenuItem>
                            );
                          })}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    )}
                    <DropdownMenuItem onClick={() => router.push('/security')}>
                      <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                      账号安全
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleLogout}
                      className="text-red-600 focus:text-red-600"
                    >
                      <LogOut className="h-4 w-4" aria-hidden="true" />
                      退出登录
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </header>

        <nav
          aria-label="招聘决策流程"
          className="px-6 py-3"
        >
          <div className="flex flex-wrap items-stretch gap-2 sm:gap-3">
            {FLOW_STEPS.map((step, index) => {
              const isActive = pathname === step.href;
              return (
                <Fragment key={step.href}>
                  {index > 0 && (
                    <div aria-hidden="true" className="hidden items-center lg:flex">
                      <div className="h-px w-4 bg-border sm:w-8" />
                      <ChevronRight className="-ml-1 h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <Link
                    href={step.href}
                    aria-label={`流程第 ${index + 1} 步：${step.label}`}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'group flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors sm:gap-2.5 sm:px-3',
                      isActive
                        ? 'border-primary/40 bg-primary/10 shadow-sm'
                        : 'border-border bg-card hover:border-primary/40 hover:bg-primary/5',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                        isActive
                          ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/30'
                          : 'bg-muted text-muted-foreground group-hover:bg-primary/15 group-hover:text-primary',
                      )}
                    >
                      {index + 1}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span
                        className={cn(
                          'truncate text-sm font-medium leading-tight',
                          isActive ? 'text-primary' : 'text-foreground',
                        )}
                      >
                        {step.label}
                      </span>
                      <span
                        className={cn(
                          'hidden text-[11px] leading-tight lg:block',
                          isActive ? 'text-primary' : 'text-muted-foreground',
                        )}
                      >
                        {step.desc}
                      </span>
                    </span>
                  </Link>
                </Fragment>
              );
            })}
          </div>
        </nav>
        </div>

        <main className="px-6 pt-4 pb-12">
          <div>{children}</div>
        </main>

        {/* 贴底 footer，与登录页保持一致 */}
        <div className="fixed bottom-0 left-0 right-0 z-40 text-center py-2 text-xs text-muted-foreground bg-white/80">
          © 精密智造集团&nbsp;&nbsp;SINCE 2026
        </div>
      </div>
    </WorkspaceDataProvider>
  );
}
