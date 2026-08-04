'use client';

import {
  Funnel,
  FunnelChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import type { FunnelData } from '../types';

export default function AnalyticsFunnelChart({
  funnelData,
}: {
  funnelData: FunnelData[];
}) {
  const colors = ['#6B7280', '#3B82F6', '#F59E0B', '#8B5CF6', '#10B981'];
  const data = funnelData.map((item, index) => ({
    ...item,
    name: item.stage,
    value: item.count,
    fill: colors[index] || colors[0],
  }));

  return (
    <ResponsiveContainer width="100%" height={250}>
      <FunnelChart>
        <Tooltip />
        <Funnel dataKey="count" data={data} isAnimationActive>
          <LabelList
            position="right"
            fill="#374151"
            stroke="none"
            dataKey="name"
          />
        </Funnel>
      </FunnelChart>
    </ResponsiveContainer>
  );
}
