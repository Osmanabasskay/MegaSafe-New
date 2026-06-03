// Shared risk severity helpers + badges (Phase 3 / Phase 15).
// Banding: 0-20 low · 21-40 medium · 41-60 high · 61-80 critical · 81-100 extreme.

export type Severity = 'low' | 'medium' | 'high' | 'critical' | 'extreme';

export const severityForScore = (score: number): Severity => {
  if (score <= 20) return 'low';
  if (score <= 40) return 'medium';
  if (score <= 60) return 'high';
  if (score <= 80) return 'critical';
  return 'extreme';
};

const SEVERITY_STYLE: Record<Severity, string> = {
  low:      'bg-emerald-100 text-emerald-700 ring-emerald-200',
  medium:   'bg-amber-100 text-amber-700 ring-amber-200',
  high:     'bg-orange-100 text-orange-700 ring-orange-200',
  critical: 'bg-rose-100 text-rose-700 ring-rose-200',
  extreme:  'bg-purple-200 text-purple-900 ring-purple-300',
};

export const SeverityBadge = (params: { severity: string }) => {
  const sev = (['low', 'medium', 'high', 'critical', 'extreme'].includes(params.severity)
    ? params.severity
    : 'low') as Severity;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ring-1 ${SEVERITY_STYLE[sev]}`}>
      {sev}
    </span>
  );
};

/** Numeric 0-100 risk score badge, coloured by its severity band. */
export const RiskScoreBadge = (params: { score: number; showLabel?: boolean }) => {
  const score = Math.max(0, Math.min(100, Math.round(params.score)));
  const sev = severityForScore(score);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums ring-1 ${SEVERITY_STYLE[sev]}`}>
      {score}
      {params.showLabel !== false ? <span className="uppercase">· {sev}</span> : null}
    </span>
  );
};
