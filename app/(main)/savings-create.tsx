import React, { useMemo, useState } from 'react';
import {
  Alert,
  Dimensions,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  Car,
  ChevronDown,
  GraduationCap,
  Home,
  Luggage,
  Map,
} from 'lucide-react-native';
import { useAuthStore } from '../../src/store/authStore';
import { useKycGuard } from '../../src/hooks/useKycGuard';
import { createSavingsGoal as createRemoteSavingsGoal } from '../../src/services/savingsService';
import type { SavingsGoalCategory } from '../../src/services/savingsService';

// ─── Layout ───────────────────────────────────────────────────────────────────
const { width: SCREEN_WIDTH } = Dimensions.get('window');
// 3 columns with 24px side padding × 2 and 12px gap × 2
const TILE_WIDTH  = Math.floor((SCREEN_WIDTH - 48 - 24) / 3);
const TILE_HEIGHT = TILE_WIDTH + 8;

// ─── Categories ───────────────────────────────────────────────────────────────
type CategoryKey = 'house' | 'car' | 'land' | 'education' | 'travel' | 'emergency';

const CATEGORIES: Array<{
  key: CategoryKey;
  label: string;
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  category: SavingsGoalCategory;
}> = [
  { key: 'house',     label: 'House',     Icon: Home,         category: 'house'       },
  { key: 'car',       label: 'Car',       Icon: Car,          category: 'car'         },
  { key: 'land',      label: 'Land',      Icon: Map,          category: 'other'       },
  { key: 'education', label: 'Education', Icon: GraduationCap,category: 'school_fees' },
  { key: 'travel',    label: 'Travel',    Icon: Luggage,      category: 'travel'      },
  { key: 'emergency', label: 'Emergency', Icon: AlertCircle,  category: 'emergency'   },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getDefaultDate = (): Date => {
  const d = new Date();
  d.setDate(d.getDate() + 90);
  return d;
};

const isoFromDate = (d: Date): string => d.toISOString().slice(0, 10);

const displayDate = (d: Date): string => {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
};

const formatAmount = (raw: string): string => {
  if (!raw) return '';
  const n = parseInt(raw, 10);
  return isNaN(n) ? raw : n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function SavingsCreateScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { requireKyc } = useKycGuard();

  const [title, setTitle]                     = useState('');
  const [amountRaw, setAmountRaw]             = useState('');
  const [dateObj, setDateObj]                 = useState<Date>(getDefaultDate);
  const [targetDate, setTargetDate]           = useState(isoFromDate(getDefaultDate()));
  const [category, setCategory]               = useState<CategoryKey>('house');
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(false);
  const [autoSaveRaw, setAutoSaveRaw]         = useState('');
  const [autoSaveInterval, setAutoSaveInterval] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [submitting, setSubmitting]           = useState(false);

  // Date picker
  const [showPicker, setShowPicker]   = useState(false);
  const [iosModal, setIosModal]       = useState(false);

  const parsedAmount   = useMemo(() => Number(amountRaw),   [amountRaw]);
  const parsedAutoSave = useMemo(() => Number(autoSaveRaw), [autoSaveRaw]);

  const openDatePicker = () => {
    if (Platform.OS === 'ios') setIosModal(true);
    else setShowPicker(true);
  };

  const onDateChange = (_e: DateTimePickerEvent, selected?: Date) => {
    setShowPicker(false);
    if (selected) { setDateObj(selected); setTargetDate(isoFromDate(selected)); }
  };

  const validate = (): string | null => {
    if (title.trim().length < 2)           return 'Enter a goal title (at least 2 characters).';
    if (!isFinite(parsedAmount) || parsedAmount <= 0) return 'Enter a valid target amount.';
    if (autoSaveEnabled) {
      if (!isFinite(parsedAutoSave) || parsedAutoSave <= 0)
        return 'Enter a valid auto-save amount.';
      if (parsedAutoSave > parsedAmount)
        return 'Auto-save amount cannot exceed the target amount.';
    }
    return null;
  };

  const handleCreate = async () => {
    if (!requireKyc('create savings goal')) return;
    const err = validate();
    if (err) { Alert.alert('Check your details', err); return; }
    if (!user?.id) { Alert.alert('Sign in required', 'Please sign in again.'); return; }

    const cat = CATEGORIES.find((c) => c.key === category);
    setSubmitting(true);

    const { error } = await createRemoteSavingsGoal({
      ownerId:          user.id,
      title:            title.trim(),
      targetAmount:     parsedAmount,
      targetDate,
      category:         cat?.category ?? 'other',
      autoSaveEnabled,
      autoSaveAmount:   autoSaveEnabled ? parsedAutoSave : null,
      autoSaveFrequency: autoSaveEnabled ? autoSaveInterval : null,
    });

    setSubmitting(false);
    if (error) { Alert.alert('Could not create goal', error.message); return; }
    Alert.alert('Goal created', 'Your savings goal is ready.');
    router.replace('/(main)/savings');
  };

  return (
    <SafeAreaView style={s.root} edges={['bottom']}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Back arrow */}
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
          <ArrowLeft size={20} color="#F97316" />
        </TouchableOpacity>

        {/* Heading */}
        <Text style={s.heading}>Create savings goal</Text>
        <Text style={s.subheading}>Set a goal and save with purpose.</Text>

        {/* ── Goal title ── */}
        <View style={s.field}>
          <Text style={s.label}>Goal title</Text>
          <TextInput
            style={s.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Buy a car"
            placeholderTextColor="#9CA3AF"
            maxLength={60}
          />
        </View>

        {/* ── Target amount ── */}
        <View style={s.field}>
          <Text style={s.label}>Target amount (NLE)</Text>
          <TextInput
            style={s.input}
            value={formatAmount(amountRaw)}
            onChangeText={(t) => setAmountRaw(t.replace(/[^0-9]/g, ''))}
            placeholder="1,000,000"
            placeholderTextColor="#9CA3AF"
            keyboardType="number-pad"
          />
        </View>

        {/* ── Target date ── */}
        <View style={s.field}>
          <Text style={s.label}>Target date</Text>
          <TouchableOpacity style={s.dateRow} onPress={openDatePicker} activeOpacity={0.8}>
            <Calendar size={18} color="#F97316" />
            <Text style={s.dateText}>{displayDate(dateObj)}</Text>
            <ChevronDown size={16} color="#9CA3AF" />
          </TouchableOpacity>
          {Platform.OS === 'android' && showPicker && (
            <DateTimePicker
              value={dateObj} mode="date" display="default"
              onChange={onDateChange} minimumDate={new Date()}
            />
          )}
        </View>

        {/* ── Category ── */}
        <View style={s.field}>
          <Text style={s.label}>Category</Text>
          <Text style={s.categoryHint}>Choose a category that best fits your goal.</Text>
          <View style={s.grid}>
            {CATEGORIES.map((item) => {
              const active = category === item.key;
              return (
                <TouchableOpacity
                  key={item.key}
                  style={[s.tile, active && s.tileActive]}
                  onPress={() => setCategory(item.key)}
                  activeOpacity={0.8}
                >
                  <item.Icon
                    size={28}
                    color={active ? '#F97316' : '#9CA3AF'}
                    strokeWidth={1.75}
                  />
                  <Text style={[s.tileLabel, active && s.tileLabelActive]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── Auto-save (below category, scrollable) ── */}
        <View style={s.autoSaveRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.autoSaveTitle}>Enable auto-save</Text>
            <Text style={s.autoSaveSub}>Automatically contribute on a schedule</Text>
          </View>
          <Switch
            value={autoSaveEnabled}
            onValueChange={setAutoSaveEnabled}
            trackColor={{ false: '#E5E7EB', true: '#F97316' }}
            thumbColor="#FFFFFF"
          />
        </View>

        {autoSaveEnabled && (
          <>
            <View style={s.field}>
              <Text style={s.label}>Auto-save amount (NLE)</Text>
              <TextInput
                style={s.input}
                value={formatAmount(autoSaveRaw)}
                onChangeText={(t) => setAutoSaveRaw(t.replace(/[^0-9]/g, ''))}
                placeholder="500"
                placeholderTextColor="#9CA3AF"
                keyboardType="number-pad"
              />
            </View>

            <View style={[s.field, { marginBottom: 8 }]}>
              <Text style={s.label}>Frequency</Text>
              <View style={s.chips}>
                {(['daily', 'weekly', 'monthly'] as const).map((v) => (
                  <TouchableOpacity
                    key={v}
                    style={[s.chip, autoSaveInterval === v && s.chipActive]}
                    onPress={() => setAutoSaveInterval(v)}
                  >
                    <Text style={[s.chipText, autoSaveInterval === v && s.chipTextActive]}>
                      {v.charAt(0).toUpperCase() + v.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </>
        )}

        {/* Bottom padding to clear sticky button */}
        <View style={{ height: 20 }} />
      </ScrollView>

      {/* ── Sticky Continue ── */}
      <View style={s.footer}>
        <TouchableOpacity
          style={[s.continueBtn, submitting && { opacity: 0.6 }]}
          disabled={submitting}
          onPress={() => void handleCreate()}
          activeOpacity={0.88}
        >
          <Text style={s.continueBtnText}>{submitting ? 'Saving…' : 'Continue'}</Text>
        </TouchableOpacity>
      </View>

      {/* iOS date picker modal */}
      {Platform.OS === 'ios' && (
        <Modal visible={iosModal} transparent animationType="slide">
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}
            activeOpacity={1}
            onPress={() => setIosModal(false)}
          />
          <View style={s.iosSheet}>
            <View style={s.iosSheetHeader}>
              <TouchableOpacity onPress={() => setIosModal(false)}>
                <Text style={s.iosCancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={s.iosTitle}>Target Date</Text>
              <TouchableOpacity onPress={() => {
                setTargetDate(isoFromDate(dateObj));
                setIosModal(false);
              }}>
                <Text style={s.iosDone}>Done</Text>
              </TouchableOpacity>
            </View>
            <DateTimePicker
              value={dateObj} mode="date" display="spinner"
              onChange={(_e, d) => { if (d) setDateObj(d); }}
              minimumDate={new Date()} style={{ height: 220 }}
            />
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#FFFFFF' },
  scroll:  { flex: 1 },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 16 },

  // Back
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#FFF7ED',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 20,
  },

  // Heading
  heading:    { fontSize: 28, fontWeight: '800', color: '#1E2B5A', marginBottom: 6, letterSpacing: -0.5 },
  subheading: { fontSize: 14, color: '#9CA3AF', marginBottom: 32, lineHeight: 20 },

  // Field wrapper
  field:  { marginBottom: 28 },
  label:  { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 10, letterSpacing: 0.2 },

  // Underline input
  input: {
    fontSize: 16, color: '#111827',
    borderBottomWidth: 1.5, borderBottomColor: '#E5E7EB',
    paddingBottom: 10, paddingTop: 2, backgroundColor: 'transparent',
  },

  // Date row
  dateRow:  {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderBottomWidth: 1.5, borderBottomColor: '#E5E7EB', paddingBottom: 10,
  },
  dateText: { flex: 1, fontSize: 16, color: '#111827', fontWeight: '500' },

  // Category
  categoryHint: { fontSize: 13, color: '#9CA3AF', marginBottom: 20 },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 12,
  },
  tile: {
    width: TILE_WIDTH, height: TILE_HEIGHT,
    borderRadius: 18,
    backgroundColor: '#F9FAFB',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  tileActive: {
    backgroundColor: '#FFF7ED',
    borderWidth: 1.5, borderColor: '#FED7AA',
  },
  tileLabel: {
    fontSize: 12, fontWeight: '600', color: '#9CA3AF', textAlign: 'center',
  },
  tileLabelActive: { color: '#F97316' },

  // Auto-save toggle
  autoSaveRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 18,
    borderTopWidth: 1, borderTopColor: '#F3F4F6',
    marginBottom: 8,
  },
  autoSaveTitle: { fontSize: 15, fontWeight: '700', color: '#1E2B5A' },
  autoSaveSub:   { fontSize: 12, color: '#9CA3AF', marginTop: 2 },

  // Frequency chips
  chips:        { flexDirection: 'row', gap: 8, marginTop: 4 },
  chip:         { flex: 1, backgroundColor: '#F3F4F6', borderRadius: 999, paddingVertical: 11, alignItems: 'center' },
  chipActive:   { backgroundColor: '#F97316' },
  chipText:     { fontSize: 13, fontWeight: '700', color: '#6B7280' },
  chipTextActive:{ color: '#FFFFFF' },

  // Sticky footer
  footer: {
    paddingHorizontal: 24, paddingVertical: 16,
    borderTopWidth: 1, borderTopColor: '#F3F4F6',
    backgroundColor: '#FFFFFF',
  },
  continueBtn: {
    backgroundColor: '#F97316', borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#F97316', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28, shadowRadius: 10, elevation: 5,
  },
  continueBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },

  // iOS modal
  iosSheet:       { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 34 },
  iosSheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  iosTitle:  { fontSize: 16, fontWeight: '700', color: '#1E2B5A' },
  iosCancel: { fontSize: 16, color: '#6B7280', fontWeight: '500' },
  iosDone:   { fontSize: 16, color: '#F97316', fontWeight: '700' },
});
