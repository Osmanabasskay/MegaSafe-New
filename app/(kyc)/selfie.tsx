import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  StyleSheet,
  Platform,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useKycDraftStore } from '../../src/store/kycDraftStore';
import { KycProgress } from '../../src/components/kyc/KycProgress';
import { Camera, RefreshCw, ShieldCheck } from 'lucide-react-native';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';

const { width: SW } = Dimensions.get('window');
const OVAL_SIZE = Math.min(SW * 0.62, 280);

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SelfieScreen() {
  const router     = useRouter();
  const cameraRef  = useRef<InstanceType<typeof CameraView>>(null);
  const setDraft   = useKycDraftStore((s) => s.setDraft);
  const { preferences } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;

  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady,  setCameraReady]  = useState(false);
  const [capturing,     setCapturing]     = useState(false);
  const [previewUri,    setPreviewUri]    = useState<string | null>(null);
  const [previewBase64, setPreviewBase64] = useState<string | null>(null);

  // ── Permission loading ─────────────────────────────────────────────────────
  if (!permission) {
    return <SafeAreaView style={[s.root, { backgroundColor: C.bg }]} />;
  }

  // ── Permission denied ──────────────────────────────────────────────────────
  if (!permission.granted) {
    return (
      <SafeAreaView style={[s.root, { backgroundColor: C.bg }]}>
        <KycProgress currentStep={2} label="Live selfie" />
        <View style={s.permWrap}>
          <View style={[s.permIconWrap, { backgroundColor: isDark ? '#431407' : '#FFF7ED' }]}>
            <Camera size={40} color="#F97316" strokeWidth={1.5} />
          </View>
          <Text style={[s.permTitle, { color: C.text }]}>Camera access needed</Text>
          <Text style={[s.permBody, { color: C.textSub }]}>
            A live selfie is required to verify your identity. Gallery photos are not accepted for this step.
          </Text>
          <TouchableOpacity style={s.permBtn} onPress={requestPermission} activeOpacity={0.85}>
            <Text style={s.permBtnText}>Grant camera access</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Camera handlers ────────────────────────────────────────────────────────
  const takeSelfie = async () => {
    if (!cameraRef.current || !cameraReady || capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85, base64: true });
      if (photo?.uri) {
        setPreviewUri(photo.uri);
        setPreviewBase64(photo.base64 ?? null);
      }
    } catch {
      // silently ignore — user can retry
    } finally {
      setCapturing(false);
    }
  };

  const retake = () => { setPreviewUri(null); setPreviewBase64(null); };

  const confirm = () => {
    if (!previewUri) return;
    setDraft({
      selfieUri:    previewUri,
      selfieBase64: previewBase64, // camera always produces JPEG; upload uses base64 path (no XHR)
      selfieMime:   'image/jpeg',
    });
    router.push('/(kyc)/details');
  };

  // ── Preview / review state ─────────────────────────────────────────────────
  if (previewUri) {
    return (
      <SafeAreaView style={[s.root, { backgroundColor: C.bg }]}>
        <KycProgress currentStep={2} label="Live selfie" />
        <View style={s.reviewContent}>
          <Text style={[s.heading, { color: C.text }]}>Review selfie</Text>
          <Text style={[s.subheading, { color: C.textSub }]}>Make sure your face is fully visible and well-lit.</Text>

          <View style={[s.reviewImageWrap, { backgroundColor: C.iconBg }]}>
            <Image source={{ uri: previewUri }} style={s.reviewImage} resizeMode="contain" />
          </View>

          <View style={s.reviewBtnRow}>
            <TouchableOpacity style={[s.retakeBtn, { backgroundColor: C.iconBg }]} onPress={retake} activeOpacity={0.8}>
              <RefreshCw size={16} color={C.text} strokeWidth={2} />
              <Text style={[s.retakeBtnText, { color: C.text }]}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.usePhoBtn} onPress={confirm} activeOpacity={0.85}>
              <Text style={s.usePhoBtnText}>Use photo</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Live camera view ───────────────────────────────────────────────────────
  return (
    <View style={s.cameraRoot}>
      {/* Progress bar on dark background */}
      <SafeAreaView style={s.cameraTopBar} edges={['top']}>
        <KycProgress currentStep={2} label="Live selfie" />
      </SafeAreaView>

      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="front"
        mirror
        onCameraReady={() => setCameraReady(true)}
      />

      {/* Face guide oval overlay */}
      <View style={s.ovalWrap} pointerEvents="none">
        <View style={s.oval} />
      </View>

      {/* Bottom controls */}
      <SafeAreaView style={s.cameraBottom} edges={['bottom']}>
        <View style={s.instructionCard}>
          <ShieldCheck size={18} color="#F97316" strokeWidth={2} />
          <Text style={s.instructionText}>
            Centre your face inside the oval, then tap the button below.
          </Text>
        </View>

        <TouchableOpacity
          style={[s.captureBtn, (!cameraReady || capturing) && s.captureBtnDisabled]}
          onPress={takeSelfie}
          disabled={!cameraReady || capturing}
          activeOpacity={0.85}
        >
          {capturing ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <View style={s.captureInner} />
          )}
        </TouchableOpacity>

        <Text style={s.captureHint}>
          {cameraReady ? 'Tap to capture' : 'Initialising camera…'}
        </Text>
      </SafeAreaView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  // Shared white root
  root: { flex: 1, backgroundColor: '#FFFFFF' },

  // ── Permission screen ──────────────────────────────────────────────────────
  permWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  permIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  permTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 10,
    textAlign: 'center',
  },
  permBody: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 28,
  },
  permBtn: {
    backgroundColor: '#F97316',
    borderRadius: 14,
    paddingHorizontal: 32,
    paddingVertical: 15,
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 5,
  },
  permBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },

  // ── Review screen ──────────────────────────────────────────────────────────
  reviewContent: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  heading:    { fontSize: 28, fontWeight: '800', color: '#111827', marginBottom: 6, letterSpacing: -0.4 },
  subheading: { fontSize: 14, color: '#6B7280', marginBottom: 20, lineHeight: 20 },
  reviewImageWrap: {
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#F3F4F6',
    marginBottom: 20,
  },
  reviewImage: { width: '100%', height: '100%' },
  reviewBtnRow: {
    flexDirection: 'row',
    gap: 12,
    paddingBottom: Platform.OS === 'ios' ? 8 : 16,
  },
  retakeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 14,
    paddingVertical: 15,
  },
  retakeBtnText: { fontSize: 15, fontWeight: '700', color: '#374151' },
  usePhoBtn: {
    flex: 2,
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
  usePhoBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },

  // ── Camera view ────────────────────────────────────────────────────────────
  cameraRoot:  { flex: 1, backgroundColor: '#000000' },
  cameraTopBar:{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },

  // Oval face guide
  ovalWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  oval: {
    width:  OVAL_SIZE,
    height: OVAL_SIZE * 1.28,
    borderRadius: OVAL_SIZE / 2,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.75)',
  },

  // Bottom controls
  cameraBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingBottom: 20,
    paddingHorizontal: 24,
    gap: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingTop: 16,
  },
  instructionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    width: '100%',
  },
  instructionText: {
    flex: 1,
    fontSize: 13,
    color: '#FFFFFF',
    lineHeight: 18,
  },

  // Shutter button
  captureBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.4)',
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 14,
    elevation: 8,
  },
  captureBtnDisabled: { backgroundColor: '#6B7280', shadowOpacity: 0 },
  captureInner: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  captureHint: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '500',
  },
});
