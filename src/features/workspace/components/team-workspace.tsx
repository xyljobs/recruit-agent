'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Copy,
  KeyRound,
  Mail,
  RefreshCw,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { authFetch } from '@/lib/auth-client';

interface Invitation {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

interface CreatedInvitation {
  email: string;
  inviteToken: string;
  expiresInDays: number;
}

type InvitationStatus = 'pending' | 'accepted' | 'expired';

function invitationStatus(invitation: Invitation): InvitationStatus {
  if (invitation.accepted_at) return 'accepted';
  if (new Date(invitation.expires_at).getTime() <= Date.now()) return 'expired';
  return 'pending';
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

const statusMeta: Record<InvitationStatus, { label: string; className: string }> = {
  pending: { label: '待接受', className: 'border-blue-200 bg-blue-50 text-blue-700' },
  accepted: { label: '已接受', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  expired: { label: '已过期', className: 'border-slate-200 bg-slate-50 text-slate-500' },
};

export function TeamWorkspace() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [createdInvitation, setCreatedInvitation] = useState<CreatedInvitation | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'hr' | 'admin'>('hr');
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [acceptToken, setAcceptToken] = useState('');
  const [accepting, setAccepting] = useState(false);

  const loadInvitations = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch('/api/auth/invitations');
      const result: { success?: boolean; data?: Invitation[]; error?: string } = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '邀请记录加载失败');
      setInvitations(result.data ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '邀请记录加载失败');
      setInvitations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadInvitations(); }, [loadInvitations]);

  async function copyToken(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      toast.success('邀请码已复制，请发送给受邀人');
    } catch {
      toast.error('复制失败，请手动选择复制');
    }
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('请输入有效邮箱');
      return;
    }
    setCreating(true);
    try {
      const response = await authFetch('/api/auth/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role, expiresInDays }),
      });
      const result: { success?: boolean; data?: { inviteToken?: string; email?: string }; error?: string } = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '邀请创建失败');
      if (!result.data?.inviteToken) throw new Error('邀请创建失败');
      setCreatedInvitation({
        email: result.data.email ?? email,
        inviteToken: result.data.inviteToken,
        expiresInDays,
      });
      setEmail('');
      await loadInvitations();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '邀请创建失败');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(invitation: Invitation) {
    setRevokingId(invitation.id);
    try {
      const response = await authFetch(`/api/auth/invitations/${invitation.id}`, { method: 'DELETE' });
      const result: { success?: boolean; error?: string } = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '撤销失败');
      toast.success(`已撤销发给 ${invitation.email} 的邀请`);
      await loadInvitations();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '撤销失败');
    } finally {
      setRevokingId(null);
    }
  }

  // 已注册用户凭邀请码加入另一组织（多组织成员能力），成功后可在右上角切换组织
  async function handleAcceptInvite(event: React.FormEvent) {
    event.preventDefault();
    const token = acceptToken.trim();
    if (!token) {
      toast.error('请输入邀请码');
      return;
    }
    setAccepting(true);
    try {
      const response = await authFetch('/api/auth/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteToken: token }),
      });
      const result: { success?: boolean; data?: { organization_name?: string }; error?: string } = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '加入组织失败');
      toast.success(`已加入组织「${result.data?.organization_name ?? ''}」，可在右上角组织选择器切换`);
      setAcceptToken('');
      await loadInvitations();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加入组织失败');
    } finally {
      setAccepting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Controlled access</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">团队成员</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            邀请同事加入本组织。受邀人无账号时凭一次性邀请码注册；已有账号的用户在下方直接接受邀请码即可加入，无需重新注册。
          </p>
        </div>
        <Button onClick={() => void loadInvitations()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新状态
        </Button>
      </div>

      <Card className="border-slate-200 shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><UserPlus className="h-4 w-4 text-blue-700" />创建邀请</CardTitle>
          <CardDescription>邀请码在创建时仅展示一次，请立即复制并发送给受邀人；邀请码与受邀邮箱绑定，不可转赠。</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="grid gap-4 md:grid-cols-[1fr_auto_auto_auto] md:items-end">
            <div className="space-y-2">
              <Label htmlFor="invite-email">受邀邮箱</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="name@company.com"
                  className="pl-10"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">角色</Label>
              <Select value={role} onValueChange={(value) => setRole(value === 'admin' ? 'admin' : 'hr')}>
                <SelectTrigger id="invite-role" className="w-full md:w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hr">HR</SelectItem>
                  <SelectItem value="admin">管理员</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-expiry">有效期</Label>
              <Select value={String(expiresInDays)} onValueChange={(value) => setExpiresInDays(Number(value))}>
                <SelectTrigger id="invite-expiry" className="w-full md:w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">7 天</SelectItem>
                  <SelectItem value="14">14 天</SelectItem>
                  <SelectItem value="30">30 天</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={creating}>
              {creating ? '生成中...' : '生成邀请码'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4 text-blue-700" />已有账号加入组织</CardTitle>
          <CardDescription>
            同一邮箱的全局账号可加入多个组织（租户）。输入其他组织管理员发给您的邀请码即可加入，邀请码必须与该账号的登录邮箱一致；加入后可在顶部导航栏切换组织。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAcceptInvite} className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <div className="space-y-2">
              <Label htmlFor="accept-invite-token">邀请码</Label>
              <Input
                id="accept-invite-token"
                type="text"
                autoComplete="one-time-code"
                placeholder="请输入其他组织提供的邀请码"
                value={acceptToken}
                onChange={(event) => setAcceptToken(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={accepting}>
              {accepting ? '加入中...' : '接受邀请并加入'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4 text-blue-700" />邀请记录</CardTitle>
          <CardDescription>未接受的邀请可随时撤销，撤销后邀请码立即失效。</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
          ) : invitations.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><Users /></EmptyMedia>
                <EmptyTitle>还没有邀请记录</EmptyTitle>
                <EmptyDescription>在上方输入受邀人邮箱，生成第一条邀请。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>受邀邮箱</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>过期时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((invitation) => {
                  const status = invitationStatus(invitation);
                  const meta = statusMeta[status];
                  return (
                    <TableRow key={invitation.id}>
                      <TableCell className="font-medium text-slate-950">{invitation.email}</TableCell>
                      <TableCell>
                        <Badge variant={invitation.role === 'admin' ? 'outline' : 'secondary'}>
                          {invitation.role === 'admin' ? '管理员' : 'HR'}
                        </Badge>
                      </TableCell>
                      <TableCell><Badge variant="outline" className={meta.className}>{meta.label}</Badge></TableCell>
                      <TableCell className="text-slate-600">{formatDate(invitation.created_at)}</TableCell>
                      <TableCell className="text-slate-600">{formatDate(invitation.expires_at)}</TableCell>
                      <TableCell className="text-right">
                        {status === 'pending' ? (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive">
                                <Trash2 className="mr-1 h-3.5 w-3.5" />撤销
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>撤销邀请</AlertDialogTitle>
                                <AlertDialogDescription>
                                  确定撤销发给 {invitation.email} 的邀请吗？撤销后该邀请码立即失效，对方无法再使用它注册。
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>取消</AlertDialogCancel>
                                <AlertDialogAction
                                  variant="destructive"
                                  disabled={revokingId === invitation.id}
                                  onClick={() => void handleRevoke(invitation)}
                                >
                                  {revokingId === invitation.id ? '撤销中...' : '撤销邀请'}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={createdInvitation !== null} onOpenChange={(open) => { if (!open) setCreatedInvitation(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>邀请码已生成</DialogTitle>
            <DialogDescription>
              邀请码仅在创建时展示一次，请立即复制并发送给 {createdInvitation?.email}。受邀人需在 {createdInvitation?.expiresInDays} 天内使用，且必须使用该邮箱注册。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
              <p className="break-all text-center font-mono text-sm font-semibold text-blue-900">{createdInvitation?.inviteToken}</p>
            </div>
            <Button className="w-full" onClick={() => { if (createdInvitation) void copyToken(createdInvitation.inviteToken); }}>
              <Copy className="mr-2 h-4 w-4" />复制邀请码
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
