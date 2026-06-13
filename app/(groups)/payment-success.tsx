/**
 * PaymentSuccessScreen
 *
 * Displays a receipt for a confirmed contribution payment.
 * ALL receipt data is fetched from the backend using the contributionId.
 * The screen NEVER displays pre-populated or hardcoded financial data.
 *
 * Navigation params:
 *   contributionId — UUID of the contribution_payments record (required)
 *   groupId        — UUID for the "View Group" button destination (optional)
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Share,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  CheckCircle,
  AlertCircle,
  Share2,
  Receipt,
  Calendar,
  DollarSign,
  User,
  Home,
} from 'lucide-react-native';
import { supabase } from '../../src/services/supabase';
import { useAuthStore } from '../../src/store/authStore';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';

type ThemeColors = typeof lightColors | typeof darkColors;

interface ConfirmedReceipt {
  contributionId: string;
  receiptNumber: string | null;
  amount: number;
  groupName: string;
  paymentMethod: string;
  status: string;
  createdAt: string;
}

export default function PaymentSuccessScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { preferences } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;

  const params = useLocalSearchParams<{
    contributionId?: string;
    groupId?: string;
  }>();

  // Validate params are non-empty UUIDs before any use.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const contributionId =
    params.contributionId && UUID_RE.test(String(params.contributionId))
      ? String(params.contributionId)
      : null;
  const groupId =
    params.groupId && UUID_RE.test(String(params.groupId))
      ? String(params.groupId)
      : null;

  const [receipt, setReceipt] = useState<ConfirmedReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      router.replace('/(auth)/login');
      return;
    }

    if (!contributionId) {
      setFetchError('No valid payment reference found. Please check your contribution history.');
      setLoading(false);
      return;
    }

    let mounted = true;

    const fetchReceipt = async () => {
      try {
        // RLS ensures this record only returns if it belongs to the authenticated user.
        const { data, error } = await supabase
          .from('contribution_payments')
          .select(`
            id,
            receipt_number,
            amount,
            payment_method,
            status,
            created_at,
            osusu_groups ( name )
          `)
          .eq('id', contributionId)
          .eq('member_id', user.id)
          .maybeSingle();

        if (!mounted) return;

        if (error) {
          setFetchError('Could not load payment details. Please check your contribution history.');
          return;
        }

        if (!data) {
          setFetchError('Payment record not found. It may still be processing.');
          return;
        }

        const row = data as Record<string, unknown>;
        const groupData = row.osusu_groups as Record<string, unknown> | null;

        setReceipt({
          contributionId: String(row.id ?? contributionId),
          receiptNumber:  row.receipt_number ? String(row.receipt_number) : null,
          amount:         Number(row.amount ?? 0),
          groupName:      groupData?.name ? String(groupData.name) : '—',
          paymentMethod:  row.payment_method
            ? String(row.payment_method).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
            : '—',
          status:         String(row.status ?? 'pending'),
          createdAt:      row.created_at ? String(row.created_at) : '',
        });
      } catch {
        if (mounted) setFetchError('Could not load payment details. Please try again.');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void fetchReceipt();
    return () => { mounted = false; };
  }, [contributionId, user, router]);

  const formatDate = (iso: string): string => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return '—';
    }
  };

  const isVerified = receipt?.status === 'collected' || receipt?.status === 'verified';

  const handleShareReceipt = async () => {
    if (!receipt) return;
    const ref = receipt.receiptNumber ?? receipt.contributionId;
    const message = [
      'Mi Osusu — Contribution Receipt',
      '',
      `Group:    ${receipt.groupName}`,
      `Amount:   NLe ${receipt.amount.toFixed(2)}`,
      `Method:   ${receipt.paymentMethod}`,
      `Date:     ${formatDate(receipt.createdAt)}`,
      `Ref:      ${ref}`,
      `Status:   ${isVerified ? 'Confirmed' : receipt.status}`,
    ].join('\n');

    try {
      await Share.share({ message, title: 'Mi Osusu Receipt' });
    } catch {
      Alert.alert('Share failed', 'Unable to share receipt. Please try again.');
    }
  };

  const handleGoHome = () => router.replace('/(main)/home');
  const handleViewGroup = () => {
    if (groupId) router.replace({ pathname: '/(groups)/manage/[id]', params: { id: groupId } });
    else router.replace('/(main)/groups');
  };

  // ── Loading ──
  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]}>
        <View style={[styles.header, { backgroundColor: C.bg }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft size={24} color="#F97316" />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: C.text }]}>Payment Receipt</Text>
        </View>
        <View style={styles.centred}>
          <ActivityIndicator size="large" color="#F97316" />
          <Text style={[styles.loadingText, { color: C.textSub }]}>Loading receipt…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Error ──
  if (fetchError || !receipt) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]}>
        <View style={[styles.header, { backgroundColor: C.bg }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft size={24} color="#F97316" />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: C.text }]}>Payment Receipt</Text>
        </View>
        <View style={styles.centred}>
          <AlertCircle size={48} color="#EF4444" />
          <Text style={[styles.errorTitle, { color: C.text }]}>Receipt Unavailable</Text>
          <Text style={[styles.errorMsg, { color: C.textSub }]}>
            {fetchError ?? 'Could not load payment details.'}
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push('/components/receipts')}>
            <Text style={styles.primaryBtnText}>View All Receipts</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Receipt ──
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { backgroundColor: C.bg }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: C.text }]}>Payment Receipt</Text>
      </View>

      <View style={styles.content}>
        {/* Status icon */}
        <View style={styles.successContainer}>
          <View style={styles.successIcon}>
            {isVerified
              ? <CheckCircle size={64} color="#10B981" />
              : <AlertCircle size={64} color="#F59E0B" />}
          </View>
          <Text style={[styles.successTitle, { color: isVerified ? '#10B981' : '#F59E0B' }]}>
            {isVerified ? 'Contribution Confirmed' : 'Contribution Received'}
          </Text>
          <Text style={[styles.successMessage, { color: C.textSub }]}>
            {isVerified
              ? 'Your contribution has been recorded in the group ledger.'
              : 'Your payment is being processed. Check back shortly.'}
          </Text>
        </View>

        {/* Receipt card */}
        <View style={[styles.receiptCard, { backgroundColor: C.card }]}>
          <View style={styles.receiptHeader}>
            <Receipt size={20} color="#F97316" />
            <Text style={[styles.receiptTitle, { color: C.text }]}>Contribution Details</Text>
          </View>

          <View style={styles.receiptContent}>
            {receipt.receiptNumber && (
              <ReceiptRow label="Receipt Number" value={receipt.receiptNumber} C={C} />
            )}
            <ReceiptRow label="Reference" value={receipt.contributionId.slice(0, 8).toUpperCase()} C={C} />
            <ReceiptRow
              label="Amount"
              value={`NLe ${receipt.amount.toFixed(2)}`}
              C={C}
              accent
            />
            <ReceiptRow label="Group" value={receipt.groupName} C={C} />
            <ReceiptRow label="Payment Method" value={receipt.paymentMethod} C={C} />
            <ReceiptRow label="Date" value={formatDate(receipt.createdAt)} C={C} />
            <ReceiptRow
              label="Status"
              value={isVerified ? 'Confirmed' : 'Processing'}
              C={C}
              status={isVerified ? 'success' : 'pending'}
            />
          </View>
        </View>

        {/* Action buttons */}
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: C.inputBg }]}
            onPress={handleShareReceipt}
          >
            <Share2 size={18} color="#F97316" />
            <Text style={styles.actionButtonText}>Share Receipt</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: C.inputBg }]}
            onPress={() => router.push('/components/receipts')}
          >
            <Receipt size={18} color="#F97316" />
            <Text style={styles.actionButtonText}>All Receipts</Text>
          </TouchableOpacity>
        </View>

        {/* Navigation buttons */}
        <View style={styles.navigationButtons}>
          {groupId && (
            <TouchableOpacity
              style={[styles.navButton, { backgroundColor: C.inputBg }]}
              onPress={handleViewGroup}
            >
              <User size={18} color="#1D4ED8" />
              <Text style={styles.navButtonText}>View Group</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.navButton, styles.primaryNavButton, !groupId && styles.fullWidth]}
            onPress={handleGoHome}
          >
            <Home size={18} color="#FFFFFF" />
            <Text style={styles.primaryNavButtonText}>Go Home</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

function ReceiptRow({
  label,
  value,
  C,
  accent,
  status,
}: {
  label: string;
  value: string;
  C: ThemeColors;
  accent?: boolean;
  status?: 'success' | 'pending';
}) {
  return (
    <View style={[styles.receiptRow, { borderBottomColor: C.border }]}>
      <Text style={[styles.receiptLabel, { color: C.textMuted }]}>{label}</Text>
      {status ? (
        <View style={[styles.statusBadge, status === 'success' ? styles.statusSuccess : styles.statusPending]}>
          <Text style={styles.statusText}>{value}</Text>
        </View>
      ) : (
        <Text
          style={[
            styles.receiptValue,
            { color: accent ? '#F97316' : C.text },
            accent && styles.receiptValueAccent,
          ]}
        >
          {value}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: 16,
  },
  backButton: { marginRight: 16 },
  headerTitle: { fontSize: 20, fontWeight: '700' },

  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  loadingText: { marginTop: 16, fontSize: 15, fontWeight: '500' },
  errorTitle: { fontSize: 20, fontWeight: '700', marginTop: 16, textAlign: 'center' },
  errorMsg: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginTop: 8, marginBottom: 24 },

  content: { flex: 1, padding: 24 },

  successContainer: { alignItems: 'center', marginBottom: 28 },
  successIcon: { marginBottom: 16 },
  successTitle: { fontSize: 22, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  successMessage: { fontSize: 15, textAlign: 'center', lineHeight: 22 },

  receiptCard: {
    borderRadius: 16, padding: 20, marginBottom: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  receiptHeader: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: 16, paddingBottom: 12,
  },
  receiptTitle: { fontSize: 17, fontWeight: '700', marginLeft: 12 },
  receiptContent: {},
  receiptRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  receiptLabel: { fontSize: 13, flex: 1 },
  receiptValue: { fontSize: 14, fontWeight: '500', flex: 2, textAlign: 'right' },
  receiptValueAccent: { fontWeight: '700', fontSize: 16, color: '#F97316' },

  statusBadge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
  },
  statusSuccess: { backgroundColor: '#10B981' },
  statusPending: { backgroundColor: '#F59E0B' },
  statusText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },

  actionButtons: {
    flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16,
  },
  actionButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, width: '48%',
  },
  actionButtonText: { fontSize: 13, fontWeight: '500', color: '#F97316', marginLeft: 6 },

  navigationButtons: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  navButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderRadius: 12, paddingVertical: 14,
  },
  fullWidth: { flex: 1 },
  primaryNavButton: { backgroundColor: '#F97316' },
  navButtonText: { fontSize: 14, fontWeight: '500', color: '#1D4ED8', marginLeft: 6 },
  primaryNavButtonText: { fontSize: 14, fontWeight: '500', color: '#FFFFFF', marginLeft: 6 },

  primaryBtn: {
    backgroundColor: '#F97316', borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 24, alignItems: 'center',
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
