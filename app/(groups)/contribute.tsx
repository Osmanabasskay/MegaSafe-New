import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView }           from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle,
  DollarSign,
  PlusCircle,
  Smartphone,
  Wallet,
} from 'lucide-react-native';
import { getGroupById }          from '../../src/services/groupService';
import { useAuthStore }          from '../../src/store/authStore';
import { useAppDataStore }       from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';
import { useKycGuard }           from '../../src/hooks/useKycGuard';
import { getVaultSummary, payOsusuFromVault } from '../../src/services/vaultService';
import type { VaultSummary }     from '../../src/services/vaultService';
import { initiateGroupPayment }  from '../../src/services/paymentService';
import { EnterTransactionPinModal } from '../../src/components/security/EnterTransactionPinModal';

// Mobile money providers supported by Monime (QMoney intentionally excluded).
type MobileMoneyMethod = 'orange_money' | 'afrimoney';
const MOBILE_MONEY_PROVIDERS: { method: MobileMoneyMethod; label: string; color: string }[] = [
  { method: 'orange_money', label: 'Orange Money', color: '#FF6900' },
  { method: 'afrimoney',    label: 'AfriMoney',    color: '#00A652' },
];

export default function ContributeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ groupId?: string }>();

  const groupId = params.groupId != null ? String(params.groupId) : '';

  const { user }       = useAuthStore();
  const { requireKyc } = useKycGuard();
  const { preferences } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;

  const [isProcessing, setIsProcessing] = useState(false);
  const [loadingVault, setLoadingVault] = useState(true);
  const [showSuccess, setShowSuccess]   = useState(false);
  const [paidAmount, setPaidAmount]     = useState(0);
  // Tracks which mobile money provider button is mid-initiation (null = none).
  const [mmProcessing, setMmProcessing] = useState<MobileMoneyMethod | null>(null);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinPurpose, setPinPurpose] = useState<'vault' | MobileMoneyMethod | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);

  const [groupData, setGroupData] = useState({
    name:               'Savings Group',
    contributionAmount: 0,
    dueDate:            new Date().toISOString().slice(0, 10),
  });

  const [vault, setVault] = useState<VaultSummary | null>(null);

  // ── Load group info + vault balance ──────────────────────────
  useEffect(() => {
    let mounted = true;
    const run = async () => {
      const [groupRes, vaultRes] = await Promise.all([
        groupId ? getGroupById(groupId) : Promise.resolve({ group: null }),
        getVaultSummary(),
      ]);

      if (!mounted) return;

      if (groupRes.group) {
        setGroupData({
          name:               groupRes.group.name,
          contributionAmount: groupRes.group.contribution_amount,
          dueDate:            groupRes.group.cycle_start_date,
        });
      }

      if (vaultRes.summary) setVault(vaultRes.summary);
      setLoadingVault(false);
    };

    void run();
    return () => { mounted = false; };
  }, [groupId]);

  const hasEnoughBalance = (vault?.availableBalance ?? 0) >= groupData.contributionAmount;
  const shortfall        = Math.max(0, groupData.contributionAmount - (vault?.availableBalance ?? 0));

  const handlePayFromVault = async () => {
    if (!requireKyc('contribute to Osusu group')) return;
    if (!user?.id) {
      Alert.alert('Authentication required', 'Please sign in again before making a contribution.');
      return;
    }
    if (!groupId) {
      Alert.alert('Error', 'No group selected.');
      return;
    }
    if (!hasEnoughBalance) {
      Alert.alert(
        'Insufficient Vault Balance',
        'Insufficient vault balance. Add money to your vault or pay with mobile money.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Add Money to Vault', onPress: () => router.push('/(main)/vault') },
        ]
      );
      return;
    }

    setPinPurpose('vault');
    setPinError(null);
    setPinModalVisible(true);
  };

  const submitPayFromVault = async (transactionPin: string) => {
    setIsProcessing(true);
    try {
      const { success, amount, error } = await payOsusuFromVault({ groupId, transactionPin });

      if (error) throw error;
      if (!success) throw new Error('Payment could not be processed. Please try again.');

      setPinModalVisible(false);
      setPaidAmount(amount ?? groupData.contributionAmount);
      setShowSuccess(true);
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'Unable to process your contribution right now.');
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Pay this contribution directly via Monime mobile money ───
  // This does NOT touch the vault-first flow above. It initiates a Monime
  // Payment Code server-side (initiate-payment Edge Function) and hands off
  // to the shared USSD screen. The frontend never confirms the payment —
  // mobile-money-webhook is the sole authority for completion.
  const handlePayWithMobileMoney = async (method: MobileMoneyMethod) => {
    if (mmProcessing || isProcessing) return;
    if (!requireKyc('contribute to Osusu group')) return;
    if (!user?.id) {
      Alert.alert('Authentication required', 'Please sign in again before making a contribution.');
      return;
    }
    if (!groupId) {
      Alert.alert('Error', 'No group selected.');
      return;
    }
    if (!(groupData.contributionAmount > 0)) {
      Alert.alert('Amount unavailable', 'Could not load the contribution amount. Please try again.');
      return;
    }

    setPinPurpose(method);
    setPinError(null);
    setPinModalVisible(true);
  };

  const submitPayWithMobileMoney = async (method: MobileMoneyMethod, transactionPin: string) => {
    setMmProcessing(method);
    try {
      // periodId is omitted on purpose — the Edge Function resolves the group's
      // open payment period server-side. Amount is re-validated by the RPC.
      const result = await initiateGroupPayment({
        groupId,
        amount: groupData.contributionAmount,
        method,
        transactionPin,
      });

      if (result.error) throw result.error;
      if (!result.success || !result.ussdCode || !result.monimePaymentCodeId) {
        throw new Error('Could not start the mobile money payment. Please try again.');
      }

      const providerLabel = method === 'orange_money' ? 'Orange Money' : 'AfriMoney';
      setPinModalVisible(false);
      router.push({
        pathname: '/(groups)/monime-payment',
        params: {
          monimePaymentCodeId: result.monimePaymentCodeId,
          ussdCode:            result.ussdCode,
          expiresAt:           result.expiresAt ?? '',
          // Amount is taken from the locally-loaded group data (server-authoritative via getGroupById).
          // InitiateGroupPaymentResult does not surface amount; the RPC validates it server-side.
          amount:              String(groupData.contributionAmount),
          fee:                 '0',
          provider:            providerLabel,
          reference:           result.contributionId ?? '',
          paymentType:         'osusu_contribution',
          groupId,
        },
      });
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'Unable to start the payment right now.');
    } finally {
      setMmProcessing(null);
    }
  };

  const handlePinConfirm = (transactionPin: string) => {
    if (pinPurpose === 'vault') {
      void submitPayFromVault(transactionPin);
      return;
    }
    if (pinPurpose === 'orange_money' || pinPurpose === 'afrimoney') {
      void submitPayWithMobileMoney(pinPurpose, transactionPin);
    }
  };

  // ── Success screen ───────────────────────────────────────────
  if (showSuccess) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]}>
        <View style={styles.successContainer}>
          <View style={styles.successIcon}>
            <CheckCircle size={64} color="#10B981" />
          </View>
          <Text style={styles.successTitle}>Contribution Paid</Text>
          <Text style={[styles.successMessage, { color: C.text }]}>
            NLe {paidAmount.toFixed(2)} for {groupData.name} has been deducted from your vault.
          </Text>
          <Text style={[styles.successSubtext, { color: C.textSub }]}>
            Your contribution record has been confirmed and the group admin has been notified.
          </Text>
          <TouchableOpacity
            style={styles.doneButton}
            onPress={() => router.back()}
          >
            <Text style={styles.doneButtonText}>Back to Group</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Main screen ──────────────────────────────────────────────
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { backgroundColor: C.bg }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: C.text }]}>Make Contribution</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Group info card */}
        <View style={[styles.groupInfo, { backgroundColor: C.card }]}>
          <Text style={[styles.groupName, { color: C.text }]}>{groupData.name}</Text>
          <View style={styles.contributionInfo}>
            <View style={[styles.infoItem, { backgroundColor: C.inputBg }]}>
              <DollarSign size={16} color="#F97316" />
              <Text style={[styles.infoLabel, { color: C.textSub }]}>Amount</Text>
              <Text style={[styles.infoValue, { color: C.text }]}>NLe {groupData.contributionAmount.toFixed(2)}</Text>
            </View>
            <View style={[styles.infoItem, { backgroundColor: C.inputBg }]}>
              <Calendar size={16} color="#1D4ED8" />
              <Text style={[styles.infoLabel, { color: C.textSub }]}>Cycle Date</Text>
              <Text style={[styles.infoValue, { color: C.text }]}>{groupData.dueDate}</Text>
            </View>
          </View>
        </View>

        {/* Vault balance card */}
        <View style={[styles.vaultCard, isDark && { backgroundColor: '#1C1007', borderColor: '#78350F' }]}>
          <View style={styles.vaultCardHeader}>
            <View style={[styles.vaultIconWrap, isDark && { backgroundColor: '#431407' }]}>
              <Wallet size={22} color="#F97316" />
            </View>
            <Text style={[styles.vaultCardTitle, isDark && { color: '#FBB040' }]}>Your Vault Balance</Text>
          </View>

          {loadingVault ? (
            <ActivityIndicator color="#F97316" style={{ marginVertical: 12 }} />
          ) : (
            <>
              <Text style={[styles.vaultAvailable, { color: C.text }]}>
                NLe {(vault?.availableBalance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </Text>
              <Text style={[styles.vaultAvailableLabel, { color: C.textSub }]}>Available to spend</Text>

              {vault && vault.reservedBalance > 0 && (
                <Text style={styles.vaultReservedNote}>
                  NLe {vault.reservedBalance.toFixed(2)} reserved for pending payments
                </Text>
              )}
            </>
          )}
        </View>

        {/* Insufficient balance warning */}
        {!loadingVault && !hasEnoughBalance && (
          <View style={styles.insufficientCard}>
            <AlertCircle size={20} color="#DC2626" />
            <View style={styles.insufficientContent}>
              <Text style={styles.insufficientTitle}>Insufficient Vault Balance</Text>
              <Text style={styles.insufficientText}>
                Insufficient vault balance. Add money to your vault or pay with
                mobile money. (You need NLe {shortfall.toFixed(2)} more to pay
                from your vault.)
              </Text>
            </View>
          </View>
        )}

        {/* Sufficient balance notice */}
        {!loadingVault && hasEnoughBalance && (
          <View style={styles.readyCard}>
            <CheckCircle size={20} color="#059669" />
            <View style={styles.readyContent}>
              <Text style={styles.readyTitle}>Ready to Contribute</Text>
              <Text style={styles.readyText}>
                Your vault has enough balance. NLe {groupData.contributionAmount.toFixed(2)} will be deducted.
              </Text>
            </View>
          </View>
        )}

        {/* Security notice */}
        <View style={styles.securityNotice}>
          <AlertCircle size={20} color="#F59E0B" />
          <View style={styles.noticeContent}>
            <Text style={styles.noticeTitle}>Vault-First Payment</Text>
            <Text style={styles.noticeText}>
              Contributions are paid directly from your vault balance. No mobile money charges apply — your vault is the payment source.
            </Text>
          </View>
        </View>

        {/* Pay from Vault button */}
        <TouchableOpacity
          style={[
            styles.payButton,
            (!hasEnoughBalance || isProcessing || loadingVault) && styles.payButtonDisabled,
          ]}
          onPress={() => void handlePayFromVault()}
          disabled={!hasEnoughBalance || isProcessing || loadingVault}
        >
          {isProcessing ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.payButtonText}>
              Pay NLe {groupData.contributionAmount.toFixed(2)} from Vault
            </Text>
          )}
        </TouchableOpacity>

        {/* Add Money to Vault CTA (shown when insufficient) */}
        {!loadingVault && !hasEnoughBalance && (
          <TouchableOpacity
            style={styles.addMoneyBtn}
            onPress={() => router.push('/(main)/vault')}
            activeOpacity={0.88}
          >
            <PlusCircle size={18} color="#F97316" />
            <Text style={styles.addMoneyBtnText}>Add Money to Vault</Text>
          </TouchableOpacity>
        )}

        {/* ── Pay directly with Mobile Money ──────────────────── */}
        <View style={styles.mmDivider}>
          <View style={[styles.mmDividerLine, { backgroundColor: C.border }]} />
          <Text style={[styles.mmDividerText, { color: C.textMuted }]}>or pay directly</Text>
          <View style={[styles.mmDividerLine, { backgroundColor: C.border }]} />
        </View>

        <View style={styles.mmRow}>
          {MOBILE_MONEY_PROVIDERS.map(({ method, label, color }) => {
            const busy = mmProcessing === method;
            const disabled = mmProcessing != null || isProcessing || loadingVault || groupData.contributionAmount <= 0;
            return (
              <TouchableOpacity
                key={method}
                style={[
                  styles.mmBtn,
                  { borderColor: color + '55', backgroundColor: color + '12' },
                  disabled && !busy && styles.mmBtnDisabled,
                ]}
                onPress={() => void handlePayWithMobileMoney(method)}
                disabled={disabled}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={`Pay with ${label}`}
              >
                {busy ? (
                  <ActivityIndicator color={color} size="small" />
                ) : (
                  <>
                    <Smartphone size={18} color={color} strokeWidth={2.2} />
                    <Text style={[styles.mmBtnText, { color }]}>{label}</Text>
                  </>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.mmHint, { color: C.textMuted }]}>
          Pay this contribution straight from your mobile money — you’ll receive a
          USSD code to dial. No vault balance needed.
        </Text>

        <Text style={[styles.termsText, { color: C.textMuted }]}>
          By proceeding, you confirm this contribution amount and authorize the vault deduction.
        </Text>
      </ScrollView>
      <EnterTransactionPinModal
        visible={pinModalVisible}
        subtitle={`Enter your Transaction PIN to pay NLe ${groupData.contributionAmount.toFixed(2)} for ${groupData.name}.`}
        loading={isProcessing || mmProcessing != null}
        error={pinError}
        onCancel={() => {
          setPinModalVisible(false);
          setPinError(null);
          setPinPurpose(null);
        }}
        onConfirm={handlePinConfirm}
      />
    </SafeAreaView>
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
  scrollView: { flex: 1 },
  scrollContent: { padding: 24, paddingBottom: 36 },

  /* Group info */
  groupInfo: {
    borderRadius: 20, padding: 20, marginBottom: 16,
  },
  groupName: {
    fontSize: 22, fontWeight: '800', marginBottom: 16, textAlign: 'center',
  },
  contributionInfo: { gap: 12 },
  infoItem: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 14, padding: 16,
  },
  infoLabel: { fontSize: 14, marginLeft: 12, flex: 1 },
  infoValue: { fontSize: 15, fontWeight: '700', marginLeft: 12 },

  /* Vault balance card */
  vaultCard: {
    backgroundColor: '#FFF7ED', borderRadius: 20, padding: 20,
    marginBottom: 16, borderWidth: 1.5, borderColor: '#FED7AA',
  },
  vaultCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  vaultIconWrap: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
  },
  vaultCardTitle: { fontSize: 15, fontWeight: '700', color: '#92400E' },
  vaultAvailable: { fontSize: 30, fontWeight: '800', marginBottom: 2 },
  vaultAvailableLabel: { fontSize: 13, marginBottom: 4 },
  vaultReservedNote: { fontSize: 12, color: '#B45309', fontWeight: '500' },

  /* Insufficient balance */
  insufficientCard: {
    flexDirection: 'row', backgroundColor: '#FEF2F2', borderRadius: 14,
    padding: 16, marginBottom: 16, alignItems: 'flex-start', gap: 12,
  },
  insufficientContent: { flex: 1 },
  insufficientTitle: { fontSize: 15, fontWeight: '700', color: '#DC2626', marginBottom: 3 },
  insufficientText:  { fontSize: 13, color: '#7F1D1D', lineHeight: 19 },

  /* Ready */
  readyCard: {
    flexDirection: 'row', backgroundColor: '#ECFDF5', borderRadius: 14,
    padding: 16, marginBottom: 16, alignItems: 'flex-start', gap: 12,
  },
  readyContent: { flex: 1 },
  readyTitle: { fontSize: 15, fontWeight: '700', color: '#065F46', marginBottom: 3 },
  readyText:  { fontSize: 13, color: '#064E3B', lineHeight: 19 },

  /* Security notice */
  securityNotice: {
    flexDirection: 'row', backgroundColor: '#FEF3C7', borderRadius: 14,
    padding: 16, marginBottom: 24, alignItems: 'flex-start', gap: 12,
  },
  noticeContent: { flex: 1 },
  noticeTitle: { fontSize: 15, fontWeight: '700', color: '#1E2B5A', marginBottom: 4 },
  noticeText:  { fontSize: 13, color: '#475569', lineHeight: 19 },

  /* Pay button */
  payButton: {
    backgroundColor: '#F97316', borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', marginBottom: 12,
  },
  payButtonDisabled: { backgroundColor: '#D1D5DB' },
  payButtonText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },

  /* Add money CTA */
  addMoneyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderWidth: 1.5, borderColor: '#F97316', borderRadius: 14,
    paddingVertical: 14, marginBottom: 16,
  },
  addMoneyBtnText: { fontSize: 15, fontWeight: '700', color: '#F97316' },

  /* Mobile money direct payment */
  mmDivider: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14,
  },
  mmDividerLine: { flex: 1, height: 1 },
  mmDividerText: { fontSize: 12, fontWeight: '600' },
  mmRow: { flexDirection: 'row', gap: 12, marginBottom: 10 },
  mmBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderWidth: 1.5, borderRadius: 14, paddingVertical: 15, minHeight: 52,
  },
  mmBtnDisabled: { opacity: 0.45 },
  mmBtnText: { fontSize: 14, fontWeight: '700' },
  mmHint: { fontSize: 12, textAlign: 'center', lineHeight: 18, marginBottom: 16 },

  termsText: { fontSize: 12, textAlign: 'center', lineHeight: 18 },

  /* Success */
  successContainer: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24,
  },
  successIcon:    { marginBottom: 24 },
  successTitle:   { fontSize: 24, fontWeight: '700', color: '#10B981', marginBottom: 12, textAlign: 'center' },
  successMessage: { fontSize: 16, textAlign: 'center', lineHeight: 24, marginBottom: 8 },
  successSubtext: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 32 },
  doneButton: {
    backgroundColor: '#F97316', borderRadius: 14, paddingVertical: 16,
    paddingHorizontal: 32, alignItems: 'center',
  },
  doneButtonText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
});
