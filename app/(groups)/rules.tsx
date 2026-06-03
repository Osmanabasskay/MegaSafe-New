import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Switch,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useGroupCreationStore, type GroupRulesConfig } from '../../src/store/groupCreationStore';
import {
  ArrowLeft,
  ArrowRight,
  Shield,
  Users,
  Clock,
  AlertTriangle,
  DollarSign,
  Calendar,
} from 'lucide-react-native';

export default function GroupRulesScreen() {
  const router = useRouter();
  const { draft, updateDetails, updateRules } = useGroupCreationStore();
  const [groupName, setGroupName] = useState(draft.name);
  const [groupDescription] = useState(draft.description);
  const [logoUri] = useState<string | null>(draft.logoUri);
  const [adminCollectionPhone] = useState(draft.adminCollectionPhone);
  const [rules, setRules] = useState<GroupRulesConfig>(draft.rules);

  const updateRule = <K extends keyof GroupRulesConfig>(key: K, value: GroupRulesConfig[K]) => {
    setRules(prev => ({ ...prev, [key]: value }));
  };

  const handleNext = () => {
    const name = groupName.trim();
    if (!name) { Alert.alert('Group name required', 'Enter a name for your group before continuing.'); return; }
    if (rules.maxMissedPayments < 0) { Alert.alert('Invalid rule', 'Maximum missed payments cannot be negative.'); return; }
    if (rules.reminderDays < 0) { Alert.alert('Invalid rule', 'Reminder days cannot be negative.'); return; }

    updateDetails({ name, description: groupDescription.trim(), logoUri, adminCollectionPhone });
    updateRules(rules);
    router.push('/(groups)/invite');
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>

        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft size={22} color="#F97316" />
          </TouchableOpacity>
          <View style={styles.titleBlock}>
            <Text style={styles.screenTitle}>Group Rules</Text>
            <Text style={styles.screenSubtitle}>Set up the basic information and rules for your group.</Text>
          </View>
          <View style={styles.stepBadge}>
            <Text style={styles.stepBadgeText}>2 of 3</Text>
          </View>
        </View>

        {/* Step progress */}
        <View style={styles.stepProgress}>
          <View style={[styles.stepDot, styles.stepDotDone]} />
          <View style={[styles.stepLine, styles.stepLineDone]} />
          <View style={[styles.stepDot, styles.stepDotActive]} />
          <View style={styles.stepLine} />
          <View style={styles.stepDot} />
        </View>

        <View style={styles.divider} />

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Group Information ── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={[styles.iconBadge, { backgroundColor: '#FFF7ED' }]}>
                <Shield size={18} color="#F97316" />
              </View>
              <Text style={styles.sectionTitle}>Group Information</Text>
            </View>

            <Text style={styles.inputLabel}>Group Name</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Enter group name"
              placeholderTextColor="#9CA3AF"
              value={groupName}
              onChangeText={setGroupName}
            />
          </View>

          <View style={styles.divider} />

          {/* ── Membership Rules ── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={[styles.iconBadge, { backgroundColor: '#EFF6FF' }]}>
                <Users size={18} color="#1D4ED8" />
              </View>
              <Text style={styles.sectionTitle}>Membership Rules</Text>
            </View>

            <View style={styles.ruleItem}>
              <View style={styles.ruleContent}>
                <Text style={styles.ruleTitle}>Require Approval</Text>
                <Text style={styles.ruleDescription}>New members must be approved before joining</Text>
              </View>
              <Switch
                value={rules.requireApproval}
                onValueChange={(v) => updateRule('requireApproval', v)}
                trackColor={{ false: '#E5E7EB', true: '#FED7AA' }}
                thumbColor={rules.requireApproval ? '#F97316' : '#9CA3AF'}
              />
            </View>

            <View style={styles.rowDivider} />

            <View style={styles.ruleItem}>
              <View style={styles.ruleContent}>
                <Text style={styles.ruleTitle}>Digital Only</Text>
                <Text style={styles.ruleDescription}>Only accept digital payments, no cash</Text>
              </View>
              <Switch
                value={rules.digitalOnly}
                onValueChange={(v) => updateRule('digitalOnly', v)}
                trackColor={{ false: '#E5E7EB', true: '#FED7AA' }}
                thumbColor={rules.digitalOnly ? '#F97316' : '#9CA3AF'}
              />
            </View>

            <View style={styles.rowDivider} />

            <Text style={styles.inputLabel}>Maximum Missed Payments</Text>
            <TextInput
              style={styles.textInput}
              placeholder="2"
              placeholderTextColor="#9CA3AF"
              value={rules.maxMissedPayments.toString()}
              onChangeText={(v) => updateRule('maxMissedPayments', Number.parseInt(v, 10) || 0)}
              keyboardType="numeric"
            />
          </View>

          <View style={styles.divider} />

          {/* ── Payment Rules ── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={[styles.iconBadge, { backgroundColor: '#FFF7ED' }]}>
                <DollarSign size={18} color="#F97316" />
              </View>
              <Text style={styles.sectionTitle}>Payment Rules</Text>
            </View>

            <View style={styles.ruleItem}>
              <View style={styles.ruleContent}>
                <Text style={styles.ruleTitle}>Allow Late Payments</Text>
                <Text style={styles.ruleDescription}>Members can pay after the deadline with fees</Text>
              </View>
              <Switch
                value={rules.allowLatePayments}
                onValueChange={(v) => updateRule('allowLatePayments', v)}
                trackColor={{ false: '#E5E7EB', true: '#FED7AA' }}
                thumbColor={rules.allowLatePayments ? '#F97316' : '#9CA3AF'}
              />
            </View>

            {rules.allowLatePayments && (
              <>
                <View style={styles.rowDivider} />
                <Text style={styles.inputLabel}>Late Payment Fee (NLe)</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="5.00"
                  placeholderTextColor="#9CA3AF"
                  value={rules.latePaymentFee.toString()}
                  onChangeText={(v) => updateRule('latePaymentFee', Number.parseFloat(v) || 0)}
                  keyboardType="numeric"
                />
              </>
            )}
          </View>

          <View style={styles.divider} />

          {/* ── Emergency Rules ── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={[styles.iconBadge, { backgroundColor: '#FEF2F2' }]}>
                <AlertTriangle size={18} color="#EF4444" />
              </View>
              <Text style={styles.sectionTitle}>Emergency Rules</Text>
            </View>

            <View style={styles.ruleItem}>
              <View style={styles.ruleContent}>
                <Text style={styles.ruleTitle}>Emergency Withdrawal</Text>
                <Text style={styles.ruleDescription}>Allow members to withdraw in emergencies</Text>
              </View>
              <Switch
                value={rules.emergencyWithdrawal}
                onValueChange={(v) => updateRule('emergencyWithdrawal', v)}
                trackColor={{ false: '#E5E7EB', true: '#FED7AA' }}
                thumbColor={rules.emergencyWithdrawal ? '#F97316' : '#9CA3AF'}
              />
            </View>

            {rules.emergencyWithdrawal && (
              <>
                <View style={styles.rowDivider} />
                <Text style={styles.inputLabel}>Emergency Withdrawal Limit (NLe)</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="50.00"
                  placeholderTextColor="#9CA3AF"
                  value={rules.withdrawalLimit.toString()}
                  onChangeText={(v) => updateRule('withdrawalLimit', Number.parseFloat(v) || 0)}
                  keyboardType="numeric"
                />
              </>
            )}
          </View>

          <View style={styles.divider} />

          {/* ── Meeting Settings ── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={[styles.iconBadge, { backgroundColor: '#ECFDF5' }]}>
                <Calendar size={18} color="#10B981" />
              </View>
              <Text style={styles.sectionTitle}>Meeting Settings</Text>
            </View>

            <Text style={styles.inputLabel}>Meeting Frequency</Text>
            <View style={styles.frequencyContainer}>
              {(['weekly', 'monthly', 'quarterly'] as const).map((freq) => (
                <TouchableOpacity
                  key={freq}
                  style={[styles.frequencyButton, rules.meetingFrequency === freq && styles.frequencyButtonActive]}
                  onPress={() => updateRule('meetingFrequency', freq)}
                >
                  <Text style={[styles.frequencyText, rules.meetingFrequency === freq && styles.frequencyTextActive]}>
                    {freq.charAt(0).toUpperCase() + freq.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.divider} />

          {/* ── Reminder Settings ── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={[styles.iconBadge, { backgroundColor: '#F5F3FF' }]}>
                <Clock size={18} color="#7C3AED" />
              </View>
              <Text style={styles.sectionTitle}>Reminder Settings</Text>
            </View>

            <View style={styles.ruleItem}>
              <View style={styles.ruleContent}>
                <Text style={styles.ruleTitle}>Auto Reminders</Text>
                <Text style={styles.ruleDescription}>Automatically remind members before payments</Text>
              </View>
              <Switch
                value={rules.autoReminders}
                onValueChange={(v) => updateRule('autoReminders', v)}
                trackColor={{ false: '#E5E7EB', true: '#FED7AA' }}
                thumbColor={rules.autoReminders ? '#F97316' : '#9CA3AF'}
              />
            </View>

            {rules.autoReminders && (
              <>
                <View style={styles.rowDivider} />
                <Text style={styles.inputLabel}>Remind Days Before</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="3"
                  placeholderTextColor="#9CA3AF"
                  value={rules.reminderDays.toString()}
                  onChangeText={(v) => updateRule('reminderDays', Number.parseInt(v, 10) || 0)}
                  keyboardType="numeric"
                />
              </>
            )}
          </View>

          {/* Continue Button */}
          <View style={styles.buttonContainer}>
            <TouchableOpacity style={styles.continueButton} onPress={handleNext} activeOpacity={0.88}>
              <Text style={styles.continueButtonText}>Continue</Text>
              <ArrowRight size={18} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#FFFFFF' },
  flex:          { flex: 1 },
  scrollContent: { paddingBottom: 48 },

  topBar:         { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 20, paddingVertical: 14 },
  backButton:     { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFF7ED', alignItems: 'center', justifyContent: 'center', marginTop: 2, marginRight: 12 },
  titleBlock:     { flex: 1 },
  screenTitle:    { fontSize: 18, fontWeight: '800', color: '#1E2B5A', letterSpacing: -0.3 },
  screenSubtitle: { fontSize: 13, color: '#64748B', marginTop: 3, lineHeight: 18 },
  stepBadge:      { backgroundColor: '#FFF7ED', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginTop: 2 },
  stepBadgeText:  { color: '#C2410C', fontSize: 12, fontWeight: '700' },

  stepProgress:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingBottom: 12, marginBottom: 0 },
  stepDot:       { width: 10, height: 10, borderRadius: 5, backgroundColor: '#E2E8F0' },
  stepDotDone:   { width: 10, height: 10, borderRadius: 5, backgroundColor: '#F97316' },
  stepDotActive: { width: 28, height: 10, borderRadius: 5, backgroundColor: '#F97316' },
  stepLine:      { width: 44, height: 2, backgroundColor: '#E2E8F0' },
  stepLineDone:  { width: 44, height: 2, backgroundColor: '#F97316' },

  divider:    { height: 1, backgroundColor: '#F3F4F6' },
  rowDivider: { height: 1, backgroundColor: '#F9FAFB', marginVertical: 12 },

  section:           { paddingHorizontal: 20, paddingVertical: 20 },
  sectionHeader:     { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 18 },
  iconBadge:         { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  sectionTitleGroup: { flex: 1 },
  sectionTitle:      { fontSize: 16, fontWeight: '700', color: '#1E2B5A' },
  sectionSubtitle:   { fontSize: 12, color: '#9CA3AF', marginTop: 2, lineHeight: 17 },

  fieldSpacer: { height: 18 },
  inputLabel:  { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 8 },
  textInput:   { backgroundColor: '#F9FAFB', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: '#1F2937', fontWeight: '500' },
  textArea:    { height: 80, textAlignVertical: 'top', paddingTop: 14 },

  logoCard:             { borderRadius: 16, borderWidth: 1.5, borderColor: '#E5E7EB', borderStyle: 'dashed', overflow: 'hidden', backgroundColor: '#FEFEFE' },
  logoPreview:          { width: '100%', height: 160 },
  logoPlaceholder:      { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 28 },
  logoIconWrap:         { width: 52, height: 52, borderRadius: 14, backgroundColor: '#FFF7ED', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  logoPlaceholderTitle: { fontSize: 14, fontWeight: '700', color: '#1E2B5A', marginBottom: 6 },
  logoPlaceholderText:  { fontSize: 12, color: '#9CA3AF', textAlign: 'center', lineHeight: 18 },

  iconInput:      { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: '#F9FAFB' },
  phoneIconBadge: { width: 32, height: 32, borderRadius: 9, backgroundColor: '#FFF7ED', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  iconInputField: { flex: 1, paddingVertical: 12, fontSize: 15, color: '#1F2937' },

  ruleItem:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  ruleContent:     { flex: 1, marginRight: 16 },
  ruleTitle:       { fontSize: 15, fontWeight: '600', color: '#1E2B5A', marginBottom: 3 },
  ruleDescription: { fontSize: 13, color: '#6B7280', lineHeight: 18 },

  frequencyContainer:    { flexDirection: 'row', backgroundColor: '#F3F4F6', borderRadius: 12, padding: 4 },
  frequencyButton:       { flex: 1, paddingVertical: 11, borderRadius: 8, alignItems: 'center' },
  frequencyButtonActive: { backgroundColor: '#F97316' },
  frequencyText:         { fontSize: 13, fontWeight: '600', color: '#6B7280' },
  frequencyTextActive:   { color: '#FFFFFF' },

  buttonContainer:    { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  continueButton:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F97316', borderRadius: 18, paddingVertical: 16, gap: 8 },
  continueButtonText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
});
