import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';

export default function OnboardingScreen() {
  const router = useRouter();
  const [step, setStep] = useState(1);

  const stepsInfo = [
    { title: 'Welcome to MegaSafe', desc: 'Your secure digital Osusu platform.' },
    { title: 'Save Together', desc: 'Join groups and contribute funds easily via mobile money.' },
    { title: 'Grow Together', desc: 'Track your ledger securely and hit your personal savings goals.' }
  ];

  const handleNext = () => {
    if (step < 3) {
      setStep(step + 1);
    } else {
      router.replace('/(auth)/register');
    }
  };

  return (
    <View className="flex-1 bg-white items-center justify-center p-6">
      <View className="flex-1 justify-center items-center">
        <View className="w-48 h-48 bg-primary/20 rounded-full mb-10 items-center justify-center">
           <Text className="text-6xl">🔒</Text>
        </View>
        <Text className="text-3xl font-bold text-secondary mb-4 text-center">
          {stepsInfo[step - 1].title}
        </Text>
        <Text className="text-gray-500 text-center text-lg px-4">
          {stepsInfo[step - 1].desc}
        </Text>
      </View>
      <View className="w-full flex-row justify-between relative bottom-10 px-4">
        <TouchableOpacity onPress={() => router.replace('/(auth)/register')}>
          <Text className="text-gray-400 font-semibold p-4">Skip</Text>
        </TouchableOpacity>
        <TouchableOpacity className="bg-primary px-8 py-4 rounded-full" onPress={handleNext}>
          <Text className="text-white font-bold">{step === 3 ? 'Get Started' : 'Next'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
