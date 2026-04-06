export const KpiCard = (params: { label: string; value: string; accent?: 'orange' | 'blue' }) => (
  <div
    className={`rounded-2xl border bg-white p-4 shadow-sm ${
      params.accent === 'blue' ? 'border-blue-100' : 'border-orange-100'
    }`}
  >
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{params.label}</p>
    <p className="mt-2 text-3xl font-black text-slate-900">{params.value}</p>
  </div>
);
