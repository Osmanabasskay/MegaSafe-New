'use client';

import { useState } from 'react';

type Tone = 'neutral' | 'primary' | 'danger' | 'warning';

const toneClass: Record<Tone, string> = {
  neutral: 'border-slate-300 text-slate-700 hover:bg-slate-50',
  primary: 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700',
  warning: 'border-orange-500 bg-orange-500 text-white hover:bg-orange-600',
  danger:  'border-rose-600 bg-rose-600 text-white hover:bg-rose-700',
};

/**
 * Confirm-guarded admin action. Submits a POST form to /api/admin/action.
 * Destructive actions (danger/warning, or `confirm` provided) require an
 * explicit confirmation dialog before the request fires (Phase 5/6 rule:
 * "do not allow destructive actions without confirmation").
 */
export const AdminActionButton = (params: {
  action: string;
  label: string;
  targetUserId?: string;
  targetRecordId?: string;
  tone?: Tone;
  confirm?: string;
  requireReason?: boolean;
  newStatus?: string;
  severity?: string;
}) => {
  const [busy, setBusy] = useState(false);
  const tone = params.tone ?? 'neutral';
  const needsConfirm = params.confirm ?? (tone === 'danger' || tone === 'warning' ? `Confirm: ${params.label}?` : undefined);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (needsConfirm && !window.confirm(needsConfirm)) {
      e.preventDefault();
      return;
    }
    if (params.requireReason) {
      const reason = window.prompt('Enter a reason / note (required, audit-logged):') ?? '';
      if (!reason.trim()) {
        e.preventDefault();
        return;
      }
      const input = e.currentTarget.querySelector('input[name="reason"]') as HTMLInputElement | null;
      if (input) input.value = reason.trim();
    }
    setBusy(true);
  };

  return (
    <form method="post" action="/api/admin/action" onSubmit={onSubmit} className="inline">
      <input type="hidden" name="action" value={params.action} />
      {params.targetUserId ? <input type="hidden" name="targetUserId" value={params.targetUserId} /> : null}
      {params.targetRecordId ? <input type="hidden" name="targetRecordId" value={params.targetRecordId} /> : null}
      {params.newStatus ? <input type="hidden" name="newStatus" value={params.newStatus} /> : null}
      {params.severity ? <input type="hidden" name="severity" value={params.severity} /> : null}
      <input type="hidden" name="reason" value="" />
      <button
        type="submit"
        disabled={busy}
        className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide transition disabled:opacity-50 ${toneClass[tone]}`}
      >
        {busy ? '…' : params.label}
      </button>
    </form>
  );
};
