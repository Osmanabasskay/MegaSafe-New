import { getKycQueue } from '@/lib/admin-data';

const DocTile = (params: { label: string; url: string | null }) => (
  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
    <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-600">{params.label}</p>
    {params.url ? (
      <a href={params.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-blue-700">
        Open signed URL
      </a>
    ) : (
      <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400">
        Not available
      </div>
    )}
  </div>
);

export default async function AdminKycQueuePage() {
  const queue = await getKycQueue();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-black text-slate-900">KYC Queue</h2>
        <p className="text-sm text-slate-500">
          Submitted KYC records (`kyc_status = submitted`). Each action should notify users and audit log changes.
        </p>
      </div>

      <div className="space-y-4">
        {queue.map((item) => (
          <article key={item.userId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{item.userName}</h3>
                <p className="text-xs text-slate-500">
                  Submitted {new Date(item.submittedAt).toLocaleString()}
                </p>
              </div>
              <div className="flex gap-2">
                <form action="/api/admin/action" method="post">
                  <input type="hidden" name="action" value="approve_kyc" />
                  <input type="hidden" name="targetUserId" value={item.userId} />
                  <input type="hidden" name="tableName" value="profiles" />
                  <button
                    type="submit"
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white"
                  >
                    Approve
                  </button>
                </form>
                <form action="/api/admin/action" method="post">
                  <input type="hidden" name="action" value="reject_kyc" />
                  <input type="hidden" name="targetUserId" value={item.userId} />
                  <input type="hidden" name="tableName" value="profiles" />
                  <input type="hidden" name="reason" value="Document mismatch" />
                  <button
                    type="submit"
                    className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white"
                  >
                    Reject
                  </button>
                </form>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <DocTile label="ID Front" url={item.idFrontUrl} />
              <DocTile label="ID Back" url={item.idBackUrl} />
              <DocTile label="Selfie" url={item.selfieUrl} />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
