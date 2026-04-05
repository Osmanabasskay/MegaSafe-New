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
} from 'react-native';
import { useRouter } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '../../stores/authStore';
import { getKycDraftSnapshot, useKycDraftStore } from '../../stores/kycDraftStore';
import { KycProgress } from '../../components/kyc/KycProgress';
import { guarantorSchema, type GuarantorForm, nationalIdTypes } from '../../lib/validation/kyc';
import { submitKycPackage } from '../../lib/profileService';
import { ChevronDown } from 'lucide-react-native';

export default function GuarantorScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const resetDraft = useKycDraftStore((s) => s.reset);

  const [guarantorIdUri, setGuarantorIdUri] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [idTypeModal, setIdTypeModal] = useState(false);

  const {
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<GuarantorForm>({
    resolver: zodResolver(guarantorSchema),
    defaultValues: {
      guarantorName: '',
      guarantorPhone: '',
      guarantorEmail: '',
      guarantorAddress: '',
      relationship: '',
      nationalIdType: 'national_id',
      nationalIdNumber: '',
    },
  });

  const nationalIdType = watch('nationalIdType');
  const selectedIdLabel = nationalIdTypes.find((t) => t.value === nationalIdType)?.label ?? 'Select';

  const pickGuarantorDoc = async () => {
    setPicking(true);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setPicking(false);
      Alert.alert('Permission needed', 'Allow photo library access to upload guarantor ID.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.85,
    });
    setPicking(false);
    if (!result.canceled) setGuarantorIdUri(result.assets[0].uri);
  };

  const onSubmit = async (data: GuarantorForm) => {
    if (!user?.id || !user.email) {
      Alert.alert('Session', 'You must be signed in to submit KYC.');
      return;
    }
    if (!guarantorIdUri) {
      Alert.alert('Document', 'Please upload a photo of your guarantor’s ID.');
      return;
    }

    setSubmitting(true);
    const { error } = await submitKycPackage({
      userId: user.id,
      authEmail: user.email,
      draft: getKycDraftSnapshot(),
      guarantor: data,
      guarantorIdUri,
    });
    setSubmitting(false);

    if (error) {
      Alert.alert('Could not submit', error.message);
      return;
    }

    resetDraft();
    router.replace('/(kyc)/pending');
  };

  return (
    <View className="flex-1 bg-white">
      <KycProgress currentStep={4} label="Guarantor" />
      <ScrollView className="flex-1 px-6 pt-4" keyboardShouldPersistTaps="handled">
        <Text className="text-3xl font-bold text-secondary mb-2">Guarantor</Text>
        <Text className="text-gray-500 mb-6">
          A guarantor vouches for you. Their ID will be stored securely like yours.
        </Text>

        <Field label="Full name" error={errors.guarantorName?.message}>
          <Controller
            control={control}
            name="guarantorName"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                className="border border-gray-300 rounded-lg p-3 text-base"
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                placeholder="Guarantor legal name"
              />
            )}
          />
        </Field>

        <Field label="Phone" error={errors.guarantorPhone?.message}>
          <Controller
            control={control}
            name="guarantorPhone"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                className="border border-gray-300 rounded-lg p-3 text-base"
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                placeholder="+232..."
                keyboardType="phone-pad"
              />
            )}
          />
        </Field>

        <Field label="Email (optional)" error={errors.guarantorEmail?.message}>
          <Controller
            control={control}
            name="guarantorEmail"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                className="border border-gray-300 rounded-lg p-3 text-base"
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                placeholder="name@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
              />
            )}
          />
        </Field>

        <Field label="Address" error={errors.guarantorAddress?.message}>
          <Controller
            control={control}
            name="guarantorAddress"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                className="border border-gray-300 rounded-lg p-3 text-base"
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                placeholder="Full address"
                multiline
              />
            )}
          />
        </Field>

        <Field label="Relationship" error={errors.relationship?.message}>
          <Controller
            control={control}
            name="relationship"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                className="border border-gray-300 rounded-lg p-3 text-base"
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                placeholder="e.g. colleague, relative"
              />
            )}
          />
        </Field>

        <Text className="text-sm font-semibold text-gray-700 mb-2">Guarantor ID type</Text>
        <TouchableOpacity
          className="border border-gray-300 rounded-lg p-3 flex-row justify-between items-center mb-4"
          onPress={() => setIdTypeModal(true)}
        >
          <Text className="text-gray-900">{selectedIdLabel}</Text>
          <ChevronDown size={20} color="#6B7280" />
        </TouchableOpacity>

        <Field label="Guarantor ID number" error={errors.nationalIdNumber?.message}>
          <Controller
            control={control}
            name="nationalIdNumber"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                className="border border-gray-300 rounded-lg p-3 text-base"
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
              />
            )}
          />
        </Field>

        <Text className="text-sm font-semibold text-gray-700 mb-2">Guarantor ID document</Text>
        <TouchableOpacity
          className="border-2 border-dashed border-gray-300 rounded-xl h-40 items-center justify-center bg-gray-50 mb-6"
          onPress={pickGuarantorDoc}
          disabled={picking}
        >
          {picking ? (
            <ActivityIndicator color="#F97316" />
          ) : guarantorIdUri ? (
            <Image source={{ uri: guarantorIdUri }} className="w-full h-full rounded-xl" resizeMode="cover" />
          ) : (
            <Text className="text-gray-500 font-medium">Tap to upload ID photo</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          className="bg-primary p-4 rounded-xl items-center mb-10"
          disabled={submitting}
          onPress={handleSubmit(onSubmit)}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-white font-bold text-lg">Submit KYC</Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={idTypeModal} animationType="fade" transparent>
        <View className="flex-1 justify-center px-6 bg-black/40">
          <View className="bg-white rounded-2xl p-4">
            <Text className="text-lg font-bold mb-3">ID type</Text>
            {nationalIdTypes.map((t) => (
              <TouchableOpacity
                key={t.value}
                className="py-3 border-b border-gray-100"
                onPress={() => {
                  setValue('nationalIdType', t.value, { shouldValidate: true });
                  setIdTypeModal(false);
                }}
              >
                <Text>{t.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity className="mt-4 py-2 items-center" onPress={() => setIdTypeModal(false)}>
              <Text className="text-gray-500 font-semibold">Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="mb-4">
      <Text className="text-sm font-semibold text-gray-700 mb-1">{label}</Text>
      {children}
      {error ? <Text className="text-red-600 text-sm mt-1">{error}</Text> : null}
    </View>
  );
}
