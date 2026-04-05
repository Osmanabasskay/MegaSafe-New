import React from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';

export default function ForgotPasswordScreen() {
  const router = useRouter();

  return (
    <View className="flex-1 bg-white p-6 justify-center">
      <Text className="text-3xl font-bold text-primary mb-2 text-center">Reset Password</Text>
      <Text className="text-gray-500 mb-8 text-center">
        Enter your registered email or phone to reset your password.
      </Text>

      <View className="mb-6">
        <TextInput 
          className="border border-gray-300 rounded-lg p-4 bg-gray-50" 
          placeholder="Email or Phone Number" 
        />
      </View>

      <TouchableOpacity 
        className="bg-primary p-4 rounded-lg items-center"
        onPress={() => router.back()}
      >
        <Text className="text-white font-bold text-lg">Send Reset Link</Text>
      </TouchableOpacity>

      <TouchableOpacity className="mt-6 items-center" onPress={() => router.back()}>
        <Text className="text-gray-500 font-semibold">Back to Login</Text>
      </TouchableOpacity>
    </View>
  );
}
