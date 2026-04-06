import { getDashboardSummary } from '@/lib/admin-data';

export default async function AdminReportsPage(params: {
  searchParams?: Promise<{ from?: string; to?: string }>;
}) {
  const searchParams = params.searchParams ? await params.searchParams : {};
  const from = searchParams?.from ?? '';
  const to = searchParams?.to ?? '';
  const summary = await getDashboardSummary();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-black text-slate-900">Platform Reports</h2>
        <p className="text-sm text-slate-500">
          Export reports by date range. CSV and PDF are generated from server-side report routes.
        </p>
      </div>

      <form className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm font-semibold text-slate-700">
            From
            <input
              name="from"
              type="date"
              defaultValue={from}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            To
            <input
              name="to"
              type="date"
              defaultValue={to}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
            >
              Apply Range
            </button>
          </div>
        </div>
      </form>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900">Revenue by Country</h3>
          <ul className="mt-3 space-y-1 text-sm text-slate-700">
            {summary.countryBreakdown.map((entry) => (
              <li key={entry.country}>
                {entry.country}: {entry.value}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900">Report Exports</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={`/api/admin/reports/export?format=csv&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-700"
            >
              Export CSV
            </a>
            <a
              href={`/api/admin/reports/export?format=pdf&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-700"
            >
              Export PDF
            </a>
          </div>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>User retention trend (last 30 days)</li>
            <li>Group success rate snapshot</li>
            <li>Payment provider breakdown placeholder</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
