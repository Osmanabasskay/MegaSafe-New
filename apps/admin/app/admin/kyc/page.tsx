import Link from 'next/link';
import { DataTable } from '@/components/data-table';
import { Pagination } from '@/components/pagination';
import { StatusBadge } from '@/components/status-badge';
import { KpiCard } from '@/components/kpi-card';
import { AdminActionButton } from '@/components/action-button';
import { DocImage } from '@/components/doc-image';
import { getKycApplications, getKycQueue, getKycSignals, requireSuperAdmin } from '@/lib/admin-data';

const SignalTile = (p: { label: string; value: number; detail?: string[] }) => (
  <div className={`rounded-xl border p-3 ${p.value > 0 ? 'border-orange-200 bg-orange-50' : 'border-slate-200 bg-slate-50'}`}>
    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{p.label}</p>
    <p className={`mt-1 text-2xl font-black ${p.value > 0 ? 'text-orange-700' : 'text-slate-400'}`}>{p.value}</p>
    {p.detail && p.detail.length > 0 ? (
      <ul className="mt-1 space-y-0.5 text-[10px] font-mono text-slate-500">
        {p.detail.map((d) => <li key={d}>{d}</li>)}
      </ul>
    ) : null}
  </div>
);

const DocTile = (p: { label: string; url: string | null }) => (
  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
    <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{p.label}</p>
    <DocImage label={p.label} url={p.url} />
  </div>
);

export default async function AdminKycPage(params: {
  searchParams?: Promise<{ tab?: string; status?: string; page?: string }>;
}) {
  // Ensure the auth cache is warm at the page level before any nested component runs.
  await requireSuperAdmin();

  const sp = params.searchParams ? await params.searchParams : {};
  const tab = sp.tab ?? 'queue';
  const page = Math.max(1, parseInt(sp.page ?? '1', 10));

  const signals = await getKycSignals();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black text-slate-900">KYC Queue &amp; Fraud Monitoring</h2>
        <p className="text-sm text-slate-500">
          Review submitted KYC applications. Documents load inline via 10-minute signed URLs. Every
          review action is audited.
        </p>
      </div>

      {/* Status counts */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Pending KYC"   value={signals.counts.pending.toLocaleString()}   accent="orange" />
        <KpiCard label="Submitted KYC" value={signals.counts.submitted.toLocaleString()} accent="orange" />
        <KpiCard label="Approved KYC"  value={signals.counts.approved.toLocaleString()}  accent="green" />
        <KpiCard label="Rejected KYC"  value={signals.counts.rejected.toLocaleString()}  accent={signals.counts.rejected > 0 ? 'red' : 'slate'} />
      </section>

      {/* Fraud signals */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-base font-bold text-slate-900">KYC Fraud Signals</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SignalTile label="Same phone, multiple accounts" value={signals.duplicatePhones.length} detail={signals.duplicatePhones.slice(0, 3).map((p) => `${p.phone} ×${p.count}`)} />
          <SignalTile label="Duplicate ID document checksums" value={signals.duplicateDocuments.length} detail={signals.duplicateDocuments.slice(0, 3).map((d) => `${d.checksum}… ×${d.count}`)} />
          <SignalTile label="Possible underage (<18)" value={signals.underageCount} />
          <SignalTile label="Applications missing national ID" value={signals.missingDataCount} />
        </div>
        {signals.duplicatePhones.length === 0 && signals.duplicateDocuments.length === 0 && signals.underageCount === 0 && signals.missingDataCount === 0 ? (
          <p className="mt-3 text-xs text-slate-400">No KYC fraud signals detected in current data.</p>
        ) : null}
      </section>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {[
          { key: 'queue',        label: 'Review Queue (Documents)' },
          { key: 'applications', label: 'All Applications' },
        ].map((t) => (
          <a
            key={t.key}
            href={`/admin/kyc?tab=${t.key}&page=1`}
            className={`flex-1 rounded-lg px-3 py-2 text-center text-xs font-bold transition ${
              tab === t.key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {t.label}
          </a>
        ))}
      </div>

      {tab === 'queue' && <KycQueueTab />}
      {tab === 'applications' && (
        // NOTE: only primitive props here — passing a function across RSC boundaries
        // in Next.js 15 + React 19 causes prop-serialisation errors that surface as
        // a redirect to /login.  buildUrl is computed inside the component instead.
        <KycApplicationsTab status={sp.status} page={page} tab={tab} />
      )}
    </div>
  );
}

async function KycQueueTab() {
  const [queue, { userId: adminId }] = await Promise.all([getKycQueue(), requireSuperAdmin()]);
  const selfActionReason = 'Blocked: you cannot review your own KYC submission.';

  if (queue.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400">
        No pending KYC submissions.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {queue.map((item) => {
        const isSelf = item.userId === adminId;
        return (
          <article key={item.userId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{item.userName}</h3>
                <p className="text-xs text-slate-500">
                  Submitted {new Date(item.submittedAt).toLocaleString()} &middot; Status:{' '}
                  <StatusBadge value={item.kycStatus} />
                </p>
                <Link
                  href={`/admin/users/${item.userId}`}
                  className="text-xs font-semibold text-blue-700 hover:underline"
                  prefetch={false}
                >
                  View full profile ↗
                </Link>
              </div>
              <div className="flex flex-wrap gap-2">
                {isSelf ? (
                  <>
                    <AdminActionButton action="approve_kyc" label="Approve KYC" targetUserId={item.userId} tone="primary" disabled disabledReason={selfActionReason} />
                    <AdminActionButton action="reject_kyc" label="Reject KYC" targetUserId={item.userId} tone="warning" disabled disabledReason={selfActionReason} />
                    <AdminActionButton action="request_kyc_resubmission" label="Request Resubmission" targetUserId={item.userId} tone="neutral" disabled disabledReason={selfActionReason} />
                    <AdminActionButton action="mark_kyc_verified" label="Mark Verified" targetUserId={item.userId} tone="primary" disabled disabledReason={selfActionReason} />
                    <AdminActionButton action="escalate_kyc" label="Escalate" targetUserId={item.userId} tone="warning" disabled disabledReason={selfActionReason} />
                    <AdminActionButton action="add_admin_note" label="Reviewer Note" targetUserId={item.userId} tone="neutral" disabled disabledReason={selfActionReason} />
                  </>
                ) : (
                  <>
                    <form action="/api/admin/action" method="post">
                      <input type="hidden" name="action"       value="approve_kyc" />
                      <input type="hidden" name="targetUserId" value={item.userId} />
                      <button type="submit" className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-emerald-700">
                        Approve KYC
                      </button>
                    </form>
                    <form action="/api/admin/action" method="post">
                      <input type="hidden" name="action"       value="reject_kyc" />
                      <input type="hidden" name="targetUserId" value={item.userId} />
                      <input type="hidden" name="reason"       value="Document mismatch or unclear image." />
                      <button type="submit" className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-rose-700">
                        Reject KYC
                      </button>
                    </form>
                    <form action="/api/admin/action" method="post">
                      <input type="hidden" name="action"       value="request_kyc_resubmission" />
                      <input type="hidden" name="targetUserId" value={item.userId} />
                      <input type="hidden" name="reason"       value="Please resubmit clearer document photos." />
                      <button type="submit" className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-50">
                        Request Resubmission
                      </button>
                    </form>
                    <AdminActionButton action="mark_kyc_verified" label="Mark Verified" targetUserId={item.userId} tone="primary" confirm="Mark this user's KYC as verified?" />
                    <AdminActionButton action="escalate_kyc" label="Escalate" targetUserId={item.userId} tone="warning" requireReason />
                    <AdminActionButton action="add_admin_note" label="Reviewer Note" targetUserId={item.userId} tone="neutral" requireReason />
                  </>
                )}
              </div>
            </div>
            {isSelf ? (
              <p className="mt-2 text-xs font-semibold text-amber-700">
                This is your own submission — review actions are disabled (segregation of duties).
                Another super admin must review it.
              </p>
            ) : null}
            {/* Document completeness banner */}
            {(() => {
              const missing = [
                !item.idFrontUrl && 'ID Front',
                !item.idBackUrl  && 'ID Back',
                !item.selfieUrl  && 'Selfie',
              ].filter(Boolean);
              if (missing.length === 3) return (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                  No documents uploaded yet — the applicant has not submitted photos.
                </p>
              );
              if (missing.length > 0) return (
                <p className="mt-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-700">
                  Incomplete submission — missing: {missing.join(', ')}. Do not approve until all documents are present.
                </p>
              );
              return null;
            })()}
            {/* KYC document tiles — images load inline via signed URLs */}
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <DocTile label="ID Front" url={item.idFrontUrl} />
              <DocTile label="ID Back"  url={item.idBackUrl} />
              <DocTile label="Selfie"   url={item.selfieUrl} />
            </div>
          </article>
        );
      })}
    </div>
  );
}

async function KycApplicationsTab(props: {
  status?: string;
  page: number;
  tab: string;
}) {
  // buildUrl is computed here, not passed in — avoids passing a function across
  // RSC boundaries which causes serialisation errors in Next.js 15 + React 19.
  const buildUrl = (p: number) =>
    `/admin/kyc?tab=${props.tab}${props.status ? `&status=${props.status}` : ''}&page=${p}`;

  const { applications, total } = await getKycApplications({
    status: props.status || undefined,
    page: props.page,
    pageSize: 50,
  });

  return (
    <div className="space-y-4">
      {/* Status filter */}
      <div className="flex flex-wrap gap-2">
        {(['', 'pending', 'submitted', 'approved', 'rejected'] as const).map((s) => (
          <a
            key={s}
            href={`/admin/kyc?tab=applications&status=${s}&page=1`}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              (props.status ?? '') === s
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}
          </a>
        ))}
      </div>

      <DataTable
        headers={['Full Name', 'Phone', 'Document Type', 'National ID', 'Status', 'Submitted', 'Reviewed', 'Rejection Reason', '']}
        rows={applications.map((a) => [
          a.fullName,
          a.phone,
          a.documentType,
          a.nationalIdNumber,
          <StatusBadge key={`${a.id}-s`} value={a.status} />,
          new Date(a.submittedAt).toLocaleDateString(),
          a.reviewedAt ? new Date(a.reviewedAt).toLocaleDateString() : '-',
          a.rejectionReason ?? '-',
          <Link
            key={`${a.id}-link`}
            href={`/admin/users/${a.userId}`}
            prefetch={false}
            className="whitespace-nowrap text-xs font-semibold text-blue-700 hover:underline"
          >
            View profile ↗
          </Link>,
        ])}
        emptyText="No KYC applications match the selected status."
      />

      <Pagination total={total} page={props.page} pageSize={50} buildUrl={buildUrl} />
    </div>
  );
}
