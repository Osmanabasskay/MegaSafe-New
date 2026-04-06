import { CollectionVolumeChart, CountryBreakdownChart, UserGrowthChart } from '@/components/charts';
import { KpiCard } from '@/components/kpi-card';
import { getDashboardSummary } from '@/lib/admin-data';

export default async function AdminOverviewPage() {
  const { kpis, userGrowth, collectionVolume, countryBreakdown, recentActivity } =
    await getDashboardSummary();

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total Users" value={kpis.totalUsers.toLocaleString()} />
        <KpiCard label="Active Groups" value={kpis.activeGroups.toLocaleString()} accent="blue" />
        <KpiCard label="Total Volume (NLe)" value={kpis.totalVolumeNLe.toFixed(2)} />
        <KpiCard label="Open Disputes" value={kpis.openDisputes.toLocaleString()} accent="blue" />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">User Growth (30 days)</h2>
          <p className="text-sm text-slate-500">New registrations trend</p>
          <div className="mt-4">
            <UserGrowthChart data={userGrowth} />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Collection Volume</h2>
          <p className="text-sm text-slate-500">Daily contribution totals (NLe)</p>
          <div className="mt-4">
            <CollectionVolumeChart data={collectionVolume} />
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Recent Activity</h2>
          <p className="text-sm text-slate-500">Latest 20 events from `audit_logs`</p>
          <ul className="mt-4 space-y-2">
            {recentActivity.map((item) => (
              <li key={item.id} className="rounded-xl border border-slate-100 p-3">
                <p className="text-sm font-semibold text-slate-900">
                  {item.actorName} · {item.action}
                </p>
                <p className="text-xs text-slate-500">
                  {item.tableName} · {new Date(item.createdAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Country Breakdown</h2>
          <p className="text-sm text-slate-500">Distribution by profile country</p>
          <div className="mt-4">
            <CountryBreakdownChart data={countryBreakdown} />
          </div>
        </div>
      </section>
    </div>
  );
}
