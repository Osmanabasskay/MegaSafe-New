import type { ReactNode } from 'react';

export const DataTable = (params: {
  headers: string[];
  rows: Array<Array<ReactNode>>;
  emptyText?: string;
}) => (
  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-sm">
        <thead className="bg-slate-50">
          <tr>
            {params.headers.map((header) => (
              <th
                key={header}
                className="border-b border-slate-200 px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-600"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {params.rows.length === 0 ? (
            <tr>
              <td className="px-4 py-6 text-center text-slate-500" colSpan={params.headers.length}>
                {params.emptyText ?? 'No records found.'}
              </td>
            </tr>
          ) : (
            params.rows.map((row, index) => (
              <tr key={`row-${index}`} className="border-b border-slate-100 last:border-b-0">
                {row.map((cell, cellIndex) => (
                  <td key={`cell-${index}-${cellIndex}`} className="px-4 py-3 text-slate-700">
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </div>
);
