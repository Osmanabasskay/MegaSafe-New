'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CountryBreakdownPoint, TimeSeriesPoint } from '@/lib/types';

const pieColors = ['#F97316', '#1D4ED8', '#10B981', '#F59E0B', '#8B5CF6', '#64748B'];

export const UserGrowthChart = (params: { data: TimeSeriesPoint[] }) => (
  <ResponsiveContainer width="100%" height={260}>
    <LineChart data={params.data}>
      <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
      <XAxis dataKey="label" stroke="#64748B" />
      <YAxis stroke="#64748B" />
      <Tooltip />
      <Line type="monotone" dataKey="value" stroke="#1D4ED8" strokeWidth={2.5} dot={false} />
    </LineChart>
  </ResponsiveContainer>
);

export const CollectionVolumeChart = (params: { data: TimeSeriesPoint[] }) => (
  <ResponsiveContainer width="100%" height={260}>
    <BarChart data={params.data}>
      <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
      <XAxis dataKey="label" stroke="#64748B" />
      <YAxis stroke="#64748B" />
      <Tooltip />
      <Bar dataKey="value" fill="#F97316" radius={[6, 6, 0, 0]} />
    </BarChart>
  </ResponsiveContainer>
);

export const CountryBreakdownChart = (params: { data: CountryBreakdownPoint[] }) => (
  <ResponsiveContainer width="100%" height={260}>
    <PieChart>
      <Tooltip />
      <Pie data={params.data} dataKey="value" nameKey="country" outerRadius={95} innerRadius={50}>
        {params.data.map((entry, index) => (
          <Cell key={`${entry.country}-${index}`} fill={pieColors[index % pieColors.length]} />
        ))}
      </Pie>
    </PieChart>
  </ResponsiveContainer>
);
