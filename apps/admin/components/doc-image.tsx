'use client';

import { useState } from 'react';

/**
 * Renders a KYC document (ID card or selfie) inline.
 * Falls back gracefully when the signed URL is missing or the image fails to load
 * (e.g. the document is a PDF or the bucket path is wrong).
 */
export function DocImage({ label, url }: { label: string; url: string | null }) {
  const [failed, setFailed] = useState(false);

  if (!url) {
    return (
      <div className="flex h-36 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-xs text-slate-400">
        Not submitted
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {failed ? (
        <div className="flex h-36 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-amber-200 bg-amber-50 px-3">
          <span className="text-center text-xs font-medium text-amber-600">Image preview unavailable</span>
          <span className="text-center text-[11px] text-amber-500">(may be a PDF — open link below)</span>
        </div>
      ) : (
        <a href={url} target="_blank" rel="noreferrer" title={`Click to open ${label} full size`}>
          <img
            src={url}
            alt={label}
            className="w-full cursor-zoom-in rounded-lg border border-slate-200 bg-slate-100 object-contain transition hover:opacity-90"
            style={{ maxHeight: '200px', minHeight: '64px' }}
            onError={() => setFailed(true)}
          />
        </a>
      )}
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="block text-center text-[11px] font-semibold text-blue-700 hover:underline"
      >
        Open full size ↗
      </a>
    </div>
  );
}
