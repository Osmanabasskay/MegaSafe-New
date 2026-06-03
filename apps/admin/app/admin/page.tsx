import Link from 'next/link';
import { CollectionVolumeChart, CountryBreakdownChart, UserGrowthChart } from '@/components/charts';
import { KpiCard } from '@/components/kpi-card';
import { getDashboardKpis, getOverviewMetrics } from '@/lib/admin-data';

const num = (v: unknown) => Number(v ?? 0);

export default async function AdminOverviewPage() {
  const [{ userGrowth, topupVolume, countryBreakdown, recentActivity }, metrics] = await Promise.all([
    getDashboardKpis(),
    getOverviewMetrics(),
  ]);

  const users = (metrics.users ?? {}) as Record<string, number>;
  const finance = (metrics.finance ?? {}) as Record<string, number>;
  const osusu = (metrics.osusu ?? {}) as Record<string, number>;
  const security = (metrics.security ?? {}) as Record<string, number>;
  const risk = (metrics.risk ?? {}) as Record<string, number>;

  const fmt = (n: unknown) => num(n).toLocaleString();
  const fmtCur = (n: unknown) => `NLe ${num(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-slate-900">Risk Command Center</h2>
          <p className="text-sm text-slate-500">Live intelligence from the Mi Osusu production database.</p>
        </div>
        <Link href="/admin/risk" className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-slate-800">
          Open Live Risk Monitor →
        </Link>
      </div>

      {/* Risk banner */}
      <section className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Open Risk Events" value={fmt(risk.open_events)} accent={num(risk.open_events) > 0 ? 'orange' : 'slate'} />
        <KpiCard label="High" value={fmt(risk.high)} accent="orange" />
        <KpiCard label="Critical" value={fmt(risk.critical)} accent="red" />
        <KpiCard label="Extreme" value={fmt(risk.extreme)} accent="red" />
        <KpiCard label="Open Fraud Cases" value={fmt(risk.open_fraud_cases)} accent={num(risk.open_fraud_cases) > 0 ? 'red' : 'slate'} />
        <KpiCard label="Suspicious Sessions" value={fmt(security.suspicious_sessions)} accent={num(security.suspicious_sessions) > 0 ? 'orange' : 'slate'} />
      </section>

      {/* USER INTELLIGENCE */}
      <section>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">User Intelligence</h3>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          <KpiCard label="Total Users" value={fmt(users.total)} accent="blue" />
          <KpiCard label="New Today" value={fmt(users.new_today)} accent="blue" />
          <KpiCard label="New This Week" value={fmt(users.new_this_week)} accent="blue" />
          <KpiCard label="Verified" value={fmt(users.verified)} accent="green" />
          <KpiCard label="Unverified" value={fmt(users.unverified)} accent="slate" />
          <KpiCard label="Pending KYC" value={fmt(users.pending_kyc)} accent="orange" />
          <KpiCard label="Rejected KYC" value={fmt(users.rejected_kyc)} accent={num(users.rejected_kyc) > 0 ? 'red' : 'slate'} />
          <KpiCard label="Suspended" value={fmt(users.suspended)} accent={num(users.suspended) > 0 ? 'orange' : 'slate'} />
          <KpiCard label="Locked Accounts" value={fmt(users.locked)} accent={num(users.locked) > 0 ? 'red' : 'slate'} />
          <KpiCard label="Multi Failed Logins" value={fmt(users.multiple_failed_logins)} accent={num(users.multiple_failed_logins) > 0 ? 'red' : 'slate'} />
          <KpiCard label="Suspicious Devices" value={fmt(users.suspicious_devices)} accent={num(users.suspicious_devices) > 0 ? 'orange' : 'slate'} />
        </div>
      </section>

      {/* FINANCE INTELLIGENCE */}
      <section>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Finance Intelligence</h3>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          <KpiCard label="Total Savings Balance" value={fmtCur(finance.total_savings_balance)} accent="green" />
          <KpiCard label="Vault Balance" value={fmtCur(finance.vault_balance)} accent="green" />
          <KpiCard label="Completed Topups" value={fmt(finance.completed_topups)} accent="blue" />
          <KpiCard label="Pending Topups" value={fmt(finance.pending_topups)} accent="orange" />
          <KpiCard label="Failed Topups" value={fmt(finance.failed_topups)} accent={num(finance.failed_topups) > 0 ? 'red' : 'slate'} />
          <KpiCard label="Total Withdrawals" value={fmtCur(finance.total_withdrawals)} accent="blue" />
          <KpiCard label="Pending Withdrawals" value={fmt(finance.pending_withdrawals)} accent="orange" />
          <KpiCard label="Failed Withdrawals" value={fmt(finance.failed_withdrawals)} accent={num(finance.failed_withdrawals) > 0 ? 'red' : 'slate'} />
          <KpiCard label="Platform Revenue" value={fmtCur(finance.platform_revenue)} accent="green" />
          <KpiCard label="Commission Earned" value={fmtCur(finance.commission_earned)} accent="green" />
          <KpiCard label="Reversed Transactions" value={fmt(finance.reversed_transactions)} accent={num(finance.reversed_transactions) > 0 ? 'orange' : 'slate'} />
          <KpiCard label="Dup. Refs Blocked" value={fmt(finance.duplicate_refs_blocked)} accent={num(finance.duplicate_refs_blocked) > 0 ? 'orange' : 'slate'} />
          <KpiCard label="High-Risk Transactions" value={fmt(finance.high_risk_transactions)} accent={num(finance.high_risk_transactions) > 0 ? 'red' : 'slate'} />
        </div>
      </section>

      {/* OSUSU INTELLIGENCE */}
      <section>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Osusu Intelligence</h3>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
          <KpiCard label="Active Groups" value={fmt(osusu.active_groups)} accent="green" />
          <KpiCard label="Pending Groups" value={fmt(osusu.pending_groups)} accent="orange" />
          <KpiCard label="Closed Groups" value={fmt(osusu.closed_groups)} accent="slate" />
          <KpiCard label="Total Contributions" value={fmt(osusu.total_contributions)} accent="blue" />
          <KpiCard label="Due Today" value={fmt(osusu.due_today)} accent="orange" />
          <KpiCard label="Missed Contributions" value={fmt(osusu.missed_contributions)} accent={num(osusu.missed_contributions) > 0 ? 'red' : 'slate'} />
          <KpiCard label="Duplicate Attempts" value={fmt(osusu.duplicate_attempts)} accent={num(osusu.duplicate_attempts) > 0 ? 'red' : 'slate'} />
          <KpiCard label="Collector Assignments" value={fmt(osusu.collector_assignments)} accent="blue" />
          <KpiCard label="Collector Disputes" value={fmt(osusu.collector_disputes)} accent={num(osusu.collector_disputes) > 0 ? 'orange' : 'slate'} />
          <KpiCard label="Suspicious Groups" value={fmt(osusu.suspicious_groups)} accent={num(osusu.suspicious_groups) > 0 ? 'red' : 'slate'} />
        </div>
      </section>

      {/* SECURITY INTELLIGENCE */}
      <section>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Security Intelligence (24h)</h3>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          <KpiCard label="Failed Logins" value={fmt(security.failed_logins)} accent={num(security.failed_logins) > 0 ? 'red' : 'slate'} />
          <KpiCard label="Rate-Limit Events" value={fmt(security.rate_limit_events)} accent={num(security.rate_limit_events) > 10 ? 'red' : 'slate'} />
          <KpiCard label="Blocked Requests" value={fmt(security.blocked_requests)} accent="slate" />
          <KpiCard label="OTP Requests" value={fmt(security.otp_requests)} accent="slate" />
          <KpiCard label="Password Resets" value={fmt(security.password_resets)} accent="slate" />
          <KpiCard label="New Device Logins" value={fmt(security.new_device_logins)} accent={num(security.new_device_logins) > 0 ? 'orange' : 'slate'} />
          <KpiCard label="Suspicious Sessions" value={fmt(security.suspicious_sessions)} accent={num(security.suspicious_sessions) > 0 ? 'orange' : 'slate'} />
          <KpiCard label="Admin Login Attempts" value={fmt(security.admin_login_attempts)} accent="slate" />
          <KpiCard label="Admin MFA Failures" value={fmt(security.admin_mfa_failures)} accent={num(security.admin_mfa_failures) > 0 ? 'red' : 'slate'} />
          <KpiCard label="RLS Denial Events" value={fmt(security.rls_denials)} accent={num(security.rls_denials) > 0 ? 'orange' : 'slate'} />
          <KpiCard label="API Abuse Events" value={fmt(security.api_abuse)} accent={num(security.api_abuse) > 0 ? 'red' : 'slate'} />
          <KpiCard label="Extreme Risk Events" value={fmt(security.extreme_risk_events)} accent={num(security.extreme_risk_events) > 0 ? 'red' : 'slate'} />
        </div>
      </section>

      {/* Charts */}
      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">User Growth (30 days)</h2>
          <p className="text-xs text-slate-500">New registrations per day</p>
          <div className="mt-4">
            {userGrowth.length > 0 ? <UserGrowthChart data={userGrowth} /> : (
              <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-400">No data available</div>
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">Vault Topups (30 days)</h2>
          <p className="text-xs text-slate-500">Completed topup volume in NLe</p>
          <div className="mt-4">
            {topupVolume.length > 0 ? <CollectionVolumeChart data={topupVolume} /> : (
              <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-400">No data available</div>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">Recent Audit Activity</h2>
          <p className="text-xs text-slate-500">Latest 20 events from audit_logs</p>
          {recentActivity.length === 0 ? (
            <p className="mt-4 text-sm text-slate-400">No data available.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {recentActivity.map((item) => (
                <li key={item.id} className="rounded-xl border border-slate-100 p-3">
                  <p className="text-sm font-semibold text-slate-900">{item.actorName} &middot; <span className="font-mono text-xs">{item.action}</span></p>
                  <p className="text-xs text-slate-500">{item.tableName} &middot; {new Date(item.createdAt).toLocaleString()}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">User Distribution</h2>
          <p className="text-xs text-slate-500">By country_id from profiles</p>
          <div className="mt-4">
            {countryBreakdown.length > 0 ? <CountryBreakdownChart data={countryBreakdown} /> : (
              <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-400">No data available</div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
