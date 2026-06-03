import React, { useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  Camera,
  ChevronRight,
  Coins,
  Hash,
  ImagePlus,
  List,
  Minus,
  Plus,
  Smartphone,
  Type,
  Users,
} from 'lucide-react-native';
import { useGroupCreationStore } from '../../src/store/groupCreationStore';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';
import type { PayoutOrder } from '../../src/types/group';
import { useKycGuard } from '../../src/hooks/useKycGuard';

type RotationChoice = 'alphabetical' | 'randomized' | 'custom';

const toPayoutOrder = (value: RotationChoice): PayoutOrder =>
  value === 'randomized' ? 'random' : value === 'custom' ? 'custom' : 'sequential';

const formatDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const displayDate = (iso: string): string => {
  if (!iso) return 'Select a date';
  const [y, m, d] = iso.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d} ${months[Number(m) - 1]} ${y}`;
};

export default function CreateGroupScreen() {
  const router = useRouter();
  const { requireKyc } = useKycGuard();
  const { draft, updateBaseConfig, updateDetails, setLogoUri } = useGroupCreationStore();
  const { preferences } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;

  const [osusuName, setOsusuName]         = useState(draft.name || '');
  const [frequency, setFrequency]         = useState<'daily' | 'weekly' | 'monthly'>(
    draft.frequency === 'biweekly' ? 'weekly' : draft.frequency,
  );
  const [members, setMembers]             = useState(Math.max(2, Math.min(200, draft.maxMembers)));
  const [membersText, setMembersText]     = useState(String(Math.max(2, Math.min(200, draft.maxMembers))));
  const [rotationOrder, setRotationOrder] = useState<RotationChoice>(
    draft.payoutOrder === 'random' ? 'randomized' : draft.payoutOrder === 'custom' ? 'custom' : 'alphabetical',
  );
  const [amount, setAmount]               = useState(
    draft.contributionAmount > 0 ? draft.contributionAmount.toFixed(2) : '',
  );
  const [startDate, setStartDate]         = useState(draft.cycleStartDate || formatDate(new Date()));
  const [logoUri, setLogoUriLocal]        = useState<string | null>(draft.logoUri);
  const [collectionPhone, setCollectionPhone] = useState(draft.adminCollectionPhone || '');

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [datePickerDate, setDatePickerDate] = useState(
    new Date(draft.cycleStartDate || Date.now()),
  );
  const [iosDateModal, setIosDateModal] = useState(false);

  const adjustMembers = (delta: number) => {
    const next = Math.max(2, Math.min(200, members + delta));
    setMembers(next);
    setMembersText(String(next));
  };

  const handleMembersText = (text: string) => {
    setMembersText(text);
    const n = Number.parseInt(text, 10);
    if (Number.isFinite(n)) setMembers(Math.max(2, Math.min(200, n)));
  };

  const handleMembersBlur = () => {
    const clamped = Math.max(2, Math.min(200, members));
    setMembers(clamped);
    setMembersText(String(clamped));
  };

  const openDatePicker = () => {
    if (Platform.OS === 'ios') setIosDateModal(true);
    else setShowDatePicker(true);
  };

  const onDateChange = (_event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (date) { setDatePickerDate(date); setStartDate(formatDate(date)); }
  };

  const handlePickLogo = () => {
    Alert.alert('Group Photo', 'Choose how to add a group logo', [
      { text: 'Take Photo', onPress: openCamera },
      { text: 'Choose from Library', onPress: openLibrary },
      { text: 'Cancel', style: 'cancel' },
    ], { cancelable: true });
  };

  const applyAsset = (asset: ImagePicker.ImagePickerAsset) => {
    if (asset.fileSize && asset.fileSize > 2 * 1024 * 1024) {
      Alert.alert('File too large', 'Please choose an image under 2 MB.');
      return;
    }
    setLogoUriLocal(asset.uri);
    setLogoUri(asset.uri);
  };

  const openCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Camera access is required.'); return; }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.85 });
    if (!result.canceled && result.assets[0]) applyAsset(result.assets[0]);
  };

  const openLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Photo library access is required.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.85, mediaTypes: ['images'] });
    if (!result.canceled && result.assets[0]) applyAsset(result.assets[0]);
  };

  const handleCreate = () => {
    if (!requireKyc('create an Osusu group')) return;

    if (!osusuName.trim()) { Alert.alert('Name required', 'Enter a name for your Osusu group.'); return; }
    const contributionAmount = Number.parseFloat(amount);
    if (!Number.isFinite(contributionAmount) || contributionAmount <= 0) {
      Alert.alert('Invalid amount', 'Enter a contribution amount greater than 0.'); return;
    }
    const clampedMembers = Math.max(2, Math.min(200, members));
    if (!startDate) { Alert.alert('Date required', 'Please select a start date.'); return; }
    if (!collectionPhone.trim()) {
      Alert.alert('Collection number required', 'Enter the mobile money number members will send contributions to.');
      return;
    }

    updateBaseConfig({
      contributionAmount, frequency, maxMembers: clampedMembers,
      cycleStartDate: startDate, totalCycles: clampedMembers,
      payoutOrder: toPayoutOrder(rotationOrder),
    });
    updateDetails({ name: osusuName.trim(), description: draft.description, logoUri, adminCollectionPhone: collectionPhone.trim() });
    router.push('/(groups)/rules');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Top bar */}
          <View style={styles.topBar}>
            <TouchableOpacity onPress={() => router.back()} style={[styles.backButton, { backgroundColor: isDark ? '#431407' : '#FFF7ED' }]}>
              <ArrowLeft size={22} color="#F97316" />
            </TouchableOpacity>
            <Text style={[styles.screenTitle, { color: C.text }]}>Create Osusu</Text>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>1 of 3</Text>
            </View>
          </View>

          {/* Step progress */}
          <View style={styles.stepProgress}>
            <View style={[styles.stepDot, styles.stepDotActive]} />
            <View style={styles.stepLine} />
            <View style={styles.stepDot} />
            <View style={styles.stepLine} />
            <View style={styles.stepDot} />
          </View>

          {/* ── GROUP NAME ── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: C.text }]}>Group Name</Text>
              <Text style={styles.charCount}>{osusuName.length}/30</Text>
            </View>
            <TextInput
              style={[styles.textInput, { backgroundColor: C.inputBg, color: C.text }]}
              placeholder="Enter your group name"
              placeholderTextColor={C.textMuted}
              value={osusuName}
              onChangeText={setOsusuName}
              maxLength={30}
            />
          </View>

          <View style={styles.divider} />

          {/* ── CONTRIBUTION STRUCTURE ── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: C.text }]}>Contribution Structure</Text>
            </View>
            <Text style={styles.fieldLabel}>Amount</Text>
            <View style={[styles.amountRow, { backgroundColor: C.inputBg }]}>
              <Text style={[styles.amountPrefix, { color: C.text }]}>NLe</Text>
              <TextInput
                style={[styles.amountInput, { color: C.text }]}
                placeholder="0.00"
                placeholderTextColor={C.textMuted}
                keyboardType="decimal-pad"
                value={amount}
                onChangeText={setAmount}
              />
              {amount.length > 0 && (
                <TouchableOpacity onPress={() => setAmount('')} style={[styles.amountClear, { backgroundColor: C.iconBg }]}>
                  <Text style={[styles.amountClearText, { color: C.textSub }]}>×</Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.fieldLabel}>Frequency</Text>
            <View style={styles.pillRow}>
              {(['daily', 'weekly', 'monthly'] as const).map((freq) => (
                <TouchableOpacity
                  key={freq}
                  style={[styles.pill, { backgroundColor: C.inputBg }, frequency === freq && styles.pillActive]}
                  onPress={() => setFrequency(freq)}
                >
                  <Text style={[styles.pillText, { color: C.textSub }, frequency === freq && styles.pillTextActive]}>
                    {freq.charAt(0).toUpperCase() + freq.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.divider} />

          {/* ── MEMBERS CAPACITY ── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={[styles.iconBadge, { backgroundColor: isDark ? '#1E3A5F' : '#EFF6FF' }]}>
                <Users size={18} color="#1D4ED8" />
              </View>
              <Text style={[styles.sectionTitle, { color: C.text }]}>Members Capacity</Text>
            </View>
            <Text style={[styles.helperText, { color: C.textSub }]}>Between 2 and 200 members.</Text>
            <View style={styles.counterRow}>
              <TouchableOpacity style={[styles.counterBtn, { backgroundColor: C.inputBg }]} onPress={() => adjustMembers(-1)} activeOpacity={0.75}>
                <Minus size={20} color={C.text} />
              </TouchableOpacity>
              <TextInput
                style={[styles.counterInput, { backgroundColor: C.inputBg, color: C.text }]}
                value={membersText}
                onChangeText={handleMembersText}
                onBlur={handleMembersBlur}
                keyboardType="number-pad"
                maxLength={3}
                textAlign="center"
              />
              <TouchableOpacity style={[styles.counterBtn, { backgroundColor: C.inputBg }]} onPress={() => adjustMembers(1)} activeOpacity={0.75}>
                <Plus size={20} color={C.text} />
              </TouchableOpacity>
            </View>
            <Text style={styles.membersHint}>members (2–200)</Text>
          </View>

          <View style={styles.divider} />

          {/* ── START DATE ── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={[styles.iconBadge, { backgroundColor: isDark ? '#064E3B' : '#ECFDF5' }]}>
                <Calendar size={18} color="#10B981" />
              </View>
              <Text style={[styles.sectionTitle, { color: C.text }]}>Starting Date</Text>
            </View>
            <TouchableOpacity style={[styles.dateButton, { backgroundColor: C.inputBg }]} onPress={openDatePicker} activeOpacity={0.8}>
              <Calendar size={18} color="#F97316" />
              <Text style={[styles.dateButtonText, { color: C.text }, !startDate && styles.datePlaceholder]}>
                {startDate ? displayDate(startDate) : 'Select start date'}
              </Text>
              <ChevronRight size={16} color={C.textMuted} />
            </TouchableOpacity>
            {Platform.OS === 'android' && showDatePicker && (
              <DateTimePicker value={datePickerDate} mode="date" display="default" onChange={onDateChange} minimumDate={new Date()} />
            )}
          </View>

          <View style={styles.divider} />

          {/* ── COLLECTION ACCOUNT ── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={[styles.iconBadge, { backgroundColor: isDark ? '#431407' : '#FFF7ED' }]}>
                <Smartphone size={18} color="#F97316" />
              </View>
              <Text style={[styles.sectionTitle, { color: C.text }]}>Collection Account</Text>
            </View>
            <Text style={[styles.helperText, { color: C.textSub }]}>
              Mobile money number members will send their contributions to (e.g. Orange Money, AfriMoney, Q Money).
            </Text>
            <View style={[styles.phoneRow, { backgroundColor: C.inputBg }]}>
              <Text style={[styles.phonePrefix, { color: C.text }]}>+232</Text>
              <TextInput
                style={[styles.phoneInput, { color: C.text }]}
                placeholder="76 000 000"
                placeholderTextColor={C.textMuted}
                keyboardType="phone-pad"
                value={collectionPhone}
                onChangeText={setCollectionPhone}
                maxLength={15}
              />
            </View>
          </View>

          <View style={styles.divider} />

          {/* ── CONTRIBUTION NUMBER ── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={[styles.iconBadge, { backgroundColor: isDark ? '#064E3B' : '#ECFDF5' }]}>
                <Hash size={18} color="#059669" />
              </View>
              <Text style={[styles.sectionTitle, { color: C.text }]}>Contribution Number</Text>
            </View>
            <Text style={[styles.helperText, { color: C.textSub }]}>Auto-generated identifier. Finalised when the group is created.</Text>
            <View style={styles.readOnlyField}>
              <Text style={styles.readOnlyValue}>{draft.contributionNumber}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* ── PAYOUT ROTATION ── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={[styles.iconBadge, { backgroundColor: isDark ? '#2E1065' : '#F5F3FF' }]}>
                <List size={18} color="#7C3AED" />
              </View>
              <Text style={[styles.sectionTitle, { color: C.text }]}>Payout Rotation</Text>
            </View>
            {[
              { id: 'alphabetical' as const, title: 'Sequential', subtitle: 'Predictable order based on member position' },
              { id: 'randomized' as const,   title: 'Random',     subtitle: 'System-generated fair shuffle' },
              { id: 'custom' as const,        title: 'Custom',     subtitle: 'You set the order after the group is formed' },
            ].map((opt, idx, arr) => (
              <React.Fragment key={opt.id}>
                <TouchableOpacity style={styles.radioRow} onPress={() => setRotationOrder(opt.id)} activeOpacity={0.75}>
                  <View style={styles.radioOuter}>
                    {rotationOrder === opt.id && <View style={styles.radioInner} />}
                  </View>
                  <View style={styles.radioBody}>
                    <Text style={[styles.radioTitle, { color: C.text }]}>{opt.title}</Text>
                    <Text style={[styles.radioSubtitle, { color: C.textSub }]}>{opt.subtitle}</Text>
                  </View>
                </TouchableOpacity>
                {idx < arr.length - 1 && <View style={[styles.dividerLight, { backgroundColor: C.border }]} />}
              </React.Fragment>
            ))}
          </View>

          <View style={styles.divider} />

          {/* ── GROUP PHOTO (last — optional) ── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: C.text }]}>Group Photo</Text>
              <View style={styles.optionalTag}><Text style={styles.optionalText}>Optional</Text></View>
            </View>
            <TouchableOpacity onPress={handlePickLogo} style={styles.logoArea} activeOpacity={0.8}>
              {logoUri ? (
                <View style={styles.logoPreviewWrap}>
                  <Image source={{ uri: logoUri }} style={styles.logoImage} />
                  <View style={styles.editBadge}><Camera size={14} color="#FFFFFF" /></View>
                </View>
              ) : (
                <View style={[styles.logoPickerBox, { backgroundColor: C.inputBg }]}>
                  <View style={[styles.logoIconWrap, { backgroundColor: isDark ? '#431407' : '#FFF7ED' }]}><ImagePlus size={30} color="#F97316" /></View>
                  <Text style={[styles.logoPickerTitle, { color: C.text }]}>Upload Group Photo</Text>
                  <Text style={[styles.logoPickerSub, { color: C.textMuted }]}>JPG or PNG · Max 2 MB</Text>
                  <View style={styles.logoSourceRow}>
                    <View style={styles.sourcePill}>
                      <Camera size={12} color="#475569" />
                      <Text style={styles.sourcePillText}>Camera</Text>
                    </View>
                    <View style={styles.sourcePill}>
                      <ImagePlus size={12} color="#475569" />
                      <Text style={styles.sourcePillText}>Gallery</Text>
                    </View>
                  </View>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* ── Continue button ── */}
          <View style={styles.buttonContainer}>
            <TouchableOpacity onPress={handleCreate} style={styles.primaryButton} activeOpacity={0.88}>
              <Text style={styles.primaryButtonText}>Continue</Text>
              <ArrowRight size={18} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {Platform.OS === 'ios' && (
        <Modal visible={iosDateModal} transparent animationType="slide" onRequestClose={() => setIosDateModal(false)}>
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setIosDateModal(false)} />
          <View style={[styles.iosPickerSheet, { backgroundColor: C.card }]}>
            <View style={[styles.iosPickerHeader, { borderBottomColor: C.border }]}>
              <TouchableOpacity onPress={() => setIosDateModal(false)}>
                <Text style={[styles.iosPickerCancel, { color: C.textSub }]}>Cancel</Text>
              </TouchableOpacity>
              <Text style={[styles.iosPickerTitle, { color: C.text }]}>Start Date</Text>
              <TouchableOpacity onPress={() => { setStartDate(formatDate(datePickerDate)); setIosDateModal(false); }}>
                <Text style={styles.iosPickerDone}>Done</Text>
              </TouchableOpacity>
            </View>
            <DateTimePicker
              value={datePickerDate} mode="date" display="spinner"
              onChange={(_e, d) => { if (d) setDatePickerDate(d); }}
              minimumDate={new Date()} style={{ height: 220 }}
            />
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1 },
  flex:           { flex: 1 },
  scrollContent:  { paddingBottom: 48 },

  topBar:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
  backButton:     { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  screenTitle:    { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  stepBadge:      { backgroundColor: '#FFF7ED', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  stepBadgeText:  { color: '#C2410C', fontSize: 12, fontWeight: '700' },

  stepProgress:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingBottom: 8, marginBottom: 4 },
  stepDot:        { width: 10, height: 10, borderRadius: 5, backgroundColor: '#E2E8F0' },
  stepDotActive:  { width: 28, height: 10, borderRadius: 5, backgroundColor: '#F97316' },
  stepLine:       { width: 44, height: 2, backgroundColor: '#E2E8F0' },

  section:        { paddingHorizontal: 20, paddingVertical: 18 },
  sectionHeader:  { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  sectionTitle:   { marginLeft: 10, fontSize: 15, fontWeight: '700', flex: 1 },
  iconBadge:      { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  optionalTag:    { backgroundColor: '#F1F5F9', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  optionalText:   { color: '#94A3B8', fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  charCount:      { fontSize: 12, color: '#94A3B8', fontWeight: '600' },

  divider:        { height: 1, backgroundColor: '#F3F4F6' },
  dividerLight:   { height: 1, backgroundColor: '#F8FAFC', marginVertical: 4 },

  logoArea:         { alignItems: 'center' },
  logoPreviewWrap:  { position: 'relative' },
  logoImage:        { width: 104, height: 104, borderRadius: 20 },
  editBadge:        { position: 'absolute', bottom: 4, right: 4, width: 28, height: 28, borderRadius: 14, backgroundColor: '#F97316', alignItems: 'center', justifyContent: 'center' },
  logoPickerBox:    { width: '100%', backgroundColor: '#FEFEFE', borderRadius: 16, paddingVertical: 28, paddingHorizontal: 20, alignItems: 'center', borderWidth: 1.5, borderColor: '#F97316', borderStyle: 'dashed' },
  logoIconWrap:     { width: 64, height: 64, borderRadius: 16, backgroundColor: '#FFF7ED', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  logoPickerTitle:  { fontSize: 14, fontWeight: '700', color: '#1E2B5A', marginBottom: 4 },
  logoPickerSub:    { fontSize: 12, color: '#94A3B8', marginBottom: 14 },
  logoSourceRow:    { flexDirection: 'row', gap: 8 },
  sourcePill:       { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#F1F5F9', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  sourcePillText:   { fontSize: 12, fontWeight: '600', color: '#475569' },

  fieldLabel:      { color: '#64748B', fontSize: 12, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 },
  textInput:       { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, fontSize: 15, fontWeight: '600' },
  helperText:      { fontSize: 13, lineHeight: 19, marginBottom: 14 },

  amountRow:       { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingHorizontal: 14, marginBottom: 16 },
  amountPrefix:    { fontSize: 15, fontWeight: '800', marginRight: 8 },
  amountInput:     { flex: 1, paddingVertical: 14, fontSize: 20, fontWeight: '800' },
  amountClear:     { width: 28, height: 28, borderRadius: 14, backgroundColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center' },
  amountClearText: { fontSize: 18, color: '#64748B', lineHeight: 22, fontWeight: '600' },

  pillRow:         { flexDirection: 'row', gap: 8 },
  pill:            { flex: 1, paddingVertical: 11, borderRadius: 12, backgroundColor: '#F1F5F9', alignItems: 'center' },
  pillActive:      { backgroundColor: '#F97316' },
  pillText:        { color: '#334155', fontSize: 13, fontWeight: '700' },
  pillTextActive:  { color: '#FFFFFF' },

  counterRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  counterBtn:      { width: 48, height: 48, borderRadius: 14, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  counterInput:    { width: 96, height: 56, fontSize: 26, fontWeight: '800', borderRadius: 14, marginHorizontal: 12, textAlign: 'center' },
  membersHint:     { textAlign: 'center', marginTop: 8, fontSize: 12, color: '#94A3B8', fontWeight: '600' },

  dateButton:      { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, gap: 10 },
  dateButtonText:  { flex: 1, fontSize: 15, fontWeight: '600' },
  datePlaceholder: { color: '#9CA3AF' },

  readOnlyField:   { backgroundColor: '#F0FDF4', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14 },
  readOnlyValue:   { color: '#059669', fontSize: 15, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', letterSpacing: 1 },

  phoneRow:        { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingHorizontal: 14, overflow: 'hidden' },
  phonePrefix:     { fontSize: 15, fontWeight: '800', marginRight: 8, paddingVertical: 14 },
  phoneInput:      { flex: 1, paddingVertical: 14, fontSize: 15, fontWeight: '600' },

  radioRow:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  radioOuter:      { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#F97316', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  radioInner:      { width: 10, height: 10, borderRadius: 5, backgroundColor: '#F97316' },
  radioBody:       { flex: 1 },
  radioTitle:      { fontSize: 14, fontWeight: '700' },
  radioSubtitle:   { marginTop: 2, fontSize: 12, lineHeight: 17 },

  buttonContainer:   { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  primaryButton:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F97316', borderRadius: 18, paddingVertical: 16, gap: 8 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },

  modalBackdrop:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  iosPickerSheet:  { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 32 },
  iosPickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1 },
  iosPickerTitle:  { fontSize: 16, fontWeight: '700' },
  iosPickerCancel: { fontSize: 15, fontWeight: '600' },
  iosPickerDone:   { fontSize: 15, color: '#F97316', fontWeight: '700' },
});
