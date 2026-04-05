import React from 'react';
import { View, Text } from 'react-native';

type Props = {
  currentStep: number;
  totalSteps?: number;
  label?: string;
};

export function KycProgress({ currentStep, totalSteps = 5, label }: Props) {
  return (
    <View className="px-6 pt-4 pb-2 bg-white">
      {label ? (
        <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{label}</Text>
      ) : null}
      <View className="flex-row gap-1.5">
        {Array.from({ length: totalSteps }, (_, i) => (
          <View
            key={i}
            className={`flex-1 h-1.5 rounded-full ${i < currentStep ? 'bg-primary' : 'bg-gray-200'}`}
          />
        ))}
      </View>
      <Text className="text-right text-xs text-gray-400 mt-1">
        Step {currentStep} of {totalSteps}
      </Text>
    </View>
  );
}
