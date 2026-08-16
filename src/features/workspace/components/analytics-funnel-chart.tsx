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
  const colors = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
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
            fill="var(--muted-foreground)"
            stroke="none"
            dataKey="name"
          />
        </Funnel>
      </FunnelChart>
    </ResponsiveContainer>
  );
}
