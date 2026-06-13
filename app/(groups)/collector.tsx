import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  TextInput,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Smartphone,
  Wallet,
  FileText,
  Lock,
  ChevronDown,
  ChevronUp,
  Edit3,
  Send,
  Plus,
  Minus,
  Share2,
} from 'lucide-react-native';
import {
  fetchGroupContributors,
  recordCollectorContribution,
  getGroupById,
  fetchActiveCollectorForGroup,
  fetchMemberContributionCoverage,
  fetchActivePeriodForGroup,
  type ActiveCollectorInfo,
  type MemberContributionCoverage,
} from '../../src/services/groupService';
import { useAuthStore } from '../../src/store/authStore';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';
import { useKycGuard } from '../../src/hooks/useKycGuard';
import type { ContributorAssignment, Frequency, OsusuGroup } from '../../src/types/group';

type DurationUnit = 'day' | 'week' | 'month';
type FlowStep = 'details' | 'summary' | 'success';
type CollectionMethod = 'cash_collected' | 'orange_money' | 'afrimoney' | 'qmoney';

const METHOD_LABELS: Record<CollectionMethod, string> = {
  cash_collected: 'Cash',
  orange_money: 'Orange Money',
  afrimoney: 'Afrimoney',
  // QMoney is manual/physical collection only — NOT a Monime digital payment method.
  // Backend reconciles it as a cash-equivalent manual transaction, not a Monime checkout.
  qmoney: 'QMoney (Manual)',
};

const METHOD_LOGOS: Partial<Record<CollectionMethod, { source: number; title: string }>> = {
  orange_money: { source: require('../../assets/payment-providers/orange-money.png'), title: 'Orange Money Logo' },
  afrimoney: { source: require('../../assets/payment-providers/afrimoney.png'), title: 'Afrimoney Logo' },
  qmoney: { source: require('../../assets/payment-providers/qmoney.png'), title: 'QMoney Logo' },
};

const UNIT_LABELS: Record<DurationUnit, string> = {
  day: 'Day(s)',
  week: 'Week(s)',
  month: 'Month(s)',
};

const STEP_INDEX: Record<FlowStep, number> = {
  details: 0,
  summary: 1,
  success: 2,
};

const STEP_TITLES: Record<FlowStep, string> = {
  details: 'Payment Details',
  summary: 'Transaction Summary',
  success: 'Payment Recorded',
};

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatMonthYear(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  });
}

function normalizePeriodStart(date: Date, unit: DurationUnit): Date {
  if (unit !== 'month') return date;
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function computeToDate(from: Date, count: number, unit: DurationUnit): Date {
  const to = new Date(from);
  if (unit === 'day') to.setDate(to.getDate() + count - 1);
  else if (unit === 'week') to.setDate(to.getDate() + count * 7 - 1);
  else return new Date(from.getFullYear(), from.getMonth() + count, 0);
  return to;
}

function buildPeriodString(from: Date, to: Date): string {
  return `${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`;
}

function dateFromIso(dateString: string | null | undefined): Date | null {
  if (!dateString) return null;
  const date = new Date(`${dateString}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatPeriodRange(from: Date, to: Date, unit: DurationUnit): string {
  if (unit === 'month') return `${formatMonthYear(from)} to ${formatMonthYear(to)}`;
  return `${formatDate(from)} to ${formatDate(to)}`;
}

function durationUnitFromFrequency(frequency: Frequency | null | undefined): DurationUnit {
  if (frequency === 'daily') return 'day';
  if (frequency === 'monthly') return 'month';
  return 'week';
}

function frequencyLabel(frequency: Frequency | null | undefined): string {
  if (frequency === 'daily') return 'daily';
  if (frequency === 'monthly') return 'monthly';
  if (frequency === 'biweekly') return 'biweekly';
  return 'weekly';
}

type ReceiptPdfInput = {
  receiptNumber: string;
  contributionId: string | null;
  groupName: string;
  memberName: string;
  amount: string;
  collectionDate: Date;
  coverageStartDate: Date;
  toDate: Date;
  durationCount: number;
  durationUnit: DurationUnit;
  collectionMethod: CollectionMethod;
  collectorName: string;
  note?: string;
};

function escapePdfText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function pdfText(text: string, x: number, y: number, size: number, color = '1 1 1', bold = false): string {
  const font = bold ? 'F2' : 'F1';
  return `BT\n${color} rg\n/${font} ${size} Tf\n${x} ${y} Td\n(${escapePdfText(text)}) Tj\nET`;
}

function pdfRect(x: number, y: number, width: number, height: number, color: string, stroke = false): string {
  return stroke
    ? `${color} RG\n${x} ${y} ${width} ${height} re S`
    : `${color} rg\n${x} ${y} ${width} ${height} re f`;
}

function pdfLine(x1: number, y1: number, x2: number, y2: number, color = '0.14 0.14 0.16'): string {
  return `${color} RG\n1 w\n${x1} ${y1} m\n${x2} ${y2} l S`;
}

function pdfCircle(x: number, y: number, radius: number, color: string, stroke = false): string {
  const c = radius * 0.5522847498;
  const path = [
    `${x + radius} ${y} m`,
    `${x + radius} ${y + c} ${x + c} ${y + radius} ${x} ${y + radius} c`,
    `${x - c} ${y + radius} ${x - radius} ${y + c} ${x - radius} ${y} c`,
    `${x - radius} ${y - c} ${x - c} ${y - radius} ${x} ${y - radius} c`,
    `${x + c} ${y - radius} ${x + radius} ${y - c} ${x + radius} ${y} c`,
  ].join('\n');
  return stroke
    ? `${color} RG\n1 w\n${path}\nS`
    : `${color} rg\n${path}\nf`;
}

const RECEIPT_LOGO_IMAGE = {
  width: 160,
  height: 156,
  rgb:
    'eNrt3cltG0EQheFoFIcdoCPRyVE4D+UhoH0wYBAackT2VL3a/gZvAhfxQ73eZpprxbe3949Fa9Te3j/OH8oP8/n756MHUuayYuUTXIhdcb2Jv5VF2RvXj/glXIj9cJ2I8c2Da068gQsxvuBmIN7GhTih7/EV8M2J+63vk6+Ab1rfI/HG0/FN7nvx6fjie+6L9RBflEN8vee/5LbYV7m+Qe8s8w1Zf2YM5rq+YbhQuT1sZqSdeX3SUAplQ1+nj3cdCOLMvlZD4uHKmXFlaQBxaVyUS+BaLUdDXOUq6G3oUcS3XnlkL7JeUe5ato/+VKhaIX4mkxMOfiCuiyuQnUb8qqzToEspu7eq2RXXe90jRHYC8bmF4LrKu99YEt/qxI++f/Pt4JBd/uHEetnMXbP3vkYUrpI1eSG3IQ6XzUm89+799okaB3UP3wyyOYkblHAq3Gwpvf3u2TaGsqEnId5+9zz1++vPj9tHEmtKeI/vVvDkTxBfL2Fv4iPfkfIZ3CjlWr7ilD7HvUucbTCWZyCdrYSfwf1CnHO8TQlf9H1JVk9czldA/BJuct8kxKV9KeFaxBrftFuH+Pb2zRDRrsQyX0oY37G+fsT44muCO434+kigyvoGJVylF65yeQC+G8SFrgApOkuKIja/DoQSDt80NGfFN9umsF/DVz+Kvo3ob9ObEq5ewg22k/A1Wc7aU8ZXGdHbrNvKzJI0vlayrxIT0d4RbS6b8NLKmb5+stmIp/kKZLNdAN+DOMn4Ct+cvlFjLXwz7wVTwuV8bYnxtbriznblWUaMr2yV8lZkeBfc8r6VLyhEdLNbC8/v5iaiO/n2K2F8e/uWmyUJfInoTmco3UXBF19mSXV9rYjpgq+fgZbZl4gO940dYjFL0u8P9vMtRCzzJaLxJaIr+tIFR82SZGc12JYwXfD2TyaV8KULHu5LF+zqe378PhEd9cOUrhfXEdH4EtGuPw+Nb6ftfvGJ0HTB4hL2PpyBLjjQV3D4Bl1wYESHHK5CRMtKOOrwHCJa4Ks8vI6Ibuw7ZK8wG3HszxES0a6+4T83SUR38mW7Xz9LEh8by3Z/YAkvSeOi6BDfpWpEdMgQeglb+/uSspXw0jYiurcvtxZmuCIL3wazpDzEzJIoYbrg6iVMF9zJ1++MLCJ6eAnjG1XCRHRjYhayWhKzkKXxTUI82VdAHKVMFyzzjVJmliQm1tMT0bG+UauXoyI6hDh2dXpaRPfuiIno3tMlItpVeSVo+P77bIbEK1mb3AXffW4PVrrgZ16kIigRff5hVq82bZbkOkgjogN9B8r2870r5T23GuKbsISHyzYuYcGSCCUcG9HIdo3okxJeU5s58V1ume+ReM1uhr6PDoUQ+/4nXjRr35Os1hPT/IiP0GJfiDXEtw89Mcoa36gSRtmbOLYXRl8wls5MTCEX3TEE11z5+RdHtgT0lZdFtn2DFWJkUYZ1jjJfYz/ocv/gXyC1xeM=',
  alpha:
    'eNrdnH1xIzEMxQUhEAohEAIhEArhIARCIQTCQimEg1AG6vQyd9d8ONKTnixP/U87m83uL3qybMneFfE3lWWb/mtn6PTZdF9th5w/H8+8KXRyBd7ze4K/pgLv6T0n86ligKC1fzqfKgaIesM8vsvRyXzq4Ls6ugyfPvx8JT73wfX5VLfF+Yqs6OSz4l+ZzjafJz7XeeIYby+D243NV0E4Nt8GzK/qejM6vg1piggDeGL3nMb5y9W3Zsz7qSPCJEDK1bryIytPKgfMegUZUGHPHgalw80JLOP9/Sc5JN6bkKdtfsAuAUx1iXrAYd8bZkhuQMak6/slfhtxWt2NBjiYgDyU6/LngPAJYzCyLYPLzAH00UUcURiAf772gXnURMDbeTkVUBgWVI3zGV8+5/kUa7FhLg6omgT0nx0A1AAmBDgIs/52UtVfoWELN+CLF1CvI3JwXI0aUN0u923SBxDG+VwK35YktuDEKQJ4RJdV7hYD2w2YHVNzfCagKdYHGTDJt5oBHTn4z+MT/MdkahidBuznE2xdb3G+4KQr44CCCDyBL9NDZD0+Tw2tNsJcTn5L1IJ6DSjmHqZ+PlJ5L8Ynpnz/z9smGPCIGzA9iZnUg8PFqTKBkYl4bYRBF6JnC/weL5a0OCB0S5jvI8kHZo4zDAiHthX4vH2kj084fLt0lpTaDTEhSwpUxBfI4r6OHyocUGh8Kt0CW3zSLLCVnUlzhJnCl0iDTb5mgc3s28F3XpyvMsLYfNIaYeJ82s3n7yBSzCflfGFAB1+rwBw+6eM7SWeE2dvze+mMMJrh02a+Y6UDnv18m7WhqU9gR3r00imwJ31rjDA6ke81EGFc9flGB7TKu80RRol8FUOIszzeJvDjov4yAnuWjzojjGf5iMkHAb6J6ym5RoGVzCcdfEAWR48wrsXLxkmqQpsUWxxQmHz0CIM8ACNbg8DAGnmLwMgifncltYWPCNhcaKMYkMwHGnC6A/q3vjQJTDegthpwvsAQYEMlFVJ4eK19IZ9yDfhKDtGKPIraMIQghEURJvPQ0C1gRYQREp1U1TmERVeUBhNdsEZgXpApEhjY0NfDp9EXe3gBUw54GGXYxB3FCb67kp9S3jjCEjiNVBphlItHFphO5+E7eQG1AI+35a6EjiSwFr4DC/Eqo/pYQEcSWGVXQ/cccPCawkR5lMmnViIaKp/B7eBdGGVNmngGVPP9KwsA0vKdMj5qzkMHDJp4Xh+OAM4xYdhHZ4j8XlQWYCBmerl0taXhmKWzHkJZoi0N9xgxcalPeq/DFw==',
};

function base64ToBinary(base64: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (const char of base64.replace(/=+$/, '')) {
    const value = chars.indexOf(char);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return output;
}

function pdfLogoMark(x: number, y: number): string {
  return [
    pdfCircle(x + 44, y + 40, 42, '1 1 1'),
    'q',
    `70 0 0 68 ${x + 9} ${y + 6} cm`,
    '/LogoImage Do',
    'Q',
  ].join('\n');
}

function createReceiptPdfBytes(input: ReceiptPdfInput): Uint8Array {
  const logoRgbStream = base64ToBinary(RECEIPT_LOGO_IMAGE.rgb);
  const logoAlphaStream = base64ToBinary(RECEIPT_LOGO_IMAGE.alpha);
  const amountValue = Number.parseFloat(input.amount || '0');
  const amount = `SLE${amountValue.toFixed(2)}`;
  const fees = 'SLE0.00';
  const total = amount;
  const paidFor = `${input.durationCount} ${UNIT_LABELS[input.durationUnit]}`;
  const contributionType =
    input.durationUnit === 'day' ? 'Daily' : input.durationUnit === 'week' ? 'Weekly' : 'Monthly';
  const period = formatPeriodRange(input.coverageStartDate, input.toDate, input.durationUnit);
  const periodDetailLabel =
    input.durationUnit === 'month'
      ? 'Starting and ending month paid for'
      : input.durationUnit === 'week'
        ? 'Starting and ending week paid for'
        : 'Starting and ending day paid for';
  const note = input.note?.trim() || 'Physical collection contribution';
  const generatedDate = new Date().toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const textCommands = [
    pdfRect(0, 0, 595, 842, '0.02 0.18 0.30'),
    pdfRect(0, 690, 595, 152, '0.04 0.28 0.43'),
    pdfText('Mi Osusu', 38, 770, 36, '1 0.45 0', true),
    pdfLogoMark(472, 748),
    pdfText('Successful Osusu Contribution', 138, 715, 22, '1 1 1', true),
    pdfRect(38, 455, 519, 210, '0.03 0.20 0.34', true),
    pdfLine(38, 595, 557, 595, '0.12 0.35 0.52'),
    pdfLine(38, 525, 557, 525, '0.12 0.35 0.52'),
    pdfText('Amount Contributed', 62, 625, 19),
    pdfText(amount, 420, 625, 22, '1 0.45 0', true),
    pdfText('Fine fees', 62, 555, 19),
    pdfText(fees, 425, 555, 20, '1 1 1', true),
    pdfText('Grand Total', 62, 485, 19),
    pdfText(total, 425, 485, 20, '1 1 1', true),
    pdfText('Member Name', 62, 390, 17),
    pdfText(input.memberName.slice(0, 30), 315, 390, 17, '1 1 1', true),
    pdfLine(38, 365, 557, 365, '0.12 0.35 0.52'),
    pdfText('Osusu Group Name', 62, 335, 17),
    pdfText(input.groupName.slice(0, 30), 315, 335, 17, '1 1 1', true),
    pdfLine(38, 310, 557, 310, '0.12 0.35 0.52'),
    pdfText('Contribution Type', 62, 280, 17),
    pdfText(contributionType, 315, 280, 17, '1 1 1', true),
    pdfLine(38, 255, 557, 255, '0.12 0.35 0.52'),
    pdfText('Period paid for', 62, 225, 17),
    pdfText(paidFor, 315, 225, 17, '1 1 1', true),
    pdfLine(38, 200, 557, 200, '0.12 0.35 0.52'),
    pdfText(periodDetailLabel, 62, 170, 15),
    pdfText(period, 315, 170, 15, '1 1 1', true),
    pdfLine(38, 145, 557, 145, '0.12 0.35 0.52'),
    pdfText('Date', 62, 115, 17),
    pdfText(generatedDate, 315, 115, 17, '1 1 1', true),
    pdfText('Receipt Number:', 62, 84, 17),
    pdfText(input.receiptNumber.slice(0, 24), 315, 84, 17, '1 1 1', true),
    pdfText(`Note: ${note.slice(0, 65)}`, 62, 52, 12, '0.82 0.91 0.96'),
    pdfText('Receipt generated by Mi Osusu application', 128, 28, 18),
  ].join('\n');

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 6 0 R >> /XObject << /LogoImage 7 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${textCommands.length} >>\nstream\n${textCommands}\nendstream\nendobj\n`,
    '6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n',
    `7 0 obj\n<< /Type /XObject /Subtype /Image /Width ${RECEIPT_LOGO_IMAGE.width} /Height ${RECEIPT_LOGO_IMAGE.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /SMask 8 0 R /Length ${logoRgbStream.length} >>\nstream\n${logoRgbStream}\nendstream\nendobj\n`,
    `8 0 obj\n<< /Type /XObject /Subtype /Image /Width ${RECEIPT_LOGO_IMAGE.width} /Height ${RECEIPT_LOGO_IMAGE.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${logoAlphaStream.length} >>\nstream\n${logoAlphaStream}\nendstream\nendobj\n`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object) => {
    offsets.push(pdf.length);
    pdf += object;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Uint8Array.from(pdf, (char) => char.charCodeAt(0));
}

function receiptFileName(receiptNumber: string): string {
  return `${receiptNumber.replace(/[^A-Za-z0-9-]/g, '_')}.pdf`;
}

function generateReceiptPdf(input: ReceiptPdfInput): string {
  const file = new File(Paths.cache, receiptFileName(input.receiptNumber));
  file.create({ overwrite: true });
  file.write(createReceiptPdfBytes(input));
  return file.uri;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionHeader({
  icon,
  title,
  color,
}: {
  icon?: React.ReactNode;
  title: string;
  color?: string;
}) {
  const { preferences } = useAppDataStore();
  const C = preferences.darkMode ? darkColors : lightColors;
  const textColor = color ?? C.text;
  return (
    <View style={styles.sectionHeader}>
      {icon ? icon : null}
      <Text style={[styles.sectionTitle, !icon && { marginLeft: 0 }, { color: textColor }]}>{title}</Text>
    </View>
  );
}

function SummaryRow({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  const { preferences } = useAppDataStore();
  const C = preferences.darkMode ? darkColors : lightColors;
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, { color: C.textSub }]}>{label}</Text>
      <Text
        style={[
          styles.summaryValue,
          { color: C.text },
          bold && { fontWeight: '800', color: '#F97316', fontSize: 15 },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function SummaryDivider() {
  const { preferences } = useAppDataStore();
  const C = preferences.darkMode ? darkColors : lightColors;
  return <View style={[styles.summaryDivider, { backgroundColor: C.border }]} />;
}

function SuccessDetailRow({ label, value }: { label: string; value: string }) {
  const { preferences } = useAppDataStore();
  const C = preferences.darkMode ? darkColors : lightColors;
  return (
    <View style={[styles.successDetailRow, { borderBottomColor: C.border }]}>
      <Text style={[styles.successDetailLabel, { color: C.textSub }]}>{label}</Text>
      <Text style={[styles.successDetailValue, { color: C.text }]}>{value}</Text>
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function CollectorScreen() {
  const router = useRouter();
  const { id, groupId: groupIdParam } = useLocalSearchParams<{ id?: string; groupId?: string }>();
  const groupId = id ?? groupIdParam ?? '';
  const { user } = useAuthStore();
  const { requireKyc } = useKycGuard();
  const { preferences } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;

  // Remote data
  const [group, setGroup] = useState<OsusuGroup | null>(null);
  const [contributors, setContributors] = useState<ContributorAssignment[]>([]);
  const [activeCollector, setActiveCollector] = useState<ActiveCollectorInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [memberCoverage, setMemberCoverage] = useState<MemberContributionCoverage | null>(null);
  const [isLoadingCoverage, setIsLoadingCoverage] = useState(false);
  const [activePeriodId, setActivePeriodId] = useState<string | null>(null);
  const [activePeriodLabel, setActivePeriodLabel] = useState<string | null>(null);

  // Flow
  const [step, setStep] = useState<FlowStep>('details');

  // Step 1 – Payment details
  const [selectedMember, setSelectedMember] = useState<ContributorAssignment | null>(null);
  const [showMemberPicker, setShowMemberPicker] = useState(false);
  const [collectionDate] = useState<Date>(() => new Date());
  const [coverageStartDate, setCoverageStartDate] = useState<Date>(() =>
    normalizePeriodStart(new Date(), 'month')
  );
  const [showCoverageDatePicker, setShowCoverageDatePicker] = useState(false);
  const [durationCount, setDurationCount] = useState(1);
  const [durationUnit, setDurationUnit] = useState<DurationUnit>('month');
  const [collectionMethod, setCollectionMethod] = useState<CollectionMethod>('cash_collected');
  const [notes, setNotes] = useState('');

  // Success
  const [isProcessing, setIsProcessing] = useState(false);
  const [receiptNumber, setReceiptNumber] = useState<string | null>(null);
  const [contributionId, setContributionId] = useState<string | null>(null);
  const [receiptPdfUri, setReceiptPdfUri] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const toDate = useMemo(
    () => computeToDate(coverageStartDate, durationCount, durationUnit),
    [coverageStartDate, durationCount, durationUnit]
  );
  const allowedDurationUnit = useMemo(
    () => durationUnitFromFrequency(group?.frequency),
    [group?.frequency]
  );
  // Display-only preview; server validates the submitted amount matches
  // contribution_amount × cycle_count for the declared period via record_physical_collection RPC.
  const amountPreview = useMemo(
    () => ((group?.contribution_amount ?? 0) * durationCount).toFixed(2),
    [group?.contribution_amount, durationCount]
  );

  useEffect(() => {
    async function loadData() {
      if (!groupId) return;
      setIsLoading(true);
      try {
        const [groupRes, contributorsRes, collectorRes, periodRes] = await Promise.all([
          getGroupById(groupId),
          fetchGroupContributors(groupId),
          fetchActiveCollectorForGroup(groupId),
          fetchActivePeriodForGroup(groupId),
        ]);
        if (groupRes.group) {
          setGroup(groupRes.group);
          const allowedUnit = durationUnitFromFrequency(groupRes.group.frequency);
          setDurationUnit(allowedUnit);
          setCoverageStartDate(normalizePeriodStart(new Date(), allowedUnit));
        }
        if (contributorsRes.contributors) {
          setContributors(contributorsRes.contributors);
        }
        setActiveCollector(collectorRes.collector);
        setActivePeriodId(periodRes.periodId);
        setActivePeriodLabel(periodRes.periodLabel);
      } catch {
        Alert.alert('Load Error', 'Failed to load group data.');
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [groupId]);

  useEffect(() => {
    let mounted = true;
    async function loadMemberCoverage() {
      if (!groupId || !selectedMember || !group) {
        setMemberCoverage(null);
        setIsLoadingCoverage(false);
        return;
      }

      setIsLoadingCoverage(true);
      const { coverage, error } = await fetchMemberContributionCoverage({
        groupId,
        memberId: selectedMember.userId,
      });
      if (!mounted) return;

      setMemberCoverage(coverage);
      const nextDate =
        dateFromIso(coverage.nextUnpaidDate) ??
        dateFromIso(group.cycle_start_date) ??
        new Date();
      setCoverageStartDate(normalizePeriodStart(nextDate, allowedDurationUnit));
      setDurationUnit(allowedDurationUnit);
      setDurationCount(1);
      setIsLoadingCoverage(false);

      if (error) {
        Alert.alert('Coverage Check Failed', error.message);
      }
    }

    void loadMemberCoverage();
    return () => {
      mounted = false;
    };
  }, [allowedDurationUnit, group, groupId, selectedMember]);

  const handleCoverageDateChange = (_event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setShowCoverageDatePicker(false);
    if (selected) setCoverageStartDate(normalizePeriodStart(selected, durationUnit));
  };

  const handleDurationUnitChange = (unit: DurationUnit) => {
    if (unit !== allowedDurationUnit) return;
    setDurationUnit(unit);
    setCoverageStartDate((current) =>
      normalizePeriodStart(unit === 'month' ? collectionDate : current, unit)
    );
    if (unit === 'month') {
      const monthsRemainingInYear = 12 - collectionDate.getMonth();
      setDurationCount((current) => Math.min(current, monthsRemainingInYear));
    }
  };

  const validateDetails = (): boolean => {
    if (!selectedMember) {
      Alert.alert('Selection Required', 'Please select a contributor from the list.');
      return false;
    }
    if (!activeCollector) {
      Alert.alert('Collector Required', 'No active collector is assigned to this group. Ask the admin to assign a verified collector before collecting payment.');
      return false;
    }
    // Guard: the signed-in user must be the active collector for this group.
    // The record_physical_collection RPC enforces the same check server-side.
    if (!user || activeCollector.profileId !== user.id) {
      Alert.alert(
        'Not Authorised',
        `Only the assigned collector can record payments for this group. The active collector is ${activeCollector.displayName}.`,
      );
      return false;
    }
    if (!activePeriodId) {
      Alert.alert('No Active Period', 'No open payment period found for this group. Ask the group admin to create payment periods before recording collections.');
      return false;
    }
    if (durationUnit !== allowedDurationUnit) {
      Alert.alert(
        'Period Not Allowed',
        `This is a ${frequencyLabel(group?.frequency)} Osusu. The collector can only record ${UNIT_LABELS[allowedDurationUnit]} payments.`
      );
      setDurationUnit(allowedDurationUnit);
      setCoverageStartDate(normalizePeriodStart(new Date(), allowedDurationUnit));
      return false;
    }
    const amountVal = Number.parseFloat(amountPreview);
    if (!Number.isFinite(amountVal) || amountVal <= 0 || !group?.contribution_amount) {
      Alert.alert('Invalid Amount', 'This group does not have a valid Osusu contribution amount configured.');
      return false;
    }
    return true;
  };

  const goToSummary = () => {
    if (!validateDetails()) return;
    setStep('summary');
  };

  const confirmAndSubmit = () => {
    Alert.alert(
      'Collector Responsibility',
      `Please confirm you have reviewed every value entered for this payment.\n\nMember: ${selectedMember?.displayName ?? 'Member'}\nAmount: NLe ${Number.parseFloat(amountPreview).toFixed(2)}\nPeriod: ${activePeriodLabel ?? 'Current period'}\nMethod: ${METHOD_LABELS[collectionMethod]}\n\nBy choosing Yes, you accept responsibility for any wrong amount or payment detail submitted.`,
      [
        { text: 'Edit', style: 'cancel', onPress: () => setStep('details') },
        { text: 'Yes, Send', style: 'destructive', onPress: () => void handleConfirmSend() },
      ],
    );
  };

  const getCollectorDisplayName = (): string => {
    const metadata = (user?.user_metadata ?? {}) as Record<string, unknown>;
    const name =
      (typeof metadata.full_name === 'string' && metadata.full_name.trim()) ||
      (typeof metadata.name === 'string' && metadata.name.trim()) ||
      user?.email ||
      user?.phone ||
      'Collector';
    return name;
  };

  const buildReceiptInput = (rn: string, cid: string | null): ReceiptPdfInput | null => {
    if (!selectedMember || !group) return null;
    return {
      receiptNumber: rn,
      contributionId: cid,
      groupName: group.name,
      memberName: selectedMember.displayName,
      amount: amountPreview,
      collectionDate,
      coverageStartDate,
      toDate,
      durationCount,
      durationUnit,
      collectionMethod,
      collectorName: getCollectorDisplayName(),
      note: notes.trim() || undefined,
    };
  };

  const generateCurrentReceiptPdf = (rn = receiptNumber, cid = contributionId): string | null => {
    if (!rn) return null;
    const receiptInput = buildReceiptInput(rn, cid);
    if (!receiptInput) return null;
    const uri = generateReceiptPdf(receiptInput);
    setReceiptPdfUri(uri);
    return uri;
  };

  const shareReceiptPdf = async () => {
    if (!receiptNumber) return;
    setIsGeneratingPdf(true);
    try {
      const uri = receiptPdfUri ?? generateCurrentReceiptPdf();
      if (!uri) throw new Error('Receipt details are incomplete.');
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) throw new Error('PDF sharing is not available on this device.');
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `Mi Osusu Receipt ${receiptNumber}`,
        UTI: 'com.adobe.pdf',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unable to generate or share the PDF receipt.';
      Alert.alert('Receipt Error', message);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleConfirmSend = async () => {
    if (!requireKyc('record physical collection')) return;
    if (!selectedMember || !groupId || !user || !activePeriodId) return;
    setIsProcessing(true);
    try {
      const { receiptNumber: rn, contributionId: cid, error } = await recordCollectorContribution({
        groupId,
        memberId: selectedMember.userId,
        collectorUserId: user.id,
        amount: parseFloat(amountPreview),
        periodId: activePeriodId,
        collectionMethod: collectionMethod === 'cash_collected' ? 'cash' : collectionMethod,
        notes: notes.trim() || undefined,
      });
      if (error) throw error;
      setReceiptNumber(rn);
      setContributionId(cid);
      if (rn) generateCurrentReceiptPdf(rn, cid);
      setStep('success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
      Alert.alert('Recording Failed', message);
    } finally {
      setIsProcessing(false);
    }
  };

  const resetFlow = () => {
    setStep('details');
    setSelectedMember(null);
    setShowMemberPicker(false);
    setCoverageStartDate(normalizePeriodStart(new Date(), allowedDurationUnit));
    setDurationCount(1);
    setDurationUnit(allowedDurationUnit);
    setCollectionMethod('cash_collected');
    setNotes('');
    setReceiptNumber(null);
    setContributionId(null);
    setReceiptPdfUri(null);
  };

  const handleBackPress = () => {
    if (step === 'details') {
      router.back();
    } else if (step === 'summary') {
      setStep('details');
    } else {
      router.back();
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: C.bg }]}>
        <ActivityIndicator size="large" color="#F97316" />
        <Text style={[styles.loadingText, { color: C.textSub }]}>Synchronizing live group data...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {/* Header */}
        <View style={[styles.header, { backgroundColor: C.bg, borderBottomColor: C.border }]}>
          <TouchableOpacity onPress={handleBackPress} style={[styles.backButton, { backgroundColor: C.inputBg }]}>
            <ArrowLeft size={24} color="#F97316" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: C.text }]}>{STEP_TITLES[step]}</Text>
            <Text style={styles.headerSubtitle}>{group?.name ?? 'Osusu Group'}</Text>
          </View>
          {step !== 'success' && (
            <View style={styles.stepDots}>
              {[0, 1].map((i) => (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    i <= STEP_INDEX[step] ? styles.dotActive : styles.dotInactive,
                  ]}
                />
              ))}
            </View>
          )}
        </View>

        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.content}>
            {step === 'details' && (
              <DetailsStep
                contributors={contributors}
                selectedMember={selectedMember}
                activeCollector={activeCollector}
                setSelectedMember={setSelectedMember}
                showMemberPicker={showMemberPicker}
                setShowMemberPicker={setShowMemberPicker}
                collectionDate={collectionDate}
                coverageStartDate={coverageStartDate}
                setShowCoverageDatePicker={setShowCoverageDatePicker}
                memberCoverage={memberCoverage}
                isLoadingCoverage={isLoadingCoverage}
                amount={amountPreview}
                baseContributionAmount={group?.contribution_amount ?? 0}
                durationCount={durationCount}
                setDurationCount={setDurationCount}
                durationUnit={durationUnit}
                setDurationUnit={handleDurationUnitChange}
                allowedDurationUnit={allowedDurationUnit}
                groupFrequency={group?.frequency ?? null}
                toDate={toDate}
                collectionMethod={collectionMethod}
                setCollectionMethod={setCollectionMethod}
                notes={notes}
                setNotes={setNotes}
                onNext={goToSummary}
              />
            )}

            {step === 'summary' && (
              <SummaryStep
                selectedMember={selectedMember}
                amount={amountPreview}
                collectionDate={collectionDate}
                coverageStartDate={coverageStartDate}
                toDate={toDate}
                durationCount={durationCount}
                durationUnit={durationUnit}
                collectionMethod={collectionMethod}
                notes={notes}
                isProcessing={isProcessing}
                onEdit={() => setStep('details')}
                onConfirm={confirmAndSubmit}
              />
            )}

            {step === 'success' && (
              <SuccessStep
                memberName={selectedMember?.displayName ?? '—'}
                amount={amountPreview}
                durationCount={durationCount}
                collectionDate={collectionDate}
                coverageStartDate={coverageStartDate}
                toDate={toDate}
                durationUnit={durationUnit}
                collectionMethod={collectionMethod}
                receiptNumber={receiptNumber}
                receiptPdfUri={receiptPdfUri}
                isGeneratingPdf={isGeneratingPdf}
                onShareReceipt={shareReceiptPdf}
                onRecordAnother={resetFlow}
                onDone={() => router.replace({
                  pathname: '/(groups)/manage/[id]',
                  params: { id: groupId, ledgerRefresh: String(Date.now()) },
                })}
              />
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* iOS Coverage Start Date Picker Modal */}
      {Platform.OS === 'ios' && (
        <Modal visible={showCoverageDatePicker} transparent animationType="slide">
          <View style={styles.dateModalOverlay}>
            <View style={[styles.dateModalContent, { backgroundColor: C.card }]}>
              <View style={[styles.dateModalHeader, { borderBottomColor: C.border }]}>
                <Text style={[styles.dateModalTitle, { color: C.text }]}>Select Coverage Start</Text>
                <TouchableOpacity onPress={() => setShowCoverageDatePicker(false)}>
                  <Text style={styles.dateModalDone}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={coverageStartDate}
                mode="date"
                display="inline"
                onChange={handleCoverageDateChange}
              />
            </View>
          </View>
        </Modal>
      )}

      {/* Android Date Picker */}
      {Platform.OS === 'android' && showCoverageDatePicker && (
        <DateTimePicker
          value={coverageStartDate}
          mode="date"
          display="calendar"
          onChange={handleCoverageDateChange}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Step Components ──────────────────────────────────────────────────────────

function DetailsStep({
  contributors,
  selectedMember,
  activeCollector,
  setSelectedMember,
  showMemberPicker,
  setShowMemberPicker,
  collectionDate,
  coverageStartDate,
  setShowCoverageDatePicker,
  memberCoverage,
  isLoadingCoverage,
  amount,
  baseContributionAmount,
  durationCount,
  setDurationCount,
  durationUnit,
  setDurationUnit,
  allowedDurationUnit,
  groupFrequency,
  toDate,
  collectionMethod,
  setCollectionMethod,
  notes,
  setNotes,
  onNext,
}: {
  contributors: ContributorAssignment[];
  selectedMember: ContributorAssignment | null;
  activeCollector: ActiveCollectorInfo | null;
  setSelectedMember: (m: ContributorAssignment) => void;
  showMemberPicker: boolean;
  setShowMemberPicker: (v: boolean) => void;
  collectionDate: Date;
  coverageStartDate: Date;
  setShowCoverageDatePicker: (v: boolean) => void;
  memberCoverage: MemberContributionCoverage | null;
  isLoadingCoverage: boolean;
  amount: string;
  baseContributionAmount: number;
  durationCount: number;
  setDurationCount: (v: number) => void;
  durationUnit: DurationUnit;
  setDurationUnit: (v: DurationUnit) => void;
  allowedDurationUnit: DurationUnit;
  groupFrequency: Frequency | null;
  toDate: Date;
  collectionMethod: CollectionMethod;
  setCollectionMethod: (v: CollectionMethod) => void;
  notes: string;
  setNotes: (v: string) => void;
  onNext: () => void;
}) {
  const { preferences } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;
  const isMonthlyPeriod = durationUnit === 'month';
  const rangeStartLabel =
    durationUnit === 'day' ? 'Days From' : durationUnit === 'week' ? 'Week Starting' : 'Starting Month';
  const rangeEndLabel =
    durationUnit === 'day' ? 'Days To' : durationUnit === 'week' ? 'Week Ending' : 'Ending Month';
  const formattedRangeStart = isMonthlyPeriod ? formatMonthYear(coverageStartDate) : formatDate(coverageStartDate);
  const formattedRangeEnd = isMonthlyPeriod ? formatMonthYear(toDate) : formatDate(toDate);
  const maxDurationCount = isMonthlyPeriod ? 12 - coverageStartDate.getMonth() : 365;
  const canIncreaseDuration = durationCount < maxDurationCount;
  const nextUnpaidLabel = memberCoverage?.lastPaidToDate
    ? `Last paid through ${formatDate(new Date(`${memberCoverage.lastPaidToDate}T00:00:00`))}. This payment starts from the next unpaid ${durationUnit}.`
    : selectedMember
      ? `No prior payment found for this member. This payment starts from the first unpaid ${durationUnit}.`
      : 'Select a contributor to calculate the next unpaid period.';

  return (
    <>
      <View style={[styles.collectorIdentityCard, { backgroundColor: C.card, borderColor: C.border }]}>
        {activeCollector?.photoUrl ? (
          <View style={styles.collectorIdentityPhoto}>
            <Image source={{ uri: activeCollector.photoUrl }} style={styles.collectorIdentityImage} />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={[styles.collectorIdentityLabel, { color: C.textMuted }]}>Authorized Collector</Text>
          <Text style={[styles.collectorIdentityName, { color: C.text }]}>
            {activeCollector?.displayName ?? 'No active collector assigned'}
          </Text>
          <Text style={[styles.collectorIdentityHint, { color: C.textSub }]}>
            Members should only pay the verified collector shown here.
          </Text>
        </View>
      </View>

      {/* Member Selection */}
      <View style={styles.section}>
        <SectionHeader title="Select Contributor" />
        <TouchableOpacity
          style={styles.pickerTrigger}
          onPress={() => setShowMemberPicker(!showMemberPicker)}
        >
          <Text style={[styles.pickerText, { color: C.text }, !selectedMember && { color: C.textMuted }]}>
            {selectedMember ? selectedMember.displayName : 'Choose a member from the group'}
          </Text>
          {showMemberPicker ? (
            <ChevronUp size={20} color={C.textSub} />
          ) : (
            <ChevronDown size={20} color={C.textSub} />
          )}
        </TouchableOpacity>
        {showMemberPicker && (
          <View style={[styles.pickerDropdown, { backgroundColor: C.card, borderColor: C.borderStrong }]}>
            {contributors.length === 0 ? (
              <Text style={[styles.emptyPickerText, { color: C.textSub }]}>No contributors assigned yet.</Text>
            ) : (
              contributors.map((item) => (
                <TouchableOpacity
                  key={item.userId}
                  style={[styles.pickerItem, { borderBottomColor: C.border }]}
                  onPress={() => {
                    setSelectedMember(item);
                    setShowMemberPicker(false);
                  }}
                >
                  <Text style={[styles.pickerItemName, { color: C.text }]}>{item.displayName}</Text>
                  <Text style={[styles.pickerItemPhone, { color: C.textSub }]}>{item.phone ?? 'No phone'}</Text>
                </TouchableOpacity>
              ))
            )}
          </View>
        )}
      </View>

      {/* Collection date */}
      <View style={styles.section}>
        <SectionHeader title="Collection Date" />
        <View style={styles.lockedDateButton}>
          <Text style={[styles.datePickerText, { color: C.text }]}>{formatDate(collectionDate)}</Text>
          <Lock size={16} color={C.textMuted} />
        </View>
        <Text style={[styles.helperText, { color: C.textSub }]}>Collection date is locked to today for audit accuracy.</Text>
      </View>

      {/* Amount & Duration */}
      <View style={styles.section}>
        <SectionHeader title="Amount & Period" />

        <View style={styles.amountDurationRow}>
          {/* Amount */}
          <View style={styles.amountBox}>
            <Text style={[styles.fieldLabel, { color: C.textSub }]}>Amount (NLe)</Text>
            <View style={styles.inputWrapper}>
              <Text style={[styles.currencyPrefix, { color: C.text }]}>NLe</Text>
              <Text style={[styles.lockedAmountText, { color: C.text }]}>{Number.parseFloat(amount).toFixed(2)}</Text>
              <Lock size={15} color={C.textMuted} />
            </View>
            <Text style={[styles.amountFormulaText, { color: C.textSub }]}>
              NLe {baseContributionAmount.toFixed(2)} x {durationCount} {UNIT_LABELS[durationUnit]}
            </Text>
          </View>

          {/* Duration Count */}
          <View style={styles.durationCountBox}>
            <Text style={[styles.fieldLabel, { color: C.textSub }]}>Duration</Text>
            <View style={[styles.stepperRow, { backgroundColor: C.inputBg }]}>
              <TouchableOpacity
                style={[styles.stepperBtn, { backgroundColor: C.iconBg }]}
                onPress={() => setDurationCount(Math.max(1, durationCount - 1))}
              >
                <Minus size={16} color={C.text} />
              </TouchableOpacity>
              <Text style={[styles.stepperValue, { color: C.text }]}>{durationCount}</Text>
              <TouchableOpacity
                style={[styles.stepperBtn, { backgroundColor: C.iconBg }, !canIncreaseDuration && { opacity: 0.45 }]}
                onPress={() => {
                  if (canIncreaseDuration) setDurationCount(durationCount + 1);
                }}
                disabled={!canIncreaseDuration}
              >
                <Plus size={16} color={C.text} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Unit Selector */}
        <View style={[styles.unitRow, { borderColor: C.border }]}>
          {(['day', 'week', 'month'] as DurationUnit[]).map((unit) => (
            <TouchableOpacity
              key={unit}
              style={[
                styles.unitButton,
                { backgroundColor: C.inputBg },
                durationUnit === unit && styles.unitButtonActive,
                unit !== allowedDurationUnit && [styles.unitButtonDisabled, { backgroundColor: C.bgSoft }],
              ]}
              onPress={() => setDurationUnit(unit)}
              disabled={unit !== allowedDurationUnit}
            >
              <Text
                style={[
                  styles.unitButtonText,
                  { color: C.textSub },
                  durationUnit === unit && styles.unitButtonTextActive,
                  unit !== allowedDurationUnit && styles.unitButtonTextDisabled,
                ]}
              >
                {UNIT_LABELS[unit]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={[styles.helperText, { color: C.textSub }]}>
          This {frequencyLabel(groupFrequency)} Osusu only allows {UNIT_LABELS[allowedDurationUnit]} collections.
        </Text>

        {/* Coverage Range */}
        <View style={[styles.rangeCard, { backgroundColor: C.card, borderColor: C.border }]}>
          <View style={styles.rangeItem}>
            <Text style={[styles.rangeLabel, { color: C.textMuted }]}>{rangeStartLabel}</Text>
            <View style={styles.rangeDateLocked}>
              <Text style={[styles.rangeDate, { color: C.text }]}>{formattedRangeStart}</Text>
              <Lock size={13} color={C.textMuted} />
            </View>
          </View>
          <ArrowRight size={20} color={C.textMuted} />
          <View style={styles.rangeItem}>
            <Text style={[styles.rangeLabel, { color: C.textMuted }]}>{rangeEndLabel}</Text>
            <Text style={[styles.rangeDate, { color: C.text }]}>{formattedRangeEnd}</Text>
          </View>
        </View>
        <Text style={[styles.helperText, { color: C.textSub }]}>
          {isMonthlyPeriod
            ? 'Monthly periods are calculated from the next unpaid month.'
            : durationUnit === 'week'
              ? 'The starting week is calculated automatically from the member payment history.'
              : 'The starting day is calculated automatically from the member payment history.'}
        </Text>
        <View style={styles.coverageStatusCard}>
          {isLoadingCoverage ? (
            <ActivityIndicator size="small" color="#F97316" />
          ) : (
            <Lock size={14} color="#1D4ED8" />
          )}
          <Text style={styles.coverageStatusText}>{nextUnpaidLabel}</Text>
        </View>
      </View>

      {/* Collection Method */}
      <View style={styles.section}>
        <SectionHeader title="Collection Method" />
        <View style={styles.methodGrid}>
          {(
            [
              { id: 'cash_collected' as CollectionMethod, label: 'Cash', icon: Wallet },
              { id: 'orange_money' as CollectionMethod, label: 'Orange Money', icon: Smartphone },
              { id: 'afrimoney' as CollectionMethod, label: 'Afrimoney', icon: Smartphone },
              { id: 'qmoney' as CollectionMethod, label: 'QMoney', icon: Smartphone },
            ] as const
          ).map((meth) => {
              const logo = METHOD_LOGOS[meth.id];
              const active = collectionMethod === meth.id;
              return (
                <TouchableOpacity
                  key={meth.id}
                  style={[
                    styles.methodButton,
                    active && styles.methodButtonActive,
                  ]}
                  onPress={() => setCollectionMethod(meth.id)}
                >
                  {logo ? (
                    <View style={styles.methodLogoWrap}>
                      <Image
                        source={logo.source}
                        style={styles.methodLogo}
                        resizeMode="contain"
                        accessibilityLabel={logo.title}
                      />
                    </View>
                  ) : (
                    <meth.icon
                      size={18}
                      color={active ? '#FFFFFF' : '#64748B'}
                    />
                  )}
                  {!logo ? (
                    <Text
                      style={[
                        styles.methodButtonText,
                        active && styles.methodButtonTextActive,
                      ]}
                    >
                      {meth.label}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              );
          })}
        </View>
      </View>

      {/* Notes */}
      <View style={styles.section}>
        <SectionHeader
          icon={<FileText size={18} color="#64748B" />}
          title="Notes (Optional)"
        />
        <TextInput
          style={[styles.notesInput, { backgroundColor: C.inputBg, color: C.text, borderColor: C.borderStrong }]}
          value={notes}
          onChangeText={(t) => setNotes(t.slice(0, 280))}
          placeholder="Add any comments about this payment..."
          placeholderTextColor={C.textMuted}
          multiline
          numberOfLines={3}
          maxLength={280}
        />
      </View>

      <TouchableOpacity style={styles.nextButton} onPress={onNext}>
        <Text style={styles.nextButtonText}>Continue</Text>
        <ArrowRight size={20} color="#FFFFFF" />
      </TouchableOpacity>
    </>
  );
}

function SummaryStep({
  selectedMember,
  amount,
  collectionDate,
  coverageStartDate,
  toDate,
  durationCount,
  durationUnit,
  collectionMethod,
  notes,
  isProcessing,
  onEdit,
  onConfirm,
}: {
  selectedMember: ContributorAssignment | null;
  amount: string;
  collectionDate: Date;
  coverageStartDate: Date;
  toDate: Date;
  durationCount: number;
  durationUnit: DurationUnit;
  collectionMethod: CollectionMethod;
  notes: string;
  isProcessing: boolean;
  onEdit: () => void;
  onConfirm: () => void;
}) {
  const { preferences } = useAppDataStore();
  const C = preferences.darkMode ? darkColors : lightColors;
  return (
    <>
      <View style={styles.summaryHero}>
        <View style={[styles.summaryHeroIcon, { backgroundColor: C.iconBg }]}>
          <FileText size={26} color={C.text} />
        </View>
        <Text style={[styles.summaryHeroTitle, { color: C.text }]}>Review before confirming</Text>
        <Text style={[styles.summaryIntro, { color: C.textSub }]}>
          Please review all details carefully. You can edit this record before the
          member and collector authorization steps.
        </Text>
      </View>

      <View style={styles.summaryCard}>
        <SummaryRow label="Member" value={selectedMember?.displayName ?? '—'} />
        <SummaryDivider />
        <SummaryRow
          label="Amount"
          value={`NLe ${parseFloat(amount).toFixed(2)}`}
          bold
        />
        <SummaryDivider />
        <SummaryRow
          label="Contribution Type"
          value={durationUnit === 'day' ? 'Daily' : durationUnit === 'week' ? 'Weekly' : 'Monthly'}
        />
        <SummaryDivider />
        <SummaryRow
          label="Paid For"
          value={`${durationCount} ${UNIT_LABELS[durationUnit]}`}
        />
        <SummaryDivider />
        <SummaryRow label="Collection Date" value={formatDate(collectionDate)} />
        <SummaryDivider />
        <SummaryRow
          label="Period Covered"
          value={formatPeriodRange(coverageStartDate, toDate, durationUnit)}
        />
        <SummaryDivider />
        <SummaryRow label="Method" value={METHOD_LABELS[collectionMethod]} />
        {notes.trim() ? (
          <>
            <SummaryDivider />
            <SummaryRow label="Notes" value={notes.trim()} />
          </>
        ) : null}
      </View>

      <View style={styles.auditNote}>
        <CheckCircle size={14} color="#10B981" />
        <Text style={styles.auditNoteText}>
          Summary ready. Confirm to collect member and collector authorization.
        </Text>
      </View>

      <View style={styles.summaryActions}>
        <TouchableOpacity style={[styles.editButton, { backgroundColor: C.inputBg }]} onPress={onEdit}>
          <Edit3 size={18} color={C.text} />
          <Text style={[styles.editButtonText, { color: C.text }]}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.confirmButton, isProcessing && { backgroundColor: '#CBD5E1' }]}
          onPress={onConfirm}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Send size={18} color="#FFFFFF" />
              <Text style={styles.confirmButtonText}>Confirm Summary</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </>
  );
}

function SuccessStep({
  memberName,
  amount,
  durationCount,
  collectionDate,
  coverageStartDate,
  toDate,
  durationUnit,
  collectionMethod,
  receiptNumber,
  receiptPdfUri,
  isGeneratingPdf,
  onShareReceipt,
  onRecordAnother,
  onDone,
}: {
  memberName: string;
  amount: string;
  durationCount: number;
  collectionDate: Date;
  coverageStartDate: Date;
  toDate: Date;
  durationUnit: DurationUnit;
  collectionMethod: CollectionMethod;
  receiptNumber: string | null;
  receiptPdfUri: string | null;
  isGeneratingPdf: boolean;
  onShareReceipt: () => void;
  onRecordAnother: () => void;
  onDone: () => void;
}) {
  const { preferences } = useAppDataStore();
  const C = preferences.darkMode ? darkColors : lightColors;
  return (
    <View style={styles.successContainer}>
      <View style={styles.successIconRing}>
        <CheckCircle size={56} color="#10B981" />
      </View>
      <Text style={[styles.successTitle, { color: C.text }]}>Payment Recorded!</Text>
      <Text style={[styles.successSubtitle, { color: C.textSub }]}>
        The contribution has been securely logged in the audit trail, registered in the
        group ledger, and sent to the member notification center.
      </Text>

      {receiptNumber && (
        <View style={styles.receiptCard}>
          <Text style={styles.receiptLabel}>Receipt Number</Text>
          <Text style={styles.receiptNumber}>{receiptNumber}</Text>
        </View>
      )}

      <View style={[styles.successDetails, { backgroundColor: C.card, borderColor: C.borderStrong }]}>
        <SuccessDetailRow label="Member" value={memberName} />
        <SuccessDetailRow
          label="Amount"
          value={`NLe ${parseFloat(amount).toFixed(2)}`}
        />
        <SuccessDetailRow
          label="Paid For"
          value={`${durationCount} ${UNIT_LABELS[durationUnit]}`}
        />
        <SuccessDetailRow label="Collection Date" value={formatDate(collectionDate)} />
        <SuccessDetailRow
          label="Period Covered"
          value={formatPeriodRange(coverageStartDate, toDate, durationUnit)}
        />
        <SuccessDetailRow label="Method" value={METHOD_LABELS[collectionMethod]} />
      </View>

      <TouchableOpacity
        style={[styles.shareReceiptButton, isGeneratingPdf && { backgroundColor: '#CBD5E1' }]}
        onPress={onShareReceipt}
        disabled={isGeneratingPdf || !receiptNumber}
      >
        {isGeneratingPdf ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <>
            <Share2 size={18} color="#FFFFFF" />
            <Text style={styles.shareReceiptButtonText}>
              {receiptPdfUri ? 'Share PDF Receipt' : 'Generate PDF Receipt'}
            </Text>
          </>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.newCollectionButton} onPress={onRecordAnother}>
        <Text style={styles.newCollectionButtonText}>Record Another Payment</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.doneButton} onPress={onDone}>
        <Text style={styles.doneButtonText}>Open Group Ledger</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 15,
    fontSize: 14,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#F97316',
    fontWeight: '800',
    marginTop: 3,
  },
  stepDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  dotActive: {
    backgroundColor: '#F97316',
  },
  dotInactive: {
    backgroundColor: '#E2E8F0',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 40,
  },

  collectorIdentityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#EEF2F7',
  },
  collectorIdentityPhoto: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  collectorIdentityImage: {
    width: '100%',
    height: '100%',
  },
  collectorIdentityLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  collectorIdentityName: {
    color: '#1E2B5A',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
  },
  collectorIdentityHint: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 2,
  },

  // Section
  section: {
    marginBottom: 22,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    marginLeft: 10,
    fontSize: 15,
    fontWeight: '700',
  },

  // Member Picker
  pickerTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingVertical: 8,
    borderWidth: 0,
  },
  pickerText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1E2B5A',
  },
  pickerDropdown: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    maxHeight: 200,
    overflow: 'hidden',
  },
  pickerItem: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  pickerItemName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  pickerItemPhone: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  emptyPickerText: {
    padding: 20,
    textAlign: 'center',
    color: '#64748B',
    fontSize: 14,
  },

  // Date Picker Button
  datePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 15,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  datePickerText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  lockedDateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingVertical: 8,
    borderWidth: 0,
    gap: 10,
  },
  helperText: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },

  // Amount + Duration row
  amountDurationRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  amountBox: {
    flex: 1.4,
  },
  durationCountBox: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 8,
    textTransform: 'none',
    letterSpacing: 0,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 0,
    paddingHorizontal: 0,
    borderWidth: 0,
    height: 52,
  },
  currencyPrefix: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1E2B5A',
    marginRight: 5,
  },
  textInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: '800',
    color: '#1E2B5A',
  },
  lockedAmountText: {
    flex: 1,
    fontSize: 20,
    fontWeight: '800',
    color: '#1E2B5A',
  },
  amountFormulaText: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    borderWidth: 0,
    height: 52,
    overflow: 'hidden',
  },
  stepperBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    backgroundColor: '#F3F4F6',
    borderRadius: 26,
  },
  stepperValue: {
    minWidth: 36,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '800',
    color: '#1E2B5A',
  },

  // Unit selector
  unitRow: {
    flexDirection: 'row',
    gap: 0,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#EEF2F7',
    borderRadius: 18,
    overflow: 'hidden',
  },
  unitButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 0,
    backgroundColor: '#FFFFFF',
    borderWidth: 0,
    alignItems: 'center',
  },
  unitButtonActive: {
    backgroundColor: '#1E2B5A',
    borderColor: '#1E2B5A',
  },
  unitButtonDisabled: {
    backgroundColor: '#F8FAFC',
  },
  unitButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  unitButtonTextActive: {
    color: '#FFFFFF',
  },
  unitButtonTextDisabled: {
    color: '#CBD5E1',
  },

  // Coverage range
  rangeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#EEF2F7',
  },
  rangeItem: {
    alignItems: 'center',
  },
  rangeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  rangeDate: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1E2B5A',
  },
  rangeDateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rangeDateLocked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  coverageStatusCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#DBEAFE',
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },
  coverageStatusText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#1E40AF',
    lineHeight: 18,
  },

  // Method grid
  methodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  methodButton: {
    flex: 1,
    minWidth: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    minHeight: 72,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
  },
  methodButtonActive: {
    backgroundColor: '#1E2B5A',
    borderColor: '#1E2B5A',
  },
  methodButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  methodButtonTextActive: {
    color: '#FFFFFF',
  },
  methodLogoWrap: {
    width: 118,
    height: 52,
    borderRadius: 7,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    overflow: 'hidden',
  },
  methodLogo: {
    width: 110,
    height: 46,
  },

  // Photo
  photoTarget: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    height: 120,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoPreview: {
    width: '100%',
    height: '100%',
  },
  photoPlaceholder: {
    alignItems: 'center',
  },
  photoPlaceholderText: {
    marginTop: 8,
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '600',
  },

  // Notes
  notesInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 15,
    fontSize: 14,
    color: '#1E2B5A',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    textAlignVertical: 'top',
    minHeight: 80,
  },

  // Next button
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F97316',
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 6,
    gap: 10,
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  nextButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },

  // Auth card
  authCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 0,
    paddingHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 24,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 0,
  },
  authIconBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  authCardTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1E2B5A',
    marginBottom: 12,
    textAlign: 'center',
  },
  authCardSubtitle: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 20,
  },

  // Verification section
  verificationSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingVertical: 8,
    marginBottom: 40,
    borderWidth: 0,
  },
  verificationHint: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
    marginBottom: 24,
    opacity: 0.85,
  },
  secretInputWrapper: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0,
    overflow: 'hidden',
  },
  secretInput: {
    width: '100%',
    height: '100%',
    paddingVertical: 0,
    textAlign: 'center',
    fontSize: 1,
    fontWeight: '800',
    letterSpacing: 0,
    color: '#1E2B5A',
  },
  pinInputTouchArea: {
    position: 'relative',
    minHeight: 52,
    justifyContent: 'center',
  },
  pinSlots: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 14,
    marginBottom: 18,
  },
  pinSlot: {
    flex: 1,
    height: 28,
    borderBottomWidth: 3,
    borderBottomColor: '#1E2B5A',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  pinSlotFocused: {
    backgroundColor: '#F8FAFC',
  },
  pinDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#1E2B5A',
  },
  pinLengthHint: {
    marginTop: 0,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },

  // Summary
  summaryHero: {
    alignItems: 'center',
    paddingTop: 22,
    marginBottom: 24,
  },
  summaryHeroIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
    marginBottom: 20,
  },
  summaryHeroTitle: {
    color: '#1E2B5A',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 14,
    textAlign: 'center',
  },
  summaryIntro: {
    fontSize: 14,
    color: '#64748B',
    lineHeight: 20,
    textAlign: 'center',
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingVertical: 6,
    borderWidth: 0,
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
  },
  summaryLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
    flex: 1,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1E2B5A',
    flex: 1.5,
    textAlign: 'right',
  },
  summaryDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
  },
  summaryPhoto: {
    width: 72,
    height: 54,
    borderRadius: 8,
  },
  auditNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 14,
    marginBottom: 36,
  },
  auditNoteText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 21,
    color: '#64748B',
    fontWeight: '600',
  },
  summaryActions: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  editButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    paddingVertical: 17,
    borderWidth: 0,
    gap: 8,
  },
  editButtonText: {
    color: '#1E2B5A',
    fontSize: 15,
    fontWeight: '800',
  },
  confirmButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1E2B5A',
    borderRadius: 16,
    paddingVertical: 17,
    gap: 8,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  confirmButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },

  // Success
  successContainer: {
    alignItems: 'center',
    paddingTop: 20,
  },
  successIconRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#D1FAE5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  successTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1E2B5A',
    marginBottom: 10,
  },
  successSubtitle: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
    paddingHorizontal: 10,
  },
  receiptCard: {
    backgroundColor: '#1E2B5A',
    borderRadius: 16,
    paddingHorizontal: 32,
    paddingVertical: 18,
    alignItems: 'center',
    marginBottom: 24,
    width: '100%',
  },
  receiptLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  receiptNumber: {
    fontSize: 22,
    fontWeight: '800',
    color: '#F97316',
    letterSpacing: 2,
  },
  successDetails: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    width: '100%',
    marginBottom: 24,
  },
  successDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  successDetailLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  successDetailValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  newCollectionButton: {
    backgroundColor: '#F97316',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 32,
    width: '100%',
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  newCollectionButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  shareReceiptButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1D4ED8',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 32,
    width: '100%',
    marginBottom: 12,
    shadowColor: '#1D4ED8',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  shareReceiptButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  doneButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 32,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  doneButtonText: {
    color: '#64748B',
    fontSize: 15,
    fontWeight: '700',
  },

  // Date Modal (iOS)
  dateModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  dateModalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 30,
  },
  dateModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  dateModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  dateModalDone: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F97316',
  },
});
