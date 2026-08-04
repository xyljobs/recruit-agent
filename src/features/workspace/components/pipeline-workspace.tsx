'use client';

import { useState } from 'react';
import { Download, Kanban } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { authFetch } from '@/lib/auth-client';
import { getScoreColor, STATUS_CONFIG } from '../constants';
import { useWorkspaceData } from '../hooks/use-workspace-data';
import { exportMatchRecords } from '../lib/export-workbook';
import type { MatchRecord } from '../types';
import { MatchScriptDialog } from './match-script-dialog';

export function PipelineWorkspace() {
  const {
    matchRecords,
    reloadDashboard,
    reloadMatchRecords,
  } = useWorkspaceData();
  const [selectedMatch, setSelectedMatch] = useState<MatchRecord | null>(null);
  const [scriptDialogOpen, setScriptDialogOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function handleUpdateStatus(matchId: string, status: string) {
    const reasonCode = ['rejected', 'withdrawn'].includes(status)
      ? window.prompt(status === 'rejected' ? '请输入人工拒绝原因' : '请输入候选人撤回原因')?.trim()
      : undefined;
    if (['rejected', 'withdrawn'].includes(status) && !reasonCode) return;
    try {
      const response = await authFetch('/api/match-records', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: matchId,
          status,
          client_event_id: crypto.randomUUID(),
          occurred_at: new Date().toISOString(),
          ...(reasonCode ? { reason_code: reasonCode } : {}),
        }),
      });
      const result = await response.json();
      if (result.success) {
        await Promise.all([reloadMatchRecords(), reloadDashboard()]);
        toast.success('状态更新成功');
      } else {
        toast.error(result.error || '更新失败');
      }
    } catch (error) {
      console.error('更新状态失败:', error);
      toast.error('更新失败');
    }
  }

  async function handleExport() {
    if (matchRecords.length === 0) {
      toast.error('暂无匹配记录数据');
      return;
    }
    setExporting(true);
    try {
      await exportMatchRecords(matchRecords);
      toast.success('导出成功！');
    } catch {
      toast.error('导出失败，请重试');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">候选人状态看板</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={exporting}
        >
          <Download className="h-4 w-4 mr-2" />
          {exporting ? '导出中...' : '导出记录'}
        </Button>
      </div>

      {matchRecords.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Object.entries(STATUS_CONFIG).map(([status, config]) => {
            const records = matchRecords.filter(
              (record) => record.status === status,
            );
            return (
              <Card key={status} className="bg-gray-50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <span className={config.color}>{config.icon}</span>
                    <span>{config.label}</span>
                    <Badge variant="secondary" className="ml-auto">
                      {records.length}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-64">
                    <div className="space-y-2">
                      {records.map((record) => (
                        <Card key={record.id} className="bg-white shadow-sm">
                          <CardContent className="p-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-medium text-sm">
                                {record.candidate?.name}
                              </span>
                              <span
                                className={`text-xs font-bold ${getScoreColor(record.overall_score || 0)}`}
                              >
                                {record.overall_score}分
                              </span>
                            </div>
                            <p className="text-xs text-gray-500 mb-2">
                              {record.job?.title}
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {status === 'pending' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() =>
                                    handleUpdateStatus(record.id, 'contacted')
                                  }
                                >
                                  已联系
                                </Button>
                              )}
                              {status === 'contacted' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() =>
                                    handleUpdateStatus(record.id, 'interviewing')
                                  }
                                >
                                  安排面试
                                </Button>
                              )}
                              {status === 'interviewing' && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    onClick={() =>
                                      handleUpdateStatus(record.id, 'offered')
                                    }
                                  >
                                    发Offer
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    onClick={() =>
                                      handleUpdateStatus(record.id, 'rejected')
                                    }
                                  >
                                    拒绝
                                  </Button>
                                </>
                              )}
                              {status === 'offered' && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    onClick={() =>
                                      handleUpdateStatus(record.id, 'hired')
                                    }
                                  >
                                    录用
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    onClick={() =>
                                      handleUpdateStatus(record.id, 'rejected')
                                    }
                                  >
                                    拒绝
                                  </Button>
                                </>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs"
                                onClick={() => {
                                  setSelectedMatch(record);
                                  setScriptDialogOpen(true);
                                }}
                              >
                                话术
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-gray-500">
              <Kanban className="h-16 w-16 mx-auto mb-4 text-gray-300" />
              <p>暂无匹配记录，请先进行智能匹配</p>
            </div>
          </CardContent>
        </Card>
      )}

      <MatchScriptDialog
        match={selectedMatch}
        open={scriptDialogOpen}
        onOpenChange={setScriptDialogOpen}
      />
    </div>
  );
}
