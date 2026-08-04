'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Building2, Mail, Lock, User, ArrowRight, BookOpen, ShieldCheck } from 'lucide-react';
import { setAuthToken } from '@/lib/auth-client';

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('login');
  const [loginData, setLoginData] = useState({ email: '', password: '' });
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [registerData, setRegisterData] = useState({ 
    email: '', 
    password: '', 
    confirmPassword: '',
    name: '', 
    inviteToken: '',
  });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginData.email || !loginData.password) {
      toast.error('请输入邮箱和密码');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
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
          window.location.replace(passwordChangeRequired ? '/change-password' : '/');
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
      const res = await fetch('/api/auth/register', {
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
        setLoginData({ email: registerData.email, password: '' });
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/30 mb-4">
            <Building2 className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">智聘Agent</h1>
          <p className="text-gray-500 mt-1">AI驱动的人才智能匹配系统</p>
        </div>

        {/* 登录/注册卡片 */}
        <Card className="shadow-xl border-0">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <CardHeader className="pb-0">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">登录</TabsTrigger>
                <TabsTrigger value="register">受邀注册</TabsTrigger>
              </TabsList>
            </CardHeader>

            <CardContent className="pt-6">
              {/* 登录表单 */}
              <TabsContent value="login">
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email">邮箱</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        id="login-email"
                        type="email"
                        placeholder="请输入邮箱"
                        className="pl-10"
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
                        className="pl-10"
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
                          className="pl-10"
                          value={mfaCode}
                          onChange={(e) => setMfaCode(e.target.value)}
                          autoFocus
                        />
                      </div>
                    </div>
                  )}

                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? '验证中...' : mfaRequired ? '验证并登录' : '登录'}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>

                  <div className="text-center pt-2">
                    <a
                      href="/demo-guide.html"
                      target="_blank"
                      className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      <BookOpen className="w-4 h-4" />
                      查看演示指南
                    </a>
                  </div>
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
                        className="pl-10"
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
                        className="pl-10"
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
                        className="pl-10"
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
                        className="pl-10"
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
                        className="pl-10"
                        value={registerData.inviteToken}
                        onChange={(e) => setRegisterData({ ...registerData, inviteToken: e.target.value })}
                      />
                    </div>
                  </div>

                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? '注册中...' : '注册'}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </form>
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>

        {/* 底部信息 */}
        <p className="text-center text-sm text-gray-400 mt-6">
          智聘Agent · AI驱动的人才智能匹配系统
        </p>
      </div>
    </div>
  );
}
