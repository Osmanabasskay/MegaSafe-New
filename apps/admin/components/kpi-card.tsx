type Accent = 'orange' | 'blue' | 'green' | 'red' | 'slate';

const accentClasses: Record<Accent, { border: string; value: string }> = {
  orange: { border: 'border-orange-100', value: 'text-orange-600' },
  blue:   { border: 'border-blue-100',   value: 'text-blue-600' },
  green:  { border: 'border-emerald-100', value: 'text-emerald-600' },
  red:    { border: 'border-rose-100',    value: 'text-rose-600' },
  slate:  { border: 'border-slate-200',  value: 'text-slate-900' },
};

export const KpiCard = (params: {
  label: string;
  value: string;
  sub?: string;
  accent?: Accent;
}) => {
  const ac = accentClasses[params.accent ?? 'slate'];
  return (
    <div className={`rounded-2xl border bg-white p-4 shadow-sm ${ac.border}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{params.label}</p>
      <p className={`mt-2 text-3xl font-black ${ac.value}`}>{params.value}</p>
      {params.sub ? <p className="mt-1 text-xs text-slate-400">{params.sub}</p> : null}
    </div>
  );
};
