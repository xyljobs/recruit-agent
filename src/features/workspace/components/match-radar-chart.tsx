'use client';

import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from 'recharts';
import type { MatchRecord } from '../types';

export default function MatchRadarChart({ match }: { match: MatchRecord }) {
  const data = [
    { subject: '技能匹配(35%)', score: match.skill_score || 0, fullMark: 100 },
    { subject: '经验匹配(25%)', score: match.experience_score || 0, fullMark: 100 },
    { subject: '薪资匹配(15%)', score: match.salary_score || 0, fullMark: 100 },
    { subject: '地域匹配(10%)', score: match.location_score || 0, fullMark: 100 },
    { subject: '到岗时间(10%)', score: match.availability_score || 0, fullMark: 100 },
    { subject: '稳定性(5%)', score: match.stability_score || 0, fullMark: 100 },
  ];

  return (
    <ResponsiveContainer width="100%" height="100%">
      <RadarChart data={data}>
        <PolarGrid />
        <PolarAngleAxis
          dataKey="subject"
          tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
        />
        <PolarRadiusAxis angle={30} domain={[0, 100]} />
        <Radar
          name="匹配度"
          dataKey="score"
          stroke="var(--primary)"
          fill="var(--primary)"
          fillOpacity={0.5}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
