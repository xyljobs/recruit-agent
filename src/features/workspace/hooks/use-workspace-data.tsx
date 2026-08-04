'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/auth-client';
import type {
  Candidate,
  DashboardStats,
  EfficiencyComparison,
  FunnelData,
  Job,
  MatchRecord,
} from '../types';

interface WorkspaceData {
  stats: DashboardStats | null;
  efficiencyComparison: EfficiencyComparison | null;
  funnelData: FunnelData[];
  jobs: Job[];
  candidates: Candidate[];
  matchRecords: MatchRecord[];
  loading: boolean;
  reloadDashboard: () => Promise<void>;
  reloadJobs: () => Promise<void>;
  reloadCandidates: () => Promise<void>;
  reloadMatchRecords: () => Promise<void>;
}

const WorkspaceDataContext = createContext<WorkspaceData | null>(null);

export function WorkspaceDataProvider({ children }: { children: ReactNode }) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [efficiencyComparison, setEfficiencyComparison] =
    useState<EfficiencyComparison | null>(null);
  const [funnelData, setFunnelData] = useState<FunnelData[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [matchRecords, setMatchRecords] = useState<MatchRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const reloadDashboard = useCallback(async () => {
    try {
      const response = await authFetch('/api/dashboard');
      const result = await response.json();
      if (result.success) {
        setStats(result.data.stats);
        setEfficiencyComparison(result.data.efficiencyComparison);
        setFunnelData(result.data.funnelData);
      }
    } catch (error) {
      console.error('加载看板失败:', error);
      toast.error('加载看板数据失败');
    }
  }, []);

  const reloadJobs = useCallback(async () => {
    try {
      const response = await authFetch('/api/jobs');
      const result = await response.json();
      if (result.success) setJobs(result.data);
    } catch (error) {
      console.error('加载职位失败:', error);
    }
  }, []);

  const reloadCandidates = useCallback(async () => {
    try {
      const response = await authFetch('/api/candidates');
      const result = await response.json();
      if (result.success) setCandidates(result.data);
    } catch (error) {
      console.error('加载候选人失败:', error);
    }
  }, []);

  const reloadMatchRecords = useCallback(async () => {
    try {
      const response = await authFetch('/api/match-records');
      const result = await response.json();
      if (result.success) setMatchRecords(result.data);
    } catch (error) {
      console.error('加载匹配记录失败:', error);
    }
  }, []);

  useEffect(() => {
    async function loadWorkspace() {
      setLoading(true);
      await Promise.all([
        reloadDashboard(),
        reloadJobs(),
        reloadCandidates(),
        reloadMatchRecords(),
      ]);
      setLoading(false);
    }

    void loadWorkspace();
  }, [
    reloadCandidates,
    reloadDashboard,
    reloadJobs,
    reloadMatchRecords,
  ]);

  return (
    <WorkspaceDataContext.Provider
      value={{
        stats,
        efficiencyComparison,
        funnelData,
        jobs,
        candidates,
        matchRecords,
        loading,
        reloadDashboard,
        reloadJobs,
        reloadCandidates,
        reloadMatchRecords,
      }}
    >
      {children}
    </WorkspaceDataContext.Provider>
  );
}

export function useWorkspaceData() {
  const context = useContext(WorkspaceDataContext);
  if (!context) {
    throw new Error('useWorkspaceData must be used inside WorkspaceDataProvider');
  }
  return context;
}
