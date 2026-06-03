import { DataTable } from '@/components/data-table';
import { KpiCard } from '@/components/kpi-card';
import { Pagination } from '@/components/pagination';
import { StatusBadge } from '@/components/status-badge';
import { getPaymentsSummary } from '@/lib/admin-data';

export default async function AdminPaymentsPage(params: {
  searchParams?: Promise<{ provider?: string; status?: string; page?: string }>;
}) {
  const sp = params.searchParams ? await params.searchParams : {};
  const page = Math.max(1, parseInt(sp.page ?? '1', 10));

  const { mobileMoneyTxs, webhookEvents, total } = await getPaymentsSummary({
    provider: sp.provider,
    status: sp.status,
    page,
  });

  const buildUrl = (p: number) => {
    const q = new URLSearchParams();
    if (sp.provider) q.set('provider', sp.provider);
    if (sp.status)   q.set('status', sp.status);
    q.set('page', String(p));
    return `/admin/payments?${q.toString()}`;
  };

  const successCount = mobileMoneyTxs.filter((t) => t.status === 'success' || t.status === 'completed').length;
  const failedCount  = mobileMoneyTxs.filter((t) => t.status === 'failed').length;
  const invalidSigs  = webhookEvents.filter((e) => !e.signatureValid).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black text-slate-900">Payments</h2>
        <p className="text-sm text-slate-500">Mobile money transactions and payment webhook events.</p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Successful (this page)" value={successCount.toString()} accent="green" />
        <KpiCard label="Failed (this page)"     value={failedCount.toString()}  accent={failedCount > 0 ? 'red' : 'slate'} />
        <KpiCard label="Invalid Webhook Sigs"   value={invalidSigs.toString()}  accent={invalidSigs > 0 ? 'red' : 'slate'} />
      </section>

      {/* Filters */}
      <form className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          <select name="provider" defaultValue={sp.provider ?? ''} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">All Providers</option>
            <option value="orange_money">Orange Money</option>
            <option value="afrimoney">AfriMoney</option>
            <option value="qmoney">QMoney</option>
            <option value="monime">Monime</option>
          </select>
          <select name="status" defaultValue={sp.status ?? ''} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="success">Success</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
          <button type="submit" className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white">
            Filter
          </button>
        </div>
      </form>

      {/* Mobile Money Transactions */}
      <section>
        <h3 className="mb-3 text-lg font-bold text-slate-900">Mobile Money Transactions</h3>
        <DataTable
          headers={['User', 'Provider', 'Direction', 'Amount (NLe)', 'Phone', 'Status', 'Date']}
          rows={mobileMoneyTxs.map((t) => [
            <span key={`${t.id}-u`} className="font-mono text-xs">{t.userId.slice(0, 12)}…</span>,
            t.provider.replace('_', ' '),
            <StatusBadge key={`${t.id}-d`} value={t.direction} />,
            t.amount.toFixed(2),
            t.phoneNumber ?? '-',
            <StatusBadge key={`${t.id}-s`} value={t.status} />,
            new Date(t.createdAt).toLocaleDateString(),
          ])}
          emptyText="No mobile money transactions match the selected filters."
        />
        <Pagination total={total} page={page} pageSize={50} buildUrl={buildUrl} />
      </section>

      {/* Webhook Events */}
      <section>
        <h3 className="mb-3 text-lg font-bold text-slate-900">Payment Webhook Events (last 50)</h3>
        <DataTable
          headers={['Provider', 'Event Type', 'Session', 'Reference', 'Signature', 'Date']}
          rows={webhookEvents.map((e) => [
            e.provider,
            <span key={`${e.id}-et`} className="font-mono text-xs">{e.eventType}</span>,
            e.sessionId ? <span key={`${e.id}-sid`} className="font-mono text-xs">{e.sessionId.slice(0, 12)}…</span> : '-',
            e.reference ?? '-',
            <StatusBadge key={`${e.id}-sig`} value={e.signatureValid ? 'verified' : 'invalid'} />,
            new Date(e.createdAt).toLocaleDateString(),
          ])}
          emptyText="No webhook events."
        />
      </section>
    </div>
  );
}
