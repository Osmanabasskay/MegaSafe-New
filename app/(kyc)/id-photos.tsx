import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useKycDraftStore } from '../../src/store/kycDraftStore';
import { KycProgress } from '../../src/components/kyc/KycProgress';
import { Camera, ImageIcon } from 'lucide-react-native';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Carries the three pieces we need from every pick: display URI, upload data, MIME. */
interface PickedFile { uri: string; base64: string; mimeType: string }

async function pickFromLibrary(): Promise<PickedFile | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Permission needed', 'Allow photo library access to upload your ID.');
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    quality: 0.85,
    base64: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, base64: asset.base64 ?? '', mimeType: asset.mimeType ?? 'image/jpeg' };
}

async function pickFromCamera(): Promise<PickedFile | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Permission needed', 'Allow camera access to capture your ID.');
    return null;
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    quality: 0.85,
    base64: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, base64: asset.base64 ?? '', mimeType: asset.mimeType ?? 'image/jpeg' };
}

// ─── ID slot component ────────────────────────────────────────────────────────

function IdSlot({
  label,
  hint,
  uri,
  onSet,
}: {
  label: string;
  hint: string;
  uri: string | null;
  onSet: (picked: PickedFile) => void;
}) {
  const { preferences } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;
  const [busy, setBusy] = useState(false);

  const pick = async (fn: () => Promise<PickedFile | null>) => {
    setBusy(true);
    const next = await fn();
    setBusy(false);
    if (next) onSet(next);
  };

  const handlePress = () =>
    Alert.alert('Add photo', 'Choose a source', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Camera', onPress: () => void pick(pickFromCamera) },
      { text: 'Photo library', onPress: () => void pick(pickFromLibrary) },
    ]);

  return (
    <View style={sl.wrap}>
      <Text style={[sl.label, { color: C.text }]}>{label}</Text>
      <Text style={[sl.hint, { color: C.textMuted }]}>{hint}</Text>
      <TouchableOpacity
        style={[sl.box, { backgroundColor: C.inputBg, borderColor: C.border }]}
        disabled={busy}
        onPress={handlePress}
        activeOpacity={0.75}
      >
        {busy ? (
          <ActivityIndicator color="#F97316" />
        ) : uri ? (
          <Image source={{ uri }} style={sl.preview} resizeMode="cover" />
        ) : (
          <View style={sl.placeholder}>
            <ImageIcon size={30} color={C.textMuted} strokeWidth={1.5} />
            <Text style={[sl.placeholderText, { color: C.textMuted }]}>Tap to add photo</Text>
            <View style={sl.sourceRow}>
              <View style={[sl.sourcePill, { backgroundColor: isDark ? '#431407' : '#FFF7ED' }]}>
                <Camera size={12} color="#F97316" />
                <Text style={sl.sourcePillText}>Camera</Text>
              </View>
              <View style={[sl.sourcePill, { backgroundColor: isDark ? '#431407' : '#FFF7ED' }]}>
                <ImageIcon size={12} color="#F97316" />
                <Text style={sl.sourcePillText}>Library</Text>
              </View>
            </View>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

const sl = StyleSheet.create({
  wrap:  { marginBottom: 28 },
  label: { fontSize: 13, fontWeight: '700', marginBottom: 4, letterSpacing: 0.2 },
  hint:  { fontSize: 12, marginBottom: 10 },
  box: {
    width: '100%',
    height: 170,
    borderRadius: 16,
    borderWidth: 1.5,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  preview:         { width: '100%', height: '100%' },
  placeholder:     { alignItems: 'center', gap: 8 },
  placeholderText: { fontSize: 14, fontWeight: '500' },
  sourceRow:       { flexDirection: 'row', gap: 8, marginTop: 4 },
  sourcePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999,
  },
  sourcePillText: { fontSize: 11, color: '#F97316', fontWeight: '600' },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function IDPhotosScreen() {
  const router      = useRouter();
  const idFrontUri  = useKycDraftStore((s) => s.idFrontUri);
  const idBackUri   = useKycDraftStore((s) => s.idBackUri);
  const setDraft    = useKycDraftStore((s) => s.setDraft);
  const { preferences } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;

  const canContinue = Boolean(idFrontUri && idBackUri);

  return (
    <SafeAreaView style={[s.root, { backgroundColor: C.bg }]}>
      <KycProgress currentStep={1} label="Identity" />

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[s.heading, { color: C.text }]}>National ID</Text>
        <Text style={[s.subheading, { color: C.textSub }]}>
          Upload clear photos of the front and back of your ID. Both sides are required.
        </Text>

        <IdSlot
          label="Front of ID"
          hint="Show your photo, name, and ID number clearly"
          uri={idFrontUri}
          onSet={(p) => setDraft({ idFrontUri: p.uri, idFrontBase64: p.base64, idFrontMime: p.mimeType })}
        />

        <IdSlot
          label="Back of ID"
          hint="Show the back side including any barcode or signature"
          uri={idBackUri}
          onSet={(p) => setDraft({ idBackUri: p.uri, idBackBase64: p.base64, idBackMime: p.mimeType })}
        />

        {/* Bottom spacing for sticky button */}
        <View style={{ height: 16 }} />
      </ScrollView>

      {/* ── Sticky Continue ── */}
      <View style={[s.footer, { backgroundColor: C.bg, borderTopColor: C.border }]}>
        <TouchableOpacity
          style={[s.continueBtn, !canContinue && s.continueBtnDisabled]}
          disabled={!canContinue}
          onPress={() => router.push('/(kyc)/selfie')}
          activeOpacity={0.85}
        >
          <Text style={[s.continueBtnText, !canContinue && s.continueBtnTextDisabled]}>
            Continue
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:    { flex: 1 },
  scroll:  { flex: 1 },
  content: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 24 },

  heading:    { fontSize: 28, fontWeight: '800', marginBottom: 6, letterSpacing: -0.4 },
  subheading: { fontSize: 14, marginBottom: 28, lineHeight: 20 },

  footer: {
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: Platform.OS === 'ios' ? 8 : 16,
    borderTopWidth: 1,
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
  continueBtnDisabled: {
    backgroundColor: '#F3F4F6',
    shadowOpacity: 0,
    elevation: 0,
  },
  continueBtnText:         { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
  continueBtnTextDisabled: { color: '#9CA3AF' },
});
