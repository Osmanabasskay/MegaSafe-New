import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useKycDraftStore } from '../../stores/kycDraftStore';
import { KycProgress } from '../../components/kyc/KycProgress';
import { ImageIcon } from 'lucide-react-native';

async function pickFromLibrary(): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Permission needed', 'Allow photo library access to upload your ID.');
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    quality: 0.85,
  });
  if (result.canceled) return null;
  return result.assets[0].uri;
}

async function pickFromCamera(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Permission needed', 'Allow camera access to capture your ID.');
    return null;
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    quality: 0.85,
  });
  if (result.canceled) return null;
  return result.assets[0].uri;
}

function IdSlot({
  label,
  uri,
  onSet,
}: {
  label: string;
  uri: string | null;
  onSet: (u: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    const next = await fn();
    setBusy(false);
    if (next) onSet(next);
  };

  return (
    <View className="mb-6">
      <Text className="text-sm font-semibold text-gray-700 mb-2">{label}</Text>
      <TouchableOpacity
        className="w-full h-44 bg-gray-100 rounded-xl items-center justify-center bg-gray-50 overflow-hidden"
        disabled={busy}
        onPress={() =>
          Alert.alert('Add photo', 'Choose a source', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Camera', onPress: () => run(pickFromCamera) },
            { text: 'Photo library', onPress: () => run(pickFromLibrary) },
          ])
        }
      >
        {busy ? (
          <ActivityIndicator color="#F97316" />
        ) : uri ? (
          <Image source={{ uri }} className="w-full h-full" resizeMode="cover" />
        ) : (
          <View className="items-center px-4">
            <ImageIcon size={32} color="#9CA3AF" />
            <Text className="text-gray-500 font-medium mt-2 text-center">Tap to add (camera or library)</Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

export default function IDPhotosScreen() {
  const router = useRouter();
  const idFrontUri = useKycDraftStore((s) => s.idFrontUri);
  const idBackUri = useKycDraftStore((s) => s.idBackUri);
  const setDraft = useKycDraftStore((s) => s.setDraft);

  const canContinue = Boolean(idFrontUri && idBackUri);

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KycProgress currentStep={1} label="Identity" />
      <ScrollView className="flex-1 px-6 pt-4" keyboardShouldPersistTaps="handled">
        <Text className="text-3xl font-bold text-primary mb-2">National ID</Text>
        <Text className="text-gray-500 mb-6">
          Upload clear photos of the front and back of your ID, or capture them with the camera.
        </Text>

        <IdSlot label="Front of ID" uri={idFrontUri} onSet={(u) => setDraft({ idFrontUri: u })} />
        <IdSlot label="Back of ID" uri={idBackUri} onSet={(u) => setDraft({ idBackUri: u })} />

        <TouchableOpacity
          className={`p-4 rounded-xl items-center mb-10 ${canContinue ? 'bg-primary' : 'bg-gray-300'}`}
          disabled={!canContinue}
          onPress={() => router.push('/(kyc)/selfie')}
        >
          <Text className="text-white font-bold text-lg">Continue</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

