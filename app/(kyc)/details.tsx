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
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/store/authStore';
import { useKycDraftStore } from '../../src/store/kycDraftStore';
import { KycProgress } from '../../src/components/kyc/KycProgress';
import { kycDetailsSchema, nationalIdTypes } from '../../src/utils/validation/kyc';
import type { z } from 'zod';
import { fetchCountries, fetchCountryRegions } from '../../src/services/profileService';
import type { CountryRegionCity } from '../../src/services/profileService';
import { Calendar, ChevronDown, User } from 'lucide-react-native';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';

// ── Helpers ────────────────────────────────────────────────────────────────────

const formatDob = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const displayDob = (iso: string): string => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[Number(m) - 1]} ${y}`;
};

const countryCodeToFlag = (code: string): string =>
  code.toUpperCase().split('').map((c) => String.fromCodePoint(c.charCodeAt(0) + 0x1f1a5)).join('');

// ── Screen ─────────────────────────────────────────────────────────────────────

export default function KYCDetailsScreen() {
  const router = useRouter();
  const user   = useAuthStore((s) => s.user);
  const setDraft = useKycDraftStore((s) => s.setDraft);
  const { preferences } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;

  const [countryModal, setCountryModal]   = useState(false);
  const [idTypeModal, setIdTypeModal]     = useState(false);
  const [cityModal, setCityModal]         = useState(false);
  const [provinceModal, setProvinceModal] = useState(false);
  const [showDobPicker, setShowDobPicker] = useState(false);
  const [iosDobModal, setIosDobModal]     = useState(false);

  const [dobPickerDate, setDobPickerDate] = useState<Date>(() => {
    const d = useKycDraftStore.getState();
    if (d.dateOfBirth) {
      const parts = d.dateOfBirth.split('-').map(Number);
      if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
        const dt = new Date(parts[0], parts[1] - 1, parts[2]);
        if (!isNaN(dt.getTime())) return dt;
      }
    }
    return new Date(1990, 0, 1);
  });

  const maxDob = useMemo(() => { const d = new Date(); d.setFullYear(d.getFullYear() - 18); return d; }, []);
  const minDob = useMemo(() => { const d = new Date(); d.setFullYear(d.getFullYear() - 100); return d; }, []);

  // ── Remote data ─────────────────────────────────────────────────────────────

  const { data: countriesResult, isLoading: countriesLoading, error: countriesError } = useQuery({
    queryKey: ['countries'],
    queryFn: async () => {
      const { data, defaultId, error } = await fetchCountries();
      if (error) throw error;
      return { countries: data, defaultId };
    },
    staleTime: 10 * 60 * 1000,
  });

  const countries       = countriesResult?.countries ?? [];
  const defaultCountryId = countriesResult?.defaultId ?? null;

  // ── Form ────────────────────────────────────────────────────────────────────

  const defaultValues = useMemo(() => {
    const d = useKycDraftStore.getState();
    const genderOk = d.gender === 'male' || d.gender === 'female' || d.gender === 'other';
    return {
      firstName:        d.firstName,
      lastName:         d.lastName,
      phone:            d.phone,
      dateOfBirth:      d.dateOfBirth,
      gender:           (genderOk ? d.gender : '') as '' | 'male' | 'female' | 'other',
      addressLine1:     d.addressLine1,
      addressLine2:     d.addressLine2 ?? '',
      city:             d.city,
      stateProvince:    d.stateProvince ?? '',
      postalCode:       d.postalCode ?? '',
      countryId:        d.countryId ?? '',
      nationalIdType:   (d.nationalIdType || 'national_id') as
        'national_id' | 'passport' | 'drivers_license' | 'voters_card',
      nationalIdNumber: d.nationalIdNumber,
    };
  }, []);

  const { control, handleSubmit, setValue, watch, formState: { errors } } = useForm({
    resolver: zodResolver(kycDetailsSchema),
    defaultValues,
  });

  const countryId      = watch('countryId');
  const nationalIdType = watch('nationalIdType');
  const dobValue       = watch('dateOfBirth');
  const cityValue      = watch('city');
  const provinceValue  = watch('stateProvince');

  const selectedCountry = countries.find((c) => c.id === countryId);
  const isSierraLeone   = selectedCountry?.code === 'SL';
  const selectedIdLabel = nationalIdTypes.find((t) => t.value === nationalIdType)?.label ?? 'Select ID type';

  const { data: regionsData, isLoading: regionsLoading } = useQuery({
    queryKey: ['country-regions', countryId],
    queryFn: async () => {
      const { cities, provinces, error } = await fetchCountryRegions(countryId);
      if (error) throw error;
      return { cities, provinces };
    },
    enabled: isSierraLeone && !!countryId,
    staleTime: 30 * 60 * 1000,
  });

  const slCities    = regionsData?.cities    ?? [];
  const slProvinces = regionsData?.provinces ?? [];

  // ── Effects ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (user?.email) setDraft({ email: user.email });
  }, [user?.email, setDraft]);

  useEffect(() => {
    if (defaultCountryId && !countryId) {
      setValue('countryId', defaultCountryId, { shouldValidate: false });
    }
  }, [defaultCountryId, countryId, setValue]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const openDobPicker = () => {
    if (Platform.OS === 'ios') setIosDobModal(true);
    else setShowDobPicker(true);
  };

  const onDobChange = (_event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setShowDobPicker(false);
    if (date) {
      setDobPickerDate(date);
      setValue('dateOfBirth', formatDob(date), { shouldValidate: true });
    }
  };

  const handleCitySelect = (city: CountryRegionCity) => {
    setValue('city', city.name, { shouldValidate: true });
    if (city.province_name) setValue('stateProvince', city.province_name, { shouldValidate: false });
    setCityModal(false);
  };

  const onSubmit = (data: z.output<typeof kycDetailsSchema>) => {
    setDraft({
      firstName: data.firstName, lastName: data.lastName,
      phone: data.phone, dateOfBirth: data.dateOfBirth,
      gender: data.gender, addressLine1: data.addressLine1,
      addressLine2: data.addressLine2 ?? '', city: data.city,
      stateProvince: data.stateProvince ?? '', postalCode: data.postalCode ?? '',
      countryId: data.countryId, nationalIdType: data.nationalIdType,
      nationalIdNumber: data.nationalIdNumber,
    });
    router.push('/(kyc)/guarantor');
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={[s.root, { backgroundColor: C.bg }]}>
      <KycProgress currentStep={3} label="Address & ID details" />

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
        <Text style={[s.heading, { color: C.text }]}>Your details</Text>
        <Text style={[s.subheading, { color: C.textSub }]}>Must match your ID exactly.</Text>

        {countriesError && !countriesLoading ? (
          <View style={s.errorBanner}>
            <Text style={s.errorBannerText}>
              Could not load the country list. Please check your connection and try again.
            </Text>
          </View>
        ) : null}

        {/* ── First name ── */}
        <Field label="First name" error={errors.firstName?.message}>
          <Controller control={control} name="firstName"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput style={[s.input, { color: C.text }]} onBlur={onBlur} onChangeText={onChange}
                value={value} placeholder="Enter your first name" placeholderTextColor="#9CA3AF" />
            )}
          />
        </Field>

        {/* ── Last name ── */}
        <Field label="Last name" error={errors.lastName?.message}>
          <Controller control={control} name="lastName"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput style={[s.input, { color: C.text }]} onBlur={onBlur} onChangeText={onChange}
                value={value} placeholder="Enter your last name" placeholderTextColor="#9CA3AF" />
            )}
          />
        </Field>

        {/* ── Phone number ── */}
        <Field label="Phone number" error={errors.phone?.message}>
          <Controller control={control} name="phone"
            render={({ field: { onChange, onBlur, value } }) => (
              <View style={s.phoneRow}>
                {isSierraLeone || !selectedCountry ? (
                  <View style={s.phonePrefixWrap}>
                    <Text style={s.phonePrefixFlag}>🇸🇱</Text>
                    <Text style={[s.phonePrefixCode, { color: C.text }]}>+232</Text>
                  </View>
                ) : (
                  <View style={s.phonePrefixWrap}>
                    <Text style={s.phonePrefixFlag}>{countryCodeToFlag(selectedCountry.code)}</Text>
                  </View>
                )}
                <TextInput
                  style={[s.input, s.phoneInput, { color: C.text }]}
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                  placeholder="Enter your phone number"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="phone-pad"
                />
              </View>
            )}
          />
        </Field>

        {/* ── Date of birth — calendar picker ── */}
        <Field label="Date of birth" error={errors.dateOfBirth?.message}>
          <TouchableOpacity style={s.pickerRow} onPress={openDobPicker} activeOpacity={0.7}>
            <Text style={[s.pickerRowText, { color: C.text }, !dobValue && s.pickerRowPlaceholder]}>
              {dobValue ? displayDob(dobValue) : 'YYYY-MM-DD'}
            </Text>
            <Calendar size={20} color="#9CA3AF" />
          </TouchableOpacity>
          {Platform.OS === 'android' && showDobPicker && (
            <DateTimePicker
              value={dobPickerDate} mode="date" display="default"
              onChange={onDobChange} maximumDate={maxDob} minimumDate={minDob}
            />
          )}
        </Field>

        {/* ── Gender ── */}
        <View style={s.fieldWrap}>
          <Text style={[s.fieldLabel, { color: C.textSub }]}>Gender</Text>
          <Controller control={control} name="gender"
            render={({ field: { onChange, value } }) => (
              <View style={s.genderRow}>
                {(['male', 'female', 'other'] as const).map((g) => {
                  const active = value === g;
                  return (
                    <TouchableOpacity
                      key={g}
                      onPress={() => onChange(g)}
                      style={[s.genderBtn, { backgroundColor: active ? '#F97316' : C.inputBg, borderColor: active ? '#F97316' : C.border }, active && s.genderBtnActive]}
                      activeOpacity={0.8}
                    >
                      <User size={14} color={active ? '#FFFFFF' : C.textMuted} strokeWidth={2} />
                      <Text style={[s.genderBtnText, { color: active ? '#FFFFFF' : C.textSub }, active && s.genderBtnTextActive]}>
                        {g.charAt(0).toUpperCase() + g.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          />
          {errors.gender ? <Text style={s.fieldError}>{errors.gender.message}</Text> : null}
        </View>

        {/* ── Address line 1 ── */}
        <Field label="Address line 1" error={errors.addressLine1?.message}>
          <Controller control={control} name="addressLine1"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput style={[s.input, { color: C.text }]} onBlur={onBlur} onChangeText={onChange}
                value={value} placeholder="Street, house number" placeholderTextColor="#9CA3AF" />
            )}
          />
        </Field>

        {/* ── Address line 2 ── */}
        <Field label="Address line 2 (optional)" error={errors.addressLine2?.message}>
          <Controller control={control} name="addressLine2"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput style={[s.input, { color: C.text }]} onBlur={onBlur} onChangeText={onChange}
                value={value} placeholder="Apartment, suite, etc." placeholderTextColor="#9CA3AF" />
            )}
          />
        </Field>

        {/* ── Country ── */}
        <View style={s.fieldWrap}>
          <Text style={[s.fieldLabel, { color: C.textSub }]}>Country</Text>
          <TouchableOpacity style={s.pickerRow} onPress={() => setCountryModal(true)}>
            {selectedCountry ? (
              <View style={s.pickerRowInner}>
                <Text style={{ fontSize: 22 }}>{countryCodeToFlag(selectedCountry.code)}</Text>
                <Text style={[s.pickerRowText, { color: C.text, marginLeft: 8, flex: 1 }]}>{selectedCountry.name}</Text>
              </View>
            ) : (
              <Text style={[s.pickerRowText, s.pickerRowPlaceholder, { flex: 1 }]}>
                {countriesLoading ? 'Loading…' : 'Select country'}
              </Text>

            )}
            <ChevronDown size={18} color="#9CA3AF" />
          </TouchableOpacity>
          {errors.countryId ? <Text style={s.fieldError}>{errors.countryId.message}</Text> : null}
        </View>

        {/* ── City ── */}
        {isSierraLeone ? (
          <View style={s.fieldWrap}>
            <Text style={[s.fieldLabel, { color: C.textSub }]}>City / Town</Text>
            <TouchableOpacity style={s.pickerRow} onPress={() => setCityModal(true)}>
              <Text style={[s.pickerRowText, { color: C.text }, !cityValue && s.pickerRowPlaceholder, { flex: 1 }]}>
                {regionsLoading ? 'Loading cities…' : cityValue || 'Select city or town'}
              </Text>
              <ChevronDown size={18} color="#9CA3AF" />
            </TouchableOpacity>
            {errors.city ? <Text style={s.fieldError}>{errors.city.message}</Text> : null}
          </View>
        ) : (
          <Field label="City" error={errors.city?.message}>
            <Controller control={control} name="city"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput style={[s.input, { color: C.text }]} onBlur={onBlur} onChangeText={onChange}
                  value={value} placeholder="Enter your city" placeholderTextColor="#9CA3AF" />
              )}
            />
          </Field>
        )}

        {/* ── Province / State ── */}
        {isSierraLeone ? (
          <View style={s.fieldWrap}>
            <Text style={[s.fieldLabel, { color: C.textSub }]}>Province</Text>
            <TouchableOpacity style={s.pickerRow} onPress={() => setProvinceModal(true)}>
              <Text style={[s.pickerRowText, { color: C.text }, !provinceValue && s.pickerRowPlaceholder, { flex: 1 }]}>
                {provinceValue || 'Select province'}
              </Text>
              <ChevronDown size={18} color="#9CA3AF" />
            </TouchableOpacity>
            {errors.stateProvince ? <Text style={s.fieldError}>{errors.stateProvince.message}</Text> : null}
          </View>
        ) : (
          <Field label="State / province (optional)" error={errors.stateProvince?.message}>
            <Controller control={control} name="stateProvince"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput style={[s.input, { color: C.text }]} onBlur={onBlur} onChangeText={onChange}
                  value={value} placeholder="State or province" placeholderTextColor="#9CA3AF" />
              )}
            />
          </Field>
        )}

        {/* ── Postal code ── */}
        <Field label="Postal code (optional)" error={errors.postalCode?.message}>
          <Controller control={control} name="postalCode"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput style={[s.input, { color: C.text }]} onBlur={onBlur} onChangeText={onChange}
                value={value} placeholder="Postal code" placeholderTextColor="#9CA3AF"
                keyboardType="number-pad" />
            )}
          />
        </Field>

        {/* ── ID document type ── */}
        <View style={s.fieldWrap}>
          <Text style={[s.fieldLabel, { color: C.textSub }]}>ID document type</Text>
          <TouchableOpacity style={s.pickerRow} onPress={() => setIdTypeModal(true)}>
            <Text style={[s.pickerRowText, { color: C.text, flex: 1 }]}>{selectedIdLabel}</Text>
            <ChevronDown size={18} color="#9CA3AF" />
          </TouchableOpacity>
        </View>

        {/* ── ID number ── */}
        <Field label="ID number" error={errors.nationalIdNumber?.message}>
          <Controller control={control} name="nationalIdNumber"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput style={[s.input, { color: C.text }]} onBlur={onBlur} onChangeText={onChange}
                value={value} placeholder="As shown on document" placeholderTextColor="#9CA3AF" />
            )}
          />
        </Field>

        {/* Bottom spacing so content clears the sticky button */}
        <View style={{ height: 16 }} />
      </ScrollView>

      {/* ── Sticky Continue button ── */}
      <View style={[s.stickyFooter, { backgroundColor: C.bg, borderTopColor: C.border }]}>
        <TouchableOpacity style={s.continueBtn} onPress={handleSubmit(onSubmit)} activeOpacity={0.85}>
          <Text style={s.continueBtnText}>Continue</Text>
        </TouchableOpacity>
      </View>
      </KeyboardAvoidingView>

      {/* ─────────────────── MODALS ─────────────────────────── */}

      {/* iOS DOB picker */}
      {Platform.OS === 'ios' && (
        <Modal visible={iosDobModal} transparent animationType="slide" onRequestClose={() => setIosDobModal(false)}>
          <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={() => setIosDobModal(false)} />
          <View style={s.sheet}>
            <View style={s.sheetHeader}>
              <TouchableOpacity onPress={() => setIosDobModal(false)}>
                <Text style={s.sheetCancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={s.sheetTitle}>Date of Birth</Text>
              <TouchableOpacity onPress={() => {
                setValue('dateOfBirth', formatDob(dobPickerDate), { shouldValidate: true });
                setIosDobModal(false);
              }}>
                <Text style={s.sheetDone}>Done</Text>
              </TouchableOpacity>
            </View>
            <DateTimePicker
              value={dobPickerDate} mode="date" display="spinner"
              onChange={(_e, d) => { if (d) setDobPickerDate(d); }}
              maximumDate={maxDob} minimumDate={minDob} style={{ height: 220 }}
            />
          </View>
        </Modal>
      )}

      {/* Country picker */}
      <Modal visible={countryModal} animationType="slide" transparent>
        <View style={s.modalBackdrop}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setCountryModal(false)} />
          <View style={[s.sheet, { maxHeight: '72%' }]}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetHeading}>Select country</Text>
            <Text style={s.sheetSubheading}>English-speaking African countries</Text>
            {countriesLoading ? (
              <ActivityIndicator color="#F97316" style={{ marginTop: 20 }} />
            ) : (
              <FlatList
                data={countries}
                keyExtractor={(item) => item.id}
                ItemSeparatorComponent={() => <View style={s.listSep} />}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={s.listRow}
                    onPress={() => {
                      setValue('countryId', item.id, { shouldValidate: true });
                      setValue('city', '', { shouldValidate: false });
                      setValue('stateProvince', '', { shouldValidate: false });
                      setCountryModal(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={{ fontSize: 26 }}>{countryCodeToFlag(item.code)}</Text>
                    <Text style={s.listRowText}>{item.name}</Text>
                    {item.is_default && <Text style={s.listRowBadge}>Default</Text>}
                  </TouchableOpacity>
                )}
              />
            )}
            <TouchableOpacity style={s.sheetCloseRow} onPress={() => setCountryModal(false)}>
              <Text style={s.sheetCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ID type picker */}
      <Modal visible={idTypeModal} animationType="fade" transparent>
        <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={() => setIdTypeModal(false)}>
          <View style={s.centreCard}>
            <Text style={s.sheetHeading}>ID type</Text>
            {nationalIdTypes.map((t) => (
              <TouchableOpacity
                key={t.value}
                style={s.listRow}
                onPress={() => { setValue('nationalIdType', t.value, { shouldValidate: true }); setIdTypeModal(false); }}
              >
                <Text style={s.listRowText}>{t.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={s.sheetCloseRow} onPress={() => setIdTypeModal(false)}>
              <Text style={s.sheetCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* SL city picker */}
      <Modal visible={cityModal} animationType="slide" transparent>
        <View style={s.modalBackdrop}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setCityModal(false)} />
          <View style={[s.sheet, { maxHeight: '75%' }]}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetHeading}>Select city or town</Text>
            <Text style={s.sheetSubheading}>Selecting a city auto-fills the province</Text>
            {regionsLoading ? (
              <ActivityIndicator color="#F97316" style={{ marginTop: 20 }} />
            ) : (
              <FlatList
                data={slCities}
                keyExtractor={(item) => item.id}
                ItemSeparatorComponent={() => <View style={s.listSep} />}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={s.listRow}
                    onPress={() => handleCitySelect(item)}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.listRowText, { flex: 1 }]}>{item.name}</Text>
                    {item.province_name ? (
                      <Text style={s.listRowMeta}>{item.province_name}</Text>
                    ) : null}
                  </TouchableOpacity>
                )}
              />
            )}
            <TouchableOpacity style={s.sheetCloseRow} onPress={() => setCityModal(false)}>
              <Text style={s.sheetCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* SL province picker */}
      <Modal visible={provinceModal} animationType="slide" transparent>
        <View style={s.modalBackdrop}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setProvinceModal(false)} />
          <View style={s.sheet}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetHeading}>Select province</Text>
            {slProvinces.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={s.listRow}
                onPress={() => { setValue('stateProvince', p.name, { shouldValidate: true }); setProvinceModal(false); }}
                activeOpacity={0.7}
              >
                <Text style={[s.listRowText, { flex: 1 }]}>{p.name}</Text>
                {provinceValue === p.name && <Text style={s.checkmark}>✓</Text>}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={s.sheetCloseRow} onPress={() => setProvinceModal(false)}>
              <Text style={s.sheetCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Field wrapper ──────────────────────────────────────────────────────────────

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

// ── Styles ─────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: '#FFFFFF' },
  scroll:      { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 24 },

  heading:    { fontSize: 28, fontWeight: '800', color: '#111827', marginBottom: 4 },
  subheading: { fontSize: 14, color: '#6B7280', marginBottom: 24, lineHeight: 20 },

  errorBanner:     { backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12, marginBottom: 16 },
  errorBannerText: { color: '#DC2626', fontSize: 13, lineHeight: 18 },

  // Field
  fieldWrap:  { marginBottom: 22 },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 8, letterSpacing: 0.2 },
  fieldError: { fontSize: 12, color: '#DC2626', marginTop: 5 },

  // Underline text input
  input: {
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
    backgroundColor: 'transparent',
  },

  // Picker row (country, city, id type, etc.)
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingVertical: 10,
  },
  pickerRowInner:       { flexDirection: 'row', alignItems: 'center', flex: 1 },
  pickerRowText:        { fontSize: 15, color: '#111827' },
  pickerRowPlaceholder: { color: '#9CA3AF' },

  // Phone field
  phoneRow:       { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  phonePrefixWrap:{ flexDirection: 'row', alignItems: 'center', paddingRight: 10, paddingVertical: 10 },
  phonePrefixFlag:{ fontSize: 22, marginRight: 4 },
  phonePrefixCode:{ fontSize: 15, fontWeight: '700', color: '#111827' },
  phoneInput:     { flex: 1, borderBottomWidth: 0, paddingVertical: 10 },

  // Gender
  genderRow:          { flexDirection: 'row', gap: 10 },
  genderBtn:          {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1.5, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF',
  },
  genderBtnActive:    { backgroundColor: '#F97316', borderColor: '#F97316' },
  genderBtnText:      { fontSize: 14, fontWeight: '600', color: '#6B7280', textTransform: 'capitalize' },
  genderBtnTextActive:{ color: '#FFFFFF' },

  // Sticky Continue button
  stickyFooter:   {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: Platform.OS === 'ios' ? 8 : 16,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  continueBtn:    { backgroundColor: '#F97316', borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  continueBtnText:{ color: '#FFFFFF', fontSize: 16, fontWeight: '800' },

  // Modals
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: 32, paddingTop: 12,
  },
  sheetHandle:    { width: 40, height: 4, backgroundColor: '#E5E7EB', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  sheetHeading:   { fontSize: 17, fontWeight: '800', color: '#111827', marginBottom: 4 },
  sheetSubheading:{ fontSize: 12, color: '#9CA3AF', marginBottom: 14 },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  sheetTitle:     { fontSize: 16, fontWeight: '700', color: '#1E2B5A' },
  sheetCancel:    { fontSize: 15, color: '#6B7280', fontWeight: '600' },
  sheetDone:      { fontSize: 15, color: '#F97316', fontWeight: '700' },
  sheetCloseRow:  { paddingTop: 14, alignItems: 'center', borderTopWidth: 1, borderTopColor: '#F3F4F6', marginTop: 8 },
  sheetCloseText: { fontSize: 15, color: '#6B7280', fontWeight: '600' },

  centreCard: {
    backgroundColor: '#FFFFFF', marginHorizontal: 24,
    borderRadius: 20, padding: 20,
    position: 'absolute', bottom: '30%', left: 0, right: 0,
  },

  listRow:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 12 },
  listRowText: { fontSize: 15, color: '#111827', fontWeight: '500' },
  listRowBadge:{ fontSize: 11, color: '#F97316', fontWeight: '700' },
  listRowMeta: { fontSize: 12, color: '#9CA3AF', marginLeft: 8 },
  listSep:     { height: 1, backgroundColor: '#F3F4F6' },

  checkmark:   { fontSize: 16, color: '#F97316', fontWeight: '700' },
});
