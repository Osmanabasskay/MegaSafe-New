import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useKycDraftStore } from '../../stores/kycDraftStore';
import { KycProgress } from '../../components/kyc/KycProgress';

export default function SelfieScreen() {
  const router = useRouter();
  const cameraRef = useRef<InstanceType<typeof CameraView>>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const setDraft = useKycDraftStore((s) => s.setDraft);

  if (!permission) {
    return <View className="flex-1 bg-white" />;
  }

  if (!permission.granted) {
    return (
      <View className="flex-1 items-center justify-center bg-white p-6">
        <Text className="text-xl text-center mb-6 text-gray-800">
          Camera access is required for a live selfie (gallery is not allowed for this step).
        </Text>
        <TouchableOpacity className="bg-primary px-6 py-3 rounded-xl" onPress={requestPermission}>
          <Text className="text-white font-bold">Grant permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const takeSelfie = async () => {
    if (!cameraRef.current || !cameraReady || capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      if (photo?.uri) setPreviewUri(photo.uri);
    } catch {
      // handled below
    } finally {
      setCapturing(false);
    }
  };

  const retake = () => setPreviewUri(null);

  const confirm = () => {
    if (!previewUri) return;
    setDraft({ selfieUri: previewUri });
    router.push('/(kyc)/details');
  };

  if (previewUri) {
    return (
      <View className="flex-1 bg-white">
        <KycProgress currentStep={2} label="Live selfie" />
        <View className="flex-1 px-6 pt-4">
          <Text className="text-2xl font-bold text-primary mb-2">Review selfie</Text>
          <Text className="text-gray-500 mb-4">Make sure your face is clearly visible.</Text>
          <Image source={{ uri: previewUri }} className="flex-1 rounded-2xl bg-gray-100" resizeMode="contain" />
          <View className="flex-row gap-3 py-6">
            <TouchableOpacity className="flex-1 border border-gray-300 py-4 rounded-xl items-center" onPress={retake}>
              <Text className="font-bold text-gray-700">Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity className="flex-1 bg-primary py-4 rounded-xl items-center" onPress={confirm}>
              <Text className="font-bold text-white">Use photo</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black">
      <KycProgress currentStep={2} label="Live selfie" />
      <CameraView
        ref={cameraRef}
        style={{ flex: 1 }}
        facing="front"
        mirror
        onCameraReady={() => setCameraReady(true)}
      />
      <View className="absolute bottom-0 left-0 right-0 pb-10 pt-4 px-6 bg-black/60">
        <Text className="text-white text-center mb-4 text-sm">
          Position your face in the frame, then capture. This step uses the camera only.
        </Text>
        <TouchableOpacity
          className="self-center bg-secondary w-20 h-20 rounded-full items-center justify-center border-4 border-white"
          onPress={takeSelfie}
          disabled={!cameraReady || capturing}
        >
          {capturing ? <ActivityIndicator color="#fff" /> : <View className="w-14 h-14 rounded-full bg-white/30" />}
        </TouchableOpacity>
      </View>
    </View>
  );
}
