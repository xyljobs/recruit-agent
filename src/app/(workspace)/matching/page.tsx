import { MatchingWorkspace } from '@/features/workspace/components/matching-workspace';

export default async function MatchingPage({
  searchParams,
}: {
  searchParams: Promise<{ jobId?: string; candidateId?: string }>;
}) {
  const params = await searchParams;
  return (
    <MatchingWorkspace
      initialJobId={params.jobId ?? ''}
      initialCandidateId={params.candidateId ?? ''}
    />
  );
}
