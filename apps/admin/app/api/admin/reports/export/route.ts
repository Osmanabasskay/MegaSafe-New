import { NextResponse } from 'next/server';
import { getDashboardSummary, getGroupMonitor, getUsers } from '@/lib/admin-data';

const csvEscape = (value: string | number): string => {
  const raw = String(value ?? '');
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
};

const buildSimplePdf = (lines: string[]): string => {
  const escape = (text: string) =>
    text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

  const content = lines
    .slice(0, 40)
    .map((line, index) => `BT /F1 11 Tf 50 ${760 - index * 16} Td (${escape(line)}) Tj ET`)
    .join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];

  objects.forEach((objectContent, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${objectContent}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return pdf;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const format = (url.searchParams.get('format') ?? 'csv').toLowerCase();
  const from = url.searchParams.get('from') || 'all-time';
  const to = url.searchParams.get('to') || 'today';

  const [summary, users, groups] = await Promise.all([
    getDashboardSummary(),
    getUsers(),
    getGroupMonitor(),
  ]);

  const reportRows: Array<[string, string | number]> = [
    ['Date range', `${from} -> ${to}`],
    ['Total users', summary.kpis.totalUsers],
    ['Active groups', summary.kpis.activeGroups],
    ['Open disputes', summary.kpis.openDisputes],
    ['Total volume (NLe)', summary.kpis.totalVolumeNLe.toFixed(2)],
    ['Approved KYC users', users.filter((user) => user.kycStatus === 'approved').length],
    ['Submitted KYC users', users.filter((user) => user.kycStatus === 'submitted').length],
    ['Suspicious groups', groups.filter((group) => group.suspicious).length],
  ];

  if (format === 'pdf') {
    const lines = [
      'MegaSafe Admin Report',
      `Date Range: ${from} -> ${to}`,
      ...reportRows.map(([label, value]) => `${label}: ${value}`),
    ];
    const pdf = buildSimplePdf(lines);
    return new Response(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="megasafe-report-${Date.now()}.pdf"`,
      },
    });
  }

  const csv = ['Metric,Value', ...reportRows.map(([label, value]) => `${csvEscape(label)},${csvEscape(value)}`)]
    .join('\n')
    .trim();

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="megasafe-report-${Date.now()}.csv"`,
    },
  });
}
