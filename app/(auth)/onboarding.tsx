import React, { useMemo, useState } from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Check, Shield } from 'lucide-react-native';
import { useComplianceStore } from '../../stores/complianceStore';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function OnboardingScreen() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const termsAcceptedAt = useComplianceStore((state) => state.termsAcceptedAt);
  const privacyAcceptedAt = useComplianceStore((state) => state.privacyAcceptedAt);
  const acceptTerms = useComplianceStore((state) => state.acceptTerms);
  const acceptPrivacy = useComplianceStore((state) => state.acceptPrivacy);
  const [acceptTermsNow, setAcceptTermsNow] = useState(Boolean(termsAcceptedAt));
  const [acceptPrivacyNow, setAcceptPrivacyNow] = useState(Boolean(privacyAcceptedAt));

  const stepsInfo = useMemo(
    () => [
      { title: 'Welcome to MegaSafe', desc: 'Your secure digital Osusu platform.' },
      { title: 'Save Together', desc: 'Join groups and contribute via trusted payment channels.' },
      { title: 'Grow Together', desc: 'Track your ledger and personal savings goals with full visibility.' },
      {
        title: 'Security & Legal',
        desc: 'Before account setup, accept Terms of Service and Privacy Policy for compliance.',
      },
    ],
    []
  );

  const completeOnboarding = () => {
    if (!acceptTermsNow || !acceptPrivacyNow) {
      Alert.alert('Required', 'You must accept Terms and Privacy Policy before continuing.');
      return;
    }
    if (!termsAcceptedAt) acceptTerms();
    if (!privacyAcceptedAt) acceptPrivacy();

    const acceptedAt = new Date().toISOString();
    router.replace({
      pathname: '/(auth)/register',
      params: {
        legalAcceptedAt: encodeURIComponent(acceptedAt),
      },
    });
  };

  const handleNext = () => {
    if (step < stepsInfo.length) {
      setStep((current) => current + 1);
      return;
    }
    completeOnboarding();
  };

  const isLegalStep = step === stepsInfo.length;
  const handleSkip = () => {
    if (isLegalStep) {
      completeOnboarding();
      return;
    }
    setStep(stepsInfo.length);
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
    <View className="flex-1 items-center justify-center p-6">
      <View className="flex-1 justify-center items-center w-full">
        <View className="w-48 h-48 bg-primary/20 rounded-full mb-10 items-center justify-center">
          <Shield size={72} color="#F97316" />
        </View>
        <Text className="text-3xl font-bold text-secondary mb-4 text-center">
          {stepsInfo[step - 1].title}
        </Text>
        <Text className="text-gray-500 text-center text-lg px-4">{stepsInfo[step - 1].desc}</Text>

        {isLegalStep ? (
          <View className="w-full mt-8 px-2">
            <TouchableOpacity
              onPress={() => setAcceptTermsNow((value) => !value)}
              className="flex-row items-center bg-gray-100 rounded-xl p-4 mb-3"
            >
              <View
                className={`w-5 h-5 rounded border mr-3 items-center justify-center ${
                  acceptTermsNow ? 'bg-primary border-primary' : 'border-gray-400'
                }`}
              >
                {acceptTermsNow ? <Check size={14} color="#FFFFFF" /> : null}
              </View>
              <Text className="text-gray-700 flex-1">I accept MegaSafe Terms of Service</Text>
              <TouchableOpacity onPress={() => router.push('/(settings)/terms')}>
                <Text className="text-blue-700 font-semibold">View</Text>
              </TouchableOpacity>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setAcceptPrivacyNow((value) => !value)}
              className="flex-row items-center bg-gray-100 rounded-xl p-4"
            >
              <View
                className={`w-5 h-5 rounded border mr-3 items-center justify-center ${
                  acceptPrivacyNow ? 'bg-primary border-primary' : 'border-gray-400'
                }`}
              >
                {acceptPrivacyNow ? <Check size={14} color="#FFFFFF" /> : null}
              </View>
              <Text className="text-gray-700 flex-1">I accept MegaSafe Privacy Policy</Text>
              <TouchableOpacity onPress={() => router.push('/(settings)/privacy')}>
                <Text className="text-blue-700 font-semibold">View</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      <View className="w-full flex-row justify-between relative bottom-10 px-4">
        <TouchableOpacity onPress={handleSkip}>
          <Text className="text-gray-400 font-semibold p-4">
            {isLegalStep ? 'Continue' : 'Skip to Legal'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity className="bg-primary px-8 py-4 rounded-full" onPress={handleNext}>
          <Text className="text-white font-bold">
            {isLegalStep ? 'Accept & Continue' : 'Next'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
    </SafeAreaView>
  );
}

