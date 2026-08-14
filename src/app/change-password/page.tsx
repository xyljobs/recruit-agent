'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch, clearAuthToken, setAuthToken } from '@/lib/auth-client';
import { BrandLogo } from '@/components/brand-logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!form.currentPassword || !form.newPassword || !form.confirmPassword) {
      toast.error('请填写完整信息');
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      toast.error('两次输入的新密码不一致');
      return;
    }

    setLoading(true);
    try {
      const response = await authFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: form.currentPassword,
          newPassword: form.newPassword,
        }),
      });
      const result = await response.json();

      if (!result.success) {
        toast.error(result.error || '修改密码失败');
        return;
      }

      if (result.data?.token) {
        setAuthToken(result.data.token);
      }
      toast.success('密码已更新');
      router.replace('/');
    } catch {
      toast.error('修改密码失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await authFetch('/api/auth/logout', { method: 'POST' });
    clearAuthToken();
    router.replace('/login');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <BrandLogo className="inline-block w-16 h-16 mb-4 drop-shadow-lg drop-shadow-blue-500/30" />
          <h1 className="text-2xl font-bold text-gray-900">人才决策Agent</h1>
        </div>

        <Card className="shadow-xl border-0">
          <CardHeader>
            <CardTitle>设置新密码</CardTitle>
            <CardDescription>
              首次登录必须更换初始密码。新密码至少 12 位，并包含大小写字母、数字和特殊字符。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current-password">当前密码</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    id="current-password"
                    type="password"
                    autoComplete="current-password"
                    className="pl-10"
                    value={form.currentPassword}
                    onChange={event => setForm({ ...form, currentPassword: event.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-password">新密码</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    className="pl-10"
                    value={form.newPassword}
                    onChange={event => setForm({ ...form, newPassword: event.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password">确认新密码</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    className="pl-10"
                    value={form.confirmPassword}
                    onChange={event => setForm({ ...form, confirmPassword: event.target.value })}
                  />
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? '更新中...' : '更新密码'}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={handleLogout}>
                退出登录
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
