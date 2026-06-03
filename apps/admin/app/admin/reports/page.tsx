import { getDashboardKpis } from '@/lib/admin-data';

const ReportCard = (params: {
  title: string;
  description: string;
  csvHref: string;
  pdfHref: string;
}) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <h3 className="text-base font-bold text-slate-900">{params.title}</h3>
    <p className="mt-1 text-xs text-slate-500">{params.description}</p>
    <div className="mt-3 flex gap-2">
      <a
        href={params.csvHref}
        className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-50"
      >
        Export CSV
      </a>
      <a
        href={params.pdfHref}
        className="rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 text-xs font-bold uppercase tracking-wide text-orange-700 hover:bg-orange-100"
      >
        Export PDF
      </a>
    </div>
  </div>
);

export default async function AdminReportsPage(params: {
  searchParams?: Promise<{ from?: string; to?: string }>;
}) {
  const sp = params.searchParams ? await params.searchParams : {};
  const from = sp.from ?? '';
  const to = sp.to ?? '';
  const qFrom = from ? `&from=${encodeURIComponent(from)}` : '';
  const qTo   = to   ? `&to=${encodeURIComponent(to)}`     : '';
  const dateQuery = `${qFrom}${qTo}`;

  const { kpis, countryBreakdown } = await getDashboardKpis();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black text-slate-900">Reports &amp; Exports</h2>
        <p className="text-sm text-slate-500">
          All reports are generated from live server-side database queries. No cached or fake data.
        </p>
      </div>

      {/* Date range filter */}
      <form className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-bold text-slate-900">Date Range</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-semibold text-slate-700">
            From
            <input name="from" type="date" defaultValue={from} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            To
            <input name="to" type="date" defaultValue={to} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" />
          </label>
          <div className="flex items-end">
            <button type="submit" className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
              Apply Range
            </button>
          </div>
        </div>
      </form>

      {/* Live summary */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-base font-bold text-slate-900">Platform Snapshot</h3>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div className="flex gap-2"><dt className="font-semibold text-slate-700">Total Users:</dt><dd className="text-slate-600">{kpis.users.total.toLocaleString()}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold text-slate-700">Active Groups:</dt><dd className="text-slate-600">{kpis.groups.active.toLocaleString()}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold text-slate-700">Open Disputes:</dt><dd className="text-slate-600">{kpis.disputes.open.toLocaleString()}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold text-slate-700">Pending KYC:</dt><dd className="text-slate-600">{kpis.users.pendingKyc.toLocaleString()}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold text-slate-700">Savings Balance:</dt><dd className="text-slate-600">NLe {kpis.savings.totalBalanceNLe.toFixed(2)}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold text-slate-700">Platform Revenue:</dt><dd className="text-slate-600">NLe {kpis.revenue.totalCommissionsNLe.toFixed(2)}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold text-slate-700">Failed Topups 24h:</dt><dd className={kpis.risk.failedTopups24h > 0 ? 'font-bold text-rose-600' : 'text-slate-600'}>{kpis.risk.failedTopups24h}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold text-slate-700">Rate Limit 24h:</dt><dd className="text-slate-600">{kpis.risk.rateLimitEvents24h}</dd></div>
        </dl>
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">User Distribution</p>
          <ul className="space-y-1 text-sm text-slate-600">
            {countryBreakdown.map((c) => (
              <li key={c.country}>{c.country}: {c.value.toLocaleString()} users</li>
            ))}
          </ul>
        </div>
      </div>

      {/* Report cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <ReportCard
          title="Platform Summary"
          description="All key metrics: users, groups, disputes, revenue, vault, savings."
          csvHref={`/api/admin/reports/export?format=csv&type=summary${dateQuery}`}
          pdfHref={`/api/admin/reports/export?format=pdf&type=summary${dateQuery}`}
        />
        <ReportCard
          title="User Report"
          description="Full user list with KYC status, role, account status, and join date."
          csvHref={`/api/admin/reports/export?format=csv&type=users${dateQuery}`}
          pdfHref={`/api/admin/reports/export?format=pdf&type=users${dateQuery}`}
        />
        <ReportCard
          title="Dispute Report"
          description="All disputes with category, priority, status, and resolution notes."
          csvHref={`/api/admin/reports/export?format=csv&type=disputes${dateQuery}`}
          pdfHref={`/api/admin/reports/export?format=pdf&type=disputes${dateQuery}`}
        />
        <ReportCard
          title="Payout Report"
          description="All withdrawal/payout requests with provider, masked destination, and status."
          csvHref={`/api/admin/reports/export?format=csv&type=payouts${dateQuery}`}
          pdfHref={`/api/admin/reports/export?format=pdf&type=payouts${dateQuery}`}
        />
        <ReportCard
          title="Risk Event Report"
          description="All fraud/attack signals with severity, score, target, and review status."
          csvHref={`/api/admin/reports/export?format=csv&type=risk_events${dateQuery}`}
          pdfHref={`/api/admin/reports/export?format=pdf&type=risk_events${dateQuery}`}
        />
        <ReportCard
          title="Security Event Report"
          description="Failed logins, OTP, device changes, RLS denials, API abuse."
          csvHref={`/api/admin/reports/export?format=csv&type=security_events${dateQuery}`}
          pdfHref={`/api/admin/reports/export?format=pdf&type=security_events${dateQuery}`}
        />
        <ReportCard
          title="Admin Activity Report"
          description="Every super-admin action with risk score, target, and reason (insider-fraud trail)."
          csvHref={`/api/admin/reports/export?format=csv&type=admin_activity${dateQuery}`}
          pdfHref={`/api/admin/reports/export?format=pdf&type=admin_activity${dateQuery}`}
        />
        <ReportCard
          title="Audit Log Report"
          description="System audit_logs ledger — actor, action, table, record, IP."
          csvHref={`/api/admin/reports/export?format=csv&type=audit_log${dateQuery}`}
          pdfHref={`/api/admin/reports/export?format=csv&type=audit_log${dateQuery}`}
        />
        <ReportCard
          title="KYC Report"
          description="KYC applications with status, document type, and review timeline."
          csvHref={`/api/admin/reports/export?format=csv&type=kyc${dateQuery}`}
          pdfHref={`/api/admin/reports/export?format=csv&type=kyc${dateQuery}`}
        />
        <ReportCard
          title="Transaction / Payment Report"
          description="Mobile-money transactions with provider reference and status."
          csvHref={`/api/admin/reports/export?format=csv&type=payments${dateQuery}`}
          pdfHref={`/api/admin/reports/export?format=csv&type=payments${dateQuery}`}
        />
        <ReportCard
          title="Group Report"
          description="Osusu groups with members, volume, and status."
          csvHref={`/api/admin/reports/export?format=csv&type=groups${dateQuery}`}
          pdfHref={`/api/admin/reports/export?format=csv&type=groups${dateQuery}`}
        />
        <ReportCard
          title="Contribution Report"
          description="Contribution payments with group, amount, method, and status."
          csvHref={`/api/admin/reports/export?format=csv&type=contributions${dateQuery}`}
          pdfHref={`/api/admin/reports/export?format=csv&type=contributions${dateQuery}`}
        />
        <ReportCard
          title="Collector Report"
          description="Collectors with status, commission rate, and dispute counts."
          csvHref={`/api/admin/reports/export?format=csv&type=collectors${dateQuery}`}
          pdfHref={`/api/admin/reports/export?format=csv&type=collectors${dateQuery}`}
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
        <p className="font-semibold text-slate-700">Report integrity</p>
        <p className="mt-1">
          Every report is generated from a live server-side database query using the Supabase
          service-role client. No data is cached, simulated, or hardcoded. PDF reports include a
          verification footer with the generation timestamp. CSV exports can be re-imported for
          independent reconciliation.
        </p>
      </div>
    </div>
  );
}
