'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BriefcaseBusiness,
  Database,
  FileText,
  LogOut,
  MessageSquareText,
  ShieldCheck,
  Target,
  TrendingUp,
  User,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { authFetch, clearAuthToken } from '@/lib/auth-client';
import { cn } from '@/lib/utils';
import { WorkspaceDataProvider } from '../hooks/use-workspace-data';
import type { WorkspaceUser } from '../types';

const NAV_ITEMS = [
  { href: '/analytics', label: '决策看板', icon: TrendingUp },
  { href: '/jobs', label: '职位与标准', icon: FileText },
  { href: '/shortlists', label: '候选人短名单', icon: BriefcaseBusiness },
  { href: '/outcomes', label: '沟通与结果', icon: MessageSquareText },
  { href: '/data-sources', label: '数据源', icon: Database },
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
        <header className="bg-white border-b sticky top-0 z-50 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
            <Link href="/analytics" className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30">
                <Target className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">智聘Agent</h1>
                <p className="hidden text-xs text-gray-500 sm:block">
                  企业私有部署的招聘决策副驾驶
                </p>
              </div>
            </Link>
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="hidden border-blue-200 bg-blue-50 text-blue-700 sm:flex">
                人工决策优先
              </Badge>
              {user && (
                <div className="flex items-center gap-2 pl-3 border-l">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                    <User className="h-4 w-4 text-blue-600" />
                  </div>
                  <div className="hidden sm:block">
                    <p className="text-sm font-medium text-gray-900">{user.name}</p>
                    <p className="text-xs text-gray-500">
                      {user.company || user.email}
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

        <main className="max-w-7xl mx-auto px-4 py-6">
          <nav
            aria-label="业务工作区"
            className="mb-6 overflow-x-auto rounded-lg bg-white p-1 shadow-sm"
          >
            <div className="flex min-w-max gap-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-label={item.label}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'flex min-w-24 flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium text-gray-600 transition-colors sm:min-w-32 sm:text-sm',
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'hover:bg-gray-50 hover:text-gray-900',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>

          {children}
        </main>
      </div>
    </WorkspaceDataProvider>
  );
}
