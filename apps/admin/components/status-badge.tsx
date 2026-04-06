const palette: Record<string, string> = {
  approved: 'bg-emerald-100 text-emerald-700',
  active: 'bg-emerald-100 text-emerald-700',
  submitted: 'bg-amber-100 text-amber-700',
  pending: 'bg-amber-100 text-amber-700',
  rejected: 'bg-rose-100 text-rose-700',
  suspended: 'bg-rose-100 text-rose-700',
  banned: 'bg-rose-100 text-rose-700',
  paused: 'bg-slate-200 text-slate-700',
  disbanded: 'bg-slate-200 text-slate-700',
};

export const StatusBadge = (params: { value: string }) => (
  <span
    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${
      palette[params.value] ?? 'bg-slate-100 text-slate-600'
    }`}
  >
    {params.value.replace('_', ' ')}
  </span>
);
