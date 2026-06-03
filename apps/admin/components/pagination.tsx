import Link from 'next/link';

export const Pagination = (params: {
  total: number;
  page: number;
  pageSize: number;
  buildUrl: (page: number) => string;
}) => {
  const totalPages = Math.max(1, Math.ceil(params.total / params.pageSize));
  if (totalPages <= 1) return null;

  const prev = params.page > 1 ? params.page - 1 : null;
  const next = params.page < totalPages ? params.page + 1 : null;

  return (
    <div className="flex items-center justify-between rounded-b-2xl border-t border-slate-200 bg-white px-4 py-3 text-sm">
      <p className="text-slate-500">
        Page <span className="font-semibold">{params.page}</span> of{' '}
        <span className="font-semibold">{totalPages}</span> &mdash; {params.total.toLocaleString()} records
      </p>
      <div className="flex gap-2">
        {prev ? (
          <Link href={params.buildUrl(prev)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            Previous
          </Link>
        ) : null}
        {next ? (
          <Link href={params.buildUrl(next)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            Next
          </Link>
        ) : null}
      </div>
    </div>
  );
};
