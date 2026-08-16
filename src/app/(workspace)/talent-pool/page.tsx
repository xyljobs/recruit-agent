import { CandidateWorkspace } from '@/features/workspace/components/candidate-workspace';

// 人才资源池：跨职位的全部候选人查询与绑定管理（与流程第 2 步「候选人库」互补）
export default function TalentPoolPage() {
  return <CandidateWorkspace variant="pool" />;
}
