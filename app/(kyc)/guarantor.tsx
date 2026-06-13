import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  Modal,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/store/authStore';
import { getKycDraftSnapshot, useKycDraftStore } from '../../src/store/kycDraftStore';
import { KycProgress } from '../../src/components/kyc/KycProgress';
import { guarantorSchema, type GuarantorForm, nationalIdTypes } from '../../src/utils/validation/kyc';
import { submitKycPackage } from '../../src/services/profileService';
import { ChevronDown, Shield, Upload, User } from 'lucide-react-native';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';

// ─────────────────────────────────────────────────────────────────────────────

export default function GuarantorScreen() {
  const router    = useRouter();
  const user      = useAuthStore((s) => s.user);
  const resetDraft = useKycDraftStore((s) => s.reset);
  const { preferences } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;

  const [guarantorIdUri,    setGuarantorIdUri]    = useState<string | null>(null);
  const [guarantorIdBase64, setGuarantorIdBase64] = useState<string>('');
  const [guarantorIdMime,   setGuarantorIdMime]   = useState<string>('image/jpeg');
  const [picking,        setPicking]        = useState(false);
  const [submitting,     setSubmitting]     = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [idTypeModal,    setIdTypeModal]    = useState(false);

  const {
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<GuarantorForm>({
    resolver: zodResolver(guarantorSchema),
    defaultValues: {
      guarantorName:    '',
      guarantorPhone:   '',
      guarantorEmail:   '',
      guarantorAddress: '',
      relationship:     '',
      nationalIdType:   'national_id',
      nationalIdNumber: '',
    },
  });

  const nationalIdType  = watch('nationalIdType');
  const selectedIdLabel = nationalIdTypes.find((t) => t.value === nationalIdType)?.label ?? 'Select ID type';

  // ── Document picker ──────────────────────────────────────────────────────────
  // Only picks the local URI; the actual upload to Supabase Storage happens
  // inside submitKycPackage (backend call) – no business logic in the frontend.
  const pickGuarantorDoc = async () => {
    setPicking(true);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setPicking(false);
      Alert.alert('Permission needed', 'Allow photo library access to upload the guarantor ID document.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.85,
      base64: true, // required: Android gallery returns content:// URIs; XHR cannot read them
    });
    setPicking(false);
    if (!result.canceled) {
      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) {
        Alert.alert('File too large', 'Please choose an image smaller than 5 MB.');
        return;
      }
      setGuarantorIdUri(asset.uri);
      setGuarantorIdBase64(asset.base64 ?? '');
      setGuarantorIdMime(asset.mimeType ?? 'image/jpeg');
    }
  };

  // ── Submit — all business logic runs on the backend via Supabase RPC ─────────
  const onSubmit = async (data: GuarantorForm) => {
    if (!user?.id || !user.email) {
      Alert.alert('Session', 'You must be signed in to submit KYC.');
      return;
    }
    if (!guarantorIdUri || !guarantorIdBase64) {
      Alert.alert('Document required', "Please upload a photo of the guarantor's ID document.");
      return;
    }

    setSubmitting(true);
    setUploadProgress(0);
    const { error } = await submitKycPackage({
      userId:          user.id,
      authEmail:       user.email,
      draft:           getKycDraftSnapshot(),
      guarantor:       data,
      guarantorBase64: guarantorIdBase64,
      guarantorMime:   guarantorIdMime,
      onProgress:      setUploadProgress,
    });
    setSubmitting(false);

    if (error) {
      Alert.alert(
        'Submission failed',
        'Could not submit your KYC application. Please check your connection and try again.',
      );
      return;
    }

    resetDraft();
    router.replace('/(kyc)/pending');
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={[s.root, { backgroundColor: C.bg }]}>
      <KycProgress currentStep={4} label="Guarantor" />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          {/* ── Hero ────────────────────────────────────────────────────────── */}
          <View style={s.heroRow}>
            <View style={[s.heroIconWrap, { backgroundColor: isDark ? '#1E1B4B' : '#EEF2FF' }]}>
              <User size={34} color="#6366F1" strokeWidth={1.5} />
              <View style={s.heroBadge}>
                <Shield size={11} color="#FFFFFF" strokeWidth={2.5} />
              </View>
            </View>
            <View style={s.heroTextWrap}>
              <Text style={[s.heading, { color: C.text }]}>Guarantor</Text>
              <Text style={[s.subheading, { color: C.textSub }]}>
                A guarantor vouches for you. Their ID will be{'\n'}stored securely like yours.
              </Text>
            </View>
          </View>

          {/* ── Full name ───────────────────────────────────────────────────── */}
          <Field label="Full name" error={errors.guarantorName?.message}>
            <Controller control={control} name="guarantorName"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  style={[s.input, { color: C.text }]}
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                  placeholder="Enter full name"
                  placeholderTextColor="#9CA3AF"
                />
              )}
            />
          </Field>

          {/* ── Phone number ─────────────────────────────────────────────────── */}
          <Field label="Phone number" error={errors.guarantorPhone?.message}>
            <Controller control={control} name="guarantorPhone"
              render={({ field: { onChange, onBlur, value } }) => (
                <View style={s.phoneRow}>
                  <View style={s.phonePrefixWrap}>
                    <Text style={s.phonePrefixFlag}>🇸🇱</Text>
                    <Text style={s.phonePrefixCode}>+232</Text>
                  </View>
                  <TextInput
                    style={[s.input, s.phoneInput, { color: C.text }]}
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value}
                    placeholder="Enter phone number"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="phone-pad"
                  />
                </View>
              )}
            />
          </Field>

          {/* ── Email (optional) ─────────────────────────────────────────────── */}
          <Field label="Email (optional)" error={errors.guarantorEmail?.message}>
            <Controller control={control} name="guarantorEmail"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  style={[s.input, { color: C.text }]}
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value ?? ''}
                  placeholder="Enter email address"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              )}
            />
          </Field>

          {/* ── Address ──────────────────────────────────────────────────────── */}
          <Field label="Address" error={errors.guarantorAddress?.message}>
            <Controller control={control} name="guarantorAddress"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  style={[s.input, { color: C.text }]}
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                  placeholder="Enter full address"
                  placeholderTextColor="#9CA3AF"
                />
              )}
            />
          </Field>

          {/* ── Relationship ─────────────────────────────────────────────────── */}
          <Field label="Relationship" error={errors.relationship?.message}>
            <Controller control={control} name="relationship"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  style={[s.input, { color: C.text }]}
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                  placeholder="e.g. colleague, relative"
                  placeholderTextColor="#9CA3AF"
                />
              )}
            />
          </Field>

          {/* ── ID type picker ───────────────────────────────────────────────── */}
          <View style={s.fieldWrap}>
            <Text style={[s.fieldLabel, { color: C.textSub }]}>Guarantor ID type</Text>
            <TouchableOpacity style={s.pickerRow} onPress={() => setIdTypeModal(true)} activeOpacity={0.7}>
              <Text style={[s.pickerRowText, { color: C.text, flex: 1 }]}>{selectedIdLabel}</Text>
              <ChevronDown size={18} color="#9CA3AF" />
            </TouchableOpacity>
          </View>

          {/* ── ID number ────────────────────────────────────────────────────── */}
          <Field label="Guarantor ID number" error={errors.nationalIdNumber?.message}>
            <Controller control={control} name="nationalIdNumber"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  style={[s.input, { color: C.text }]}
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                  placeholder="Enter ID number"
                  placeholderTextColor="#9CA3AF"
                />
              )}
            />
          </Field>

          {/* ── ID document upload ───────────────────────────────────────────── */}
          <View style={[s.fieldWrap, { marginBottom: 8 }]}>
            <Text style={[s.fieldLabel, { color: C.textSub }]}>Guarantor ID document</Text>
            <TouchableOpacity
              style={[s.uploadWrap, { backgroundColor: C.inputBg, borderColor: C.border }]}
              onPress={pickGuarantorDoc}
              disabled={picking}
              activeOpacity={0.75}
            >
              {picking ? (
                <ActivityIndicator color="#F97316" style={{ paddingVertical: 24 }} />
              ) : guarantorIdUri ? (
                <Image
                  source={{ uri: guarantorIdUri }}
                  style={s.uploadPreview}
                  resizeMode="cover"
                />
              ) : (
                <View style={s.uploadPrompt}>
                  <Upload size={22} color="#9CA3AF" strokeWidth={1.75} />
                  <Text style={[s.uploadLabel, { color: C.text }]}>Upload document</Text>
                  <Text style={[s.uploadHint, { color: C.textMuted }]}>JPG or PNG. Max size 5MB</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* Bottom clearance for sticky button */}
          <View style={{ height: 16 }} />
        </ScrollView>

        {/* ── Sticky Continue ─────────────────────────────────────────────────── */}
        <View style={[s.stickyFooter, { backgroundColor: C.bg, borderTopColor: C.border }]}>
          {submitting && (
            <Text style={s.progressText}>
              {uploadProgress < 85
                ? `Uploading documents… ${uploadProgress}%`
                : 'Submitting application…'}
            </Text>
          )}
          <TouchableOpacity
            style={[s.continueBtn, submitting && { opacity: 0.6 }]}
            disabled={submitting}
            onPress={handleSubmit(onSubmit)}
            activeOpacity={0.85}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={s.continueBtnText}>Submit KYC</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* ── ID type bottom-sheet modal ─────────────────────────────────────────── */}
      <Modal visible={idTypeModal} animationType="slide" transparent onRequestClose={() => setIdTypeModal(false)}>
        <View style={s.modalBackdrop}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setIdTypeModal(false)} />
          <View style={s.sheet}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetHeading}>Guarantor ID type</Text>
            <FlatList
              data={nationalIdTypes as ReadonlyArray<{ readonly value: string; readonly label: string }>}
              keyExtractor={(item) => item.value}
              ItemSeparatorComponent={() => <View style={s.listSep} />}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={s.listRow}
                  onPress={() => {
                    setValue('nationalIdType', item.value as GuarantorForm['nationalIdType'], { shouldValidate: true });
                    setIdTypeModal(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[s.listRowText, { flex: 1 }]}>{item.label}</Text>
                  {nationalIdType === item.value && <Text style={s.checkmark}>✓</Text>}
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={s.sheetCloseRow} onPress={() => setIdTypeModal(false)}>
              <Text style={s.sheetCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Field wrapper component ────────────────────────────────────────────────────

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  const { preferences } = useAppDataStore();
  const C = preferences.darkMode ? darkColors : lightColors;
  return (
    <View style={s.fieldWrap}>
      <Text style={[s.fieldLabel, { color: C.textSub }]}>{label}</Text>
      {children}
      {error ? <Text style={s.fieldError}>{error}</Text> : null}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:          { flex: 1, backgroundColor: '#FFFFFF' },
  scroll:        { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 24 },

  // ── Hero ──────────────────────────────────────────────────────────────────
  heroRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 28,
  },
  heroIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#6366F1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTextWrap: { flex: 1, paddingTop: 4 },
  heading: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  subheading: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 19,
  },

  // ── Field ─────────────────────────────────────────────────────────────────
  fieldWrap:  { marginBottom: 22 },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 8, letterSpacing: 0.2 },
  fieldError: { fontSize: 12, color: '#DC2626', marginTop: 5 },

  // ── Underline input ───────────────────────────────────────────────────────
  input: {
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
    backgroundColor: 'transparent',
  },

  // ── Phone ─────────────────────────────────────────────────────────────────
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  phonePrefixWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 10,
    paddingVertical: 10,
  },
  phonePrefixFlag: { fontSize: 22, marginRight: 4 },
  phonePrefixCode: { fontSize: 15, fontWeight: '700', color: '#111827' },
  phoneInput:      { flex: 1, borderBottomWidth: 0, paddingVertical: 10 },

  // ── Picker row ────────────────────────────────────────────────────────────
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingVertical: 10,
  },
  pickerRowText: { fontSize: 15, color: '#111827' },

  // ── Upload ────────────────────────────────────────────────────────────────
  uploadWrap: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#FAFAFA',
    minHeight: 110,
    justifyContent: 'center',
  },
  uploadPrompt: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 24,
  },
  uploadPreview: {
    width: '100%',
    height: 160,
  },
  uploadLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
  },
  uploadHint: {
    fontSize: 12,
    color: '#9CA3AF',
  },

  // ── Progress hint ─────────────────────────────────────────────────────────
  progressText: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 8,
  },

  // ── Sticky footer ─────────────────────────────────────────────────────────
  stickyFooter: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: Platform.OS === 'ios' ? 8 : 16,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  continueBtn: {
    backgroundColor: '#F97316',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 5,
  },
  continueBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  // ── Modal / sheet ─────────────────────────────────────────────────────────
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 12,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetHeading:   { fontSize: 17, fontWeight: '800', color: '#111827', marginBottom: 14 },
  sheetCloseRow:  { paddingTop: 14, alignItems: 'center', borderTopWidth: 1, borderTopColor: '#F3F4F6', marginTop: 8 },
  sheetCloseText: { fontSize: 15, color: '#6B7280', fontWeight: '600' },

  listRow:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 12 },
  listRowText: { fontSize: 15, color: '#111827', fontWeight: '500' },
  listSep:     { height: 1, backgroundColor: '#F3F4F6' },
  checkmark:   { fontSize: 16, color: '#F97316', fontWeight: '700' },
});
