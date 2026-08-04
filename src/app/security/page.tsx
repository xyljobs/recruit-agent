'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Building2, Copy, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch, setAuthToken } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface MfaStatus {
  enabled: boolean;
  recoveryCodesRemaining: number;
}

interface MfaSetup {
  secret: string;
  otpauthUri: string;
}

export default function SecurityPage() {
  const router = useRouter();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  const loadStatus = useCallback(async () => {
    const response = await authFetch('/api/auth/mfa');
    const result = await response.json();
    if (!result.success) {
      if (response.status === 401) {
        router.replace('/login');
        return;
      }
      throw new Error(result.error || '读取安全设置失败');
    }
    setStatus(result.data);
  }, [router]);

  useEffect(() => {
    loadStatus().catch(() => toast.error('读取安全设置失败'));
  }, [loadStatus]);

  const beginSetup = async () => {
    if (!currentPassword) {
      toast.error('请输入当前密码');
      return;
    }
    setLoading(true);
    try {
      const response = await authFetch('/api/auth/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'begin', currentPassword }),
      });
      const result = await response.json();
      if (!result.success) {
        toast.error(result.error || '开始设置失败');
        return;
      }
      setSetup(result.data);
      setCode('');
      toast.success('密钥已生成，请添加到身份验证器');
    } catch {
      toast.error('开始设置失败');
    } finally {
      setLoading(false);
    }
  };

  const enableMfa = async () => {
    if (!code) {
      toast.error('请输入身份验证器验证码');
      return;
    }
    setLoading(true);
    try {
      const response = await authFetch('/api/auth/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'enable', code }),
      });
      const result = await response.json();
      if (!result.success) {
        toast.error(result.error || '启用失败');
        return;
      }
      if (result.data?.token) {
        setAuthToken(result.data.token);
      }
      setRecoveryCodes(result.data?.recoveryCodes ?? []);
      setSetup(null);
      setCurrentPassword('');
      setCode('');
      await loadStatus();
      toast.success('双重验证已启用');
    } catch {
      toast.error('启用失败');
    } finally {
      setLoading(false);
    }
  };

  const disableMfa = async () => {
    if (!currentPassword || !code) {
      toast.error('请输入当前密码和验证码');
      return;
    }
    setLoading(true);
    try {
      const response = await authFetch('/api/auth/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disable', currentPassword, code }),
      });
      const result = await response.json();
      if (!result.success) {
        toast.error(result.error || '停用失败');
        return;
      }
      if (result.data?.token) {
        setAuthToken(result.data.token);
      }
      setCurrentPassword('');
      setCode('');
      setRecoveryCodes([]);
      await loadStatus();
      toast.success('双重验证已停用');
    } catch {
      toast.error('停用失败');
    } finally {
      setLoading(false);
    }
  };

  const copyText = async (value: string) => {
    await navigator.clipboard.writeText(value);
    toast.success('已复制');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-4">
      <div className="mx-auto w-full max-w-xl py-8">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/30">
              <Building2 className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">账号安全</h1>
              <p className="text-sm text-gray-500">智聘Agent 双重验证</p>
            </div>
          </div>
          <Button variant="ghost" onClick={() => router.push('/')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            返回
          </Button>
        </div>

        <Card className="border-0 shadow-xl">
          <CardHeader>
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
              <ShieldCheck className="h-6 w-6 text-blue-600" />
            </div>
            <CardTitle>身份验证器 MFA</CardTitle>
            <CardDescription>
              登录时除密码外，还需输入身份验证器生成的 6 位验证码。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {!status ? (
              <p className="text-sm text-gray-500">正在读取设置...</p>
            ) : status.enabled ? (
              <>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                  双重验证已启用，剩余 {status.recoveryCodesRemaining} 个恢复码。
                </div>
                <div className="space-y-2">
                  <Label htmlFor="disable-password">当前密码</Label>
                  <Input
                    id="disable-password"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={event => setCurrentPassword(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="disable-code">验证码或恢复码</Label>
                  <Input
                    id="disable-code"
                    type="text"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={event => setCode(event.target.value)}
                  />
                </div>
                <Button variant="destructive" onClick={disableMfa} disabled={loading}>
                  {loading ? '处理中...' : '停用双重验证'}
                </Button>
              </>
            ) : setup ? (
              <>
                <div className="space-y-2">
                  <p className="text-sm text-gray-600">
                    在身份验证器中选择“手动输入密钥”，账号类型选择“基于时间”。
                  </p>
                  <div className="flex items-center gap-2 rounded-lg bg-gray-100 p-3">
                    <code className="min-w-0 flex-1 break-all text-sm">{setup.secret}</code>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => copyText(setup.secret)}
                      title="复制密钥"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="enable-code">身份验证器验证码</Label>
                  <Input
                    id="enable-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="6 位验证码"
                    value={code}
                    onChange={event => setCode(event.target.value)}
                  />
                </div>
                <Button onClick={enableMfa} disabled={loading}>
                  {loading ? '验证中...' : '验证并启用'}
                </Button>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="setup-password">当前密码</Label>
                  <Input
                    id="setup-password"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={event => setCurrentPassword(event.target.value)}
                  />
                </div>
                <Button onClick={beginSetup} disabled={loading}>
                  {loading ? '处理中...' : '开始设置'}
                </Button>
              </>
            )}

            {recoveryCodes.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="font-medium text-amber-900">请立即保存恢复码</p>
                <p className="mb-3 text-sm text-amber-800">
                  每个恢复码只能使用一次，关闭此页面后不会再次显示。
                </p>
                <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                  {recoveryCodes.map(recoveryCode => (
                    <span key={recoveryCode}>{recoveryCode}</span>
                  ))}
                </div>
                <Button
                  className="mt-3"
                  variant="outline"
                  onClick={() => copyText(recoveryCodes.join('\n'))}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  复制全部
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
