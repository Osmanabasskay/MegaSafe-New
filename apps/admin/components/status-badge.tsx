const palette: Record<string, string> = {
  // user / account
  active:      'bg-emerald-100 text-emerald-700',
  approved:    'bg-emerald-100 text-emerald-700',
  verified:    'bg-emerald-100 text-emerald-700',
  completed:   'bg-emerald-100 text-emerald-700',
  resolved:    'bg-emerald-100 text-emerald-700',
  paid:        'bg-emerald-100 text-emerald-700',
  success:     'bg-emerald-100 text-emerald-700',
  // warning / pending
  submitted:   'bg-amber-100 text-amber-700',
  pending:     'bg-amber-100 text-amber-700',
  processing:  'bg-amber-100 text-amber-700',
  under_review:'bg-amber-100 text-amber-700',
  open:        'bg-amber-100 text-amber-700',
  // negative
  rejected:    'bg-rose-100 text-rose-700',
  suspended:   'bg-rose-100 text-rose-700',
  banned:      'bg-rose-100 text-rose-700',
  failed:      'bg-rose-100 text-rose-700',
  expired:     'bg-rose-100 text-rose-700',
  cancelled:   'bg-rose-100 text-rose-700',
  // neutral
  paused:      'bg-slate-200 text-slate-700',
  disbanded:   'bg-slate-200 text-slate-700',
  archived:    'bg-slate-200 text-slate-700',
  locked:      'bg-rose-100 text-rose-700',
  frozen:      'bg-indigo-100 text-indigo-700',
  inactive:    'bg-slate-200 text-slate-700',
  debit:       'bg-slate-100 text-slate-600',
  credit:      'bg-blue-100 text-blue-700',
  inbound:     'bg-blue-100 text-blue-700',
  outbound:    'bg-orange-100 text-orange-700',
  // risk severities (Phase 15 colour scale)
  low:         'bg-emerald-100 text-emerald-700',
  medium:      'bg-amber-100 text-amber-700',
  high:        'bg-orange-100 text-orange-700',
  critical:    'bg-rose-100 text-rose-700',
  extreme:     'bg-purple-200 text-purple-900',
  // risk/case workflow statuses
  investigating:  'bg-amber-100 text-amber-700',
  escalated:      'bg-orange-100 text-orange-700',
  false_positive: 'bg-slate-200 text-slate-600',
  reviewed:       'bg-emerald-100 text-emerald-700',
};

export const StatusBadge = (params: { value: string }) => (
  <span
    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${
      palette[params.value] ?? 'bg-slate-100 text-slate-600'
    }`}
  >
    {params.value.replace(/_/g, ' ')}
  </span>
);
