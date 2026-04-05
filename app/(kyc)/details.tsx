import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/authStore';
import { useKycDraftStore } from '../../stores/kycDraftStore';
import { KycProgress } from '../../components/kyc/KycProgress';
import { kycDetailsSchema, nationalIdTypes } from '../../lib/validation/kyc';
import type { z } from 'zod';
import { fetchCountries } from '../../lib/profileService';
import { ChevronDown } from 'lucide-react-native';

export default function KYCDetailsScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const setDraft = useKycDraftStore((s) => s.setDraft);
  const [countryModal, setCountryModal] = useState(false);
  const [idTypeModal, setIdTypeModal] = useState(false);

  const { data: countries = [], isLoading: countriesLoading, error: countriesError } = useQuery({
    queryKey: ['countries'],
    queryFn: async () => {
      const { data, error } = await fetchCountries();
      if (error) throw error;
      return data;
    },
  });

  const defaultValues = useMemo(() => {
    const d = useKycDraftStore.getState();
    const genderOk = d.gender === 'male' || d.gender === 'female' || d.gender === 'other';
    return {
      firstName: d.firstName,
      lastName: d.lastName,
      phone: d.phone,
      dateOfBirth: d.dateOfBirth,
      gender: (genderOk ? d.gender : '') as '' | 'male' | 'female' | 'other',
      addressLine1: d.addressLine1,
      addressLine2: d.addressLine2 ?? '',
      city: d.city,
      stateProvince: d.stateProvince ?? '',
      postalCode: d.postalCode ?? '',
      countryId: d.countryId ?? '',
      nationalIdType: (d.nationalIdType || 'national_id') as
        | 'national_id'
        | 'passport'
        | 'drivers_license'
        | 'voters_card',
      nationalIdNumber: d.nationalIdNumber,
    };
  }, []);

  const {
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(kycDetailsSchema),
    defaultValues,
  });

  const countryId = watch('countryId');
  const nationalIdType = watch('nationalIdType');

  useEffect(() => {
    if (user?.email) {
      setDraft({ email: user.email });
    }
  }, [user?.email, setDraft]);

  const selectedCountry = countries.find((c) => c.id === countryId);
  const selectedIdLabel = nationalIdTypes.find((t) => t.value === nationalIdType)?.label ?? 'Select ID type';

  const onSubmit = (data: z.output<typeof kycDetailsSchema>) => {
    const g = data.gender;
    setDraft({
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
      dateOfBirth: data.dateOfBirth,
      gender: g,
      addressLine1: data.addressLine1,
      addressLine2: data.addressLine2 ?? '',
      city: data.city,
      stateProvince: data.stateProvince ?? '',
      postalCode: data.postalCode ?? '',
      countryId: data.countryId,
      nationalIdType: data.nationalIdType,
      nationalIdNumber: data.nationalIdNumber,
    });
    router.push('/(kyc)/guarantor');
  };

  return (
    <View className="flex-1 bg-white">
      <KycProgress currentStep={3} label="Address & ID details" />
      <ScrollView className="flex-1 px-6 pt-4" keyboardShouldPersistTaps="handled">
        <Text className="text-3xl font-bold text-primary mb-2">Your details</Text>
        <Text className="text-gray-500 mb-6">
          Must match your ID. Use YYYY-MM-DD for date of birth.
        </Text>

        {countriesError ? (
          <Text className="text-red-600 mb-4">
            Could not load countries. Seed the `countries` table in Supabase (see build guide).
          </Text>
        ) : null}

        <Field label="First name" error={errors.firstName?.message}>
          <Controller
            control={control}
            name="firstName"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                className="border border-gray-300 rounded-lg p-3 text-base"
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                placeholder="First name"
              />
            )}
          />
        </Field>

        <Field label="Last name" error={errors.lastName?.message}>
          <Controller
            control={control}
            name="lastName"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                className="border border-gray-300 rounded-lg p-3 text-base"
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                placeholder="Last name"
              />
            )}
          />
        </Field>

        <Field label="Phone" error={errors.phone?.message}>
          <Controller
            control={control}
            name="phone"
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

        <Field label="Date of birth (YYYY-MM-DD)" error={errors.dateOfBirth?.message}>
          <Controller
            control={control}
            name="dateOfBirth"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                className="border border-gray-300 rounded-lg p-3 text-base"
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                placeholder="1990-01-15"
              />
            )}
          />
        </Field>

        <Text className="text-sm font-semibold text-gray-700 mb-2">Gender</Text>
        <Controller
          control={control}
          name="gender"
          render={({ field: { onChange, value } }) => (
            <View className="flex-row gap-2 mb-4">
              {(['male', 'female', 'other'] as const).map((g) => (
                <TouchableOpacity
                  key={g}
                  onPress={() => onChange(g)}
                  className={`flex-1 py-3 rounded-xl border ${
                    value === g ? 'bg-primary border-primary' : 'border-gray-300 bg-white'
                  }`}
                >
                  <Text
                    className={`text-center font-semibold capitalize ${
                      value === g ? 'text-white' : 'text-gray-700'
                    }`}
                  >
                    {g}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        />
        {errors.gender ? <Text className="text-red-600 text-sm mb-4">{errors.gender.message}</Text> : null}

        <Field label="Address line 1" error={errors.addressLine1?.message}>
          <Controller
            control={control}
            name="addressLine1"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                className="border border-gray-300 rounded-lg p-3 text-base"
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                placeholder="Street, house number"
              />
            )}
          />
        </Field>

        <Field label="Address line 2 (optional)" error={errors.addressLine2?.message}>
          <Controller
            control={control}
            name="addressLine2"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                className="border border-gray-300 rounded-lg p-3 text-base"
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                placeholder="Apartment, suite"
              />
            )}
          />
        </Field>

        <Field label="City" error={errors.city?.message}>
          <Controller
            control={control}
            name="city"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                className="border border-gray-300 rounded-lg p-3 text-base"
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                placeholder="City"
              />
            )}
          />
        </Field>

        <Field label="State / province (optional)" error={errors.stateProvince?.message}>
          <Controller
            control={control}
            name="stateProvince"
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

        <Field label="Postal code (optional)" error={errors.postalCode?.message}>
          <Controller
            control={control}
            name="postalCode"
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

        <Text className="text-sm font-semibold text-gray-700 mb-2">Country</Text>
        <TouchableOpacity
          className="border border-gray-300 rounded-lg p-3 flex-row justify-between items-center mb-1"
          onPress={() => setCountryModal(true)}
        >
          <Text className={selectedCountry ? 'text-gray-900' : 'text-gray-400'}>
            {selectedCountry ? selectedCountry.name : countriesLoading ? 'Loading…' : 'Select country'}
          </Text>
          <ChevronDown size={20} color="#6B7280" />
        </TouchableOpacity>
        {errors.countryId ? (
          <Text className="text-red-600 text-sm mb-4">{errors.countryId.message}</Text>
        ) : (
          <View className="mb-4" />
        )}

        <Text className="text-sm font-semibold text-gray-700 mb-2">ID document type</Text>
        <TouchableOpacity
          className="border border-gray-300 rounded-lg p-3 flex-row justify-between items-center mb-1"
          onPress={() => setIdTypeModal(true)}
        >
          <Text className="text-gray-900">{selectedIdLabel}</Text>
          <ChevronDown size={20} color="#6B7280" />
        </TouchableOpacity>

        <Field label="ID number" error={errors.nationalIdNumber?.message}>
          <Controller
            control={control}
            name="nationalIdNumber"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                className="border border-gray-300 rounded-lg p-3 text-base"
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                placeholder="As shown on document"
              />
            )}
          />
        </Field>

        <TouchableOpacity
          className="bg-primary p-4 rounded-xl items-center mt-4 mb-10"
          onPress={handleSubmit(onSubmit)}
        >
          <Text className="text-white font-bold text-lg">Continue</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={countryModal} animationType="slide" transparent>
        <View className="flex-1 justify-end bg-black/40">
          <View className="bg-white rounded-t-3xl max-h-[70%] p-4">
            <Text className="text-lg font-bold mb-3">Select country</Text>
            {countriesLoading ? (
              <ActivityIndicator />
            ) : (
              <FlatList
                data={countries}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    className="py-3 border-b border-gray-100"
                    onPress={() => {
                      setValue('countryId', item.id, { shouldValidate: true });
                      setCountryModal(false);
                    }}
                  >
                    <Text className="text-base">{item.name}</Text>
                  </TouchableOpacity>
                )}
              />
            )}
            <TouchableOpacity className="mt-4 py-3 items-center" onPress={() => setCountryModal(false)}>
              <Text className="text-secondary font-bold">Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
