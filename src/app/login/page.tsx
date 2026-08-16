'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Building2, Mail, Lock, User, BookOpen, ShieldCheck, CircleUserRound } from 'lucide-react';
import { setAuthToken, authFetch } from '@/lib/auth-client';
import { withBasePath } from '@/lib/base-path';

interface LoginOrganization {
  slug: string;
  name: string;
}

// 本地演示环境权威组织 slug；公网部署无此组织时自动降级为「仅一个组织时自动选中」
const DEMO_ORG_SLUG = 'drill';

// 表单控件统一样式，对齐 https://hg.skylinktech.com.cn/compliance/ 登录页：
// 灰底无边框输入框 + 蓝色通栏按钮
const FIELD_INPUT_CLASS =
  'h-[38px] rounded-none border-0 bg-[#F0F2F6] text-base shadow-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-0';
const FIELD_SELECT_CLASS =
  'w-full h-[38px] data-[size=default]:h-[38px] rounded-none border-0 bg-[#F0F2F6] text-base shadow-none focus:ring-2 focus:ring-primary/30';
const SUBMIT_BUTTON_CLASS =
  'h-10 w-full rounded-lg text-base font-normal focus-visible:ring-primary/40';

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('login');
  // 本地演示环境：仅当显式开启 NEXT_PUBLIC_PREFILL_DEMO_LOGIN 时预填管理员账户；
  // 公网部署不设置该变量，避免把真实凭据暴露给任何访问登录页的人
  const prefillDemoLogin = process.env.NEXT_PUBLIC_PREFILL_DEMO_LOGIN === 'true';
  const [loginData, setLoginData] = useState(
    prefillDemoLogin
      ? { email: 'demo@zhaopin.local', password: 'Tq7!o_FhbnWIehabmBx3sgSRPMkL', organizationSlug: '' }
      : { email: '', password: '', organizationSlug: '' },
  );
  const [organizations, setOrganizations] = useState<LoginOrganization[]>([]);
  const [organizationsLoading, setOrganizationsLoading] = useState(true);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [registerData, setRegisterData] = useState({ 
    email: '', 
    password: '', 
    confirmPassword: '',
    name: '', 
    inviteToken: '',
  });

  // 加载可选组织列表；支持 ?org=<slug> 预选（组织切换器跳转时携带），
  // 未指定时默认选中演示组织，仅一个组织时自动选中，兼容单组织部署的无感体验
  useEffect(() => {
    async function loadOrganizations() {
      try {
        const response = await authFetch('/api/auth/organizations');
        const result: { success?: boolean; data?: LoginOrganization[] } = await response.json();
        const list = result.success ? result.data ?? [] : [];
        setOrganizations(list);
        const preselected = new URLSearchParams(window.location.search).get('org')?.trim().toLowerCase() ?? '';
        setLoginData((current) => {
          if (preselected && list.some((item) => item.slug === preselected)) {
            return { ...current, organizationSlug: preselected };
          }
          if (!current.organizationSlug) {
            // URL 参数优先；否则默认选中演示组织，便于演示环境直接登录
            const fallback =
              list.find((item) => item.slug === DEMO_ORG_SLUG)?.slug ??
              (list.length === 1 ? list[0].slug : '');
            if (fallback) {
              return { ...current, organizationSlug: fallback };
            }
          }
          return current;
        });
      } catch {
        setOrganizations([]);
      } finally {
        setOrganizationsLoading(false);
      }
    }
    void loadOrganizations();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginData.email || !loginData.password) {
      toast.error('请输入邮箱和密码');
      return;
    }
    if (!loginData.organizationSlug) {
      toast.error('请选择组织');
      return;
    }

    setLoading(true);
    try {
      const res = await authFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...loginData,
          ...(mfaRequired ? { mfaCode } : {}),
        })
      });

      const data = await res.json();
      
      if (data.mfaRequired && !data.success) {
        setMfaRequired(true);
        toast.info(data.error || '请输入身份验证器验证码');
      } else if (data.success) {
        // 存储 token 到 sessionStorage（iframe 中 cookie 不可靠的 fallback）
        if (data.data?.token) {
          setAuthToken(data.data.token);
        }
        const passwordChangeRequired = data.data?.passwordChangeRequired === true;
        toast.success(passwordChangeRequired ? '请先修改初始密码' : '登录成功！');
        // 立即跳转
        setTimeout(() => {
          window.location.replace(withBasePath(passwordChangeRequired ? '/change-password' : '/'));
        }, 300);
      } else {
        toast.error(data.error || '登录失败');
      }
    } catch {
      toast.error('登录失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!registerData.email || !registerData.password || !registerData.name || !registerData.inviteToken) {
      toast.error('请填写完整信息');
      return;
    }

    if (registerData.password !== registerData.confirmPassword) {
      toast.error('两次密码不一致');
      return;
    }

    if (registerData.password.length < 12) {
      toast.error('密码至少12位，并包含大小写字母、数字和特殊字符');
      return;
    }

    setLoading(true);
    try {
      const res = await authFetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: registerData.email,
          password: registerData.password,
          name: registerData.name,
          inviteToken: registerData.inviteToken,
        })
      });

      const data = await res.json();
      
      if (data.success) {
        toast.success('注册成功，请登录');
        setLoginData((current) => ({ ...current, email: registerData.email, password: '' }));
        // 切换到登录tab
        setActiveTab('login');
      } else {
        toast.error(data.error || '注册失败');
      }
    } catch {
      toast.error('注册失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="relative min-h-screen flex items-center justify-center p-4"
      style={{
        backgroundImage: `url(${withBasePath('/login-background.jpg')})`,
        backgroundSize: 'cover',
        backgroundPosition: '50% 50%',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <div className="relative w-full max-w-[420px]">
        {/* 登录/注册卡片，样式参照合规站登录页：半透明白底板 + 圆角 + 深阴影 */}
        <Card className="border-0 rounded-xl bg-white/95 px-2 py-8 shadow-[0_8px_32px_rgba(0,0,0,0.3)]">
          <div className="text-center">
            <h1 className="flex items-center justify-center gap-2.5 text-[2rem] font-semibold leading-tight text-[#31333F]">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary">
                <CircleUserRound className="h-7 w-7 text-white" />
              </span>
              人才决策Agent
            </h1>
            <p className="mt-1 text-base text-[#666]">AI驱动的人才智能匹配系统</p>
          </div>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <CardHeader className="pb-0">
              <TabsList className="grid w-full grid-cols-2 bg-[#F0F2F6]">
                <TabsTrigger value="login">登录</TabsTrigger>
                <TabsTrigger value="register">受邀注册</TabsTrigger>
              </TabsList>
            </CardHeader>

            <CardContent className="pt-6">
              {/* 登录表单 */}
              <TabsContent value="login">
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-organization">组织</Label>
                    <div className="relative">
                      <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 z-10" />
                      <Select
                        value={loginData.organizationSlug}
                        onValueChange={(value) => {
                          if (!value) return;
                          setLoginData((current) => ({ ...current, organizationSlug: value }));
                          setMfaRequired(false);
                          setMfaCode('');
                        }}
                        disabled={organizationsLoading}
                      >
                        <SelectTrigger id="login-organization" className={`pl-10 ${FIELD_SELECT_CLASS}`}>
                          <SelectValue placeholder={organizationsLoading ? '加载中...' : '请选择所属组织'} />
                        </SelectTrigger>
                        <SelectContent>
                          {organizations.map((organization) => (
                            <SelectItem key={organization.slug} value={organization.slug}>
                              {organization.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="login-email">邮箱</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        id="login-email"
                        type="email"
                        placeholder="请输入邮箱"
                        className={`pl-10 ${FIELD_INPUT_CLASS}`}
                        value={loginData.email}
                        onChange={(e) => {
                          setLoginData({ ...loginData, email: e.target.value });
                          setMfaRequired(false);
                          setMfaCode('');
                        }}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="login-password">密码</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        id="login-password"
                        type="password"
                        placeholder="请输入密码"
                        className={`pl-10 ${FIELD_INPUT_CLASS}`}
                        value={loginData.password}
                        onChange={(e) => {
                          setLoginData({ ...loginData, password: e.target.value });
                          setMfaRequired(false);
                          setMfaCode('');
                        }}
                      />
                    </div>
                  </div>

                  {mfaRequired && (
                    <div className="space-y-2">
                      <Label htmlFor="login-mfa-code">双重验证</Label>
                      <div className="relative">
                        <ShieldCheck className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <Input
                          id="login-mfa-code"
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          placeholder="6 位验证码或恢复码"
                          className={`pl-10 ${FIELD_INPUT_CLASS}`}
                          value={mfaCode}
                          onChange={(e) => setMfaCode(e.target.value)}
                          autoFocus
                        />
                      </div>
                    </div>
                  )}

                  <Button type="submit" className={SUBMIT_BUTTON_CLASS} disabled={loading}>
                    {loading ? '验证中...' : mfaRequired ? '验证并登录' : '登 录'}
                  </Button>

                  <div className="text-center pt-2">
                    <a
                      href={withBasePath('/evaluator-manual.html')}
                      target="_blank"
                      className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80 hover:underline"
                    >
                      <BookOpen className="w-4 h-4" />
                      评审员指南
                    </a>
                  </div>

                  {/* 开通账号提示：放在卡片内，避免叠在背景图上看不清 */}
                  <p className="rounded-md bg-[#F0F2F6] px-3 py-2 text-center text-sm text-[#666]">
                    如需开通账号请联系组织管理员获取邀请码
                  </p>
                </form>
              </TabsContent>

              {/* 注册表单 */}
              <TabsContent value="register">
                <form onSubmit={handleRegister} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="register-name">姓名</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        id="register-name"
                        type="text"
                        placeholder="请输入姓名"
                        className={`pl-10 ${FIELD_INPUT_CLASS}`}
                        value={registerData.name}
                        onChange={(e) => setRegisterData({ ...registerData, name: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="register-email">邮箱</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        id="register-email"
                        type="email"
                        placeholder="请输入邮箱"
                        className={`pl-10 ${FIELD_INPUT_CLASS}`}
                        value={registerData.email}
                        onChange={(e) => setRegisterData({ ...registerData, email: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="register-password">密码</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        id="register-password"
                        type="password"
                        placeholder="至少12位，含大小写、数字和特殊字符"
                        className={`pl-10 ${FIELD_INPUT_CLASS}`}
                        value={registerData.password}
                        onChange={(e) => setRegisterData({ ...registerData, password: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="register-confirm">确认密码</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        id="register-confirm"
                        type="password"
                        placeholder="请再次输入密码"
                        className={`pl-10 ${FIELD_INPUT_CLASS}`}
                        value={registerData.confirmPassword}
                        onChange={(e) => setRegisterData({ ...registerData, confirmPassword: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="register-invite-token">邀请码</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        id="register-invite-token"
                        type="text"
                        autoComplete="one-time-code"
                        placeholder="请输入组织管理员提供的邀请码"
                        className={`pl-10 ${FIELD_INPUT_CLASS}`}
                        value={registerData.inviteToken}
                        onChange={(e) => setRegisterData({ ...registerData, inviteToken: e.target.value })}
                      />
                    </div>
                  </div>

                  <Button type="submit" className={SUBMIT_BUTTON_CLASS} disabled={loading}>
                    {loading ? '注册中...' : '注 册'}
                  </Button>
                </form>
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>
      </div>

      {/* 贴底 footer，样式与 https://hg.skylinktech.com.cn/compliance/ 保持一致 */}
      <div className="fixed bottom-0 left-0 right-0 text-center py-2 text-xs text-[#999] bg-white/80">
        © 精密智造集团&nbsp;&nbsp;SINCE 2026
      </div>
    </div>
  );
}
