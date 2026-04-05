import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Image,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../stores/authStore';
import { supabase, supabaseConfigured } from '../../lib/supabase';
import { signInWithGoogle } from '../../lib/auth/googleOAuth';
import { normalizePhoneE164, isValidE164 } from '../../lib/auth/phone';
import { Shield, Mail, Lock, ChevronRight, Smartphone, Eye, EyeOff } from 'lucide-react-native';

export default function LoginScreen() {
  const router = useRouter();
  const { setSession, setUser } = useAuthStore();
  const [authMode, setAuthMode] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const clearErrorOnChange = () => {
    if (errorMessage) setErrorMessage(null);
  };

  const handleEmailLogin = async () => {
    setErrorMessage(null);
    const trimmed = email.trim();
    if (!trimmed || !password) {
      setErrorMessage('Please enter your email and password.');
      return;
    }

    if (!supabaseConfigured) {
      setErrorMessage(
        'Supabase is not configured. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to .env, then restart Expo with: npx expo start -c'
      );
      return;
    }

    setIsLoading(true);
    let data: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>['data'];
    let error: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>['error'];
    try {
      const result = await supabase.auth.signInWithPassword({
        email: trimmed,
        password,
      });
      data = result.data;
      error = result.error;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/network|failed|fetch/i.test(msg)) {
        setErrorMessage(
          'Cannot reach Supabase. Check your internet connection, VPN/firewall, and EXPO_PUBLIC_SUPABASE_URL in .env.'
        );
      } else {
        setErrorMessage(msg);
      }
      setIsLoading(false);
      return;
    }
    setIsLoading(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    if (data.session) {
      setSession(data.session);
      setUser(data.session.user);
    }
  };

  const handleSendPhoneOtp = async () => {
    setErrorMessage(null);
    if (!supabaseConfigured) {
      setErrorMessage(
        'Supabase is not configured. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to .env, then restart Expo with: npx expo start -c'
      );
      return;
    }

    const normalized = normalizePhoneE164(phone);
    if (!isValidE164(normalized)) {
      setErrorMessage('Enter a valid number with country code (e.g. +233201234567).');
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: normalized,
        options: { shouldCreateUser: true },
      });
      setIsLoading(false);
      if (error) {
        setErrorMessage(error.message);
        return;
      }
      router.push({
        pathname: '/(auth)/otp',
        params: { phone: encodeURIComponent(normalized) },
      });
    } catch (e) {
      setIsLoading(false);
      const msg = e instanceof Error ? e.message : String(e);
      if (/network|failed|fetch/i.test(msg)) {
        setErrorMessage(
          'Cannot reach Supabase. Check connectivity and Phone provider settings in the Supabase dashboard.'
        );
      } else {
        setErrorMessage(msg);
      }
    }
  };

  const handleGoogle = async () => {
    setErrorMessage(null);
    if (!supabaseConfigured) {
      setErrorMessage(
        'Supabase is not configured. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to .env, then restart Expo with: npx expo start -c'
      );
      return;
    }

    setIsGoogleLoading(true);
    try {
      const { session, error, cancelled } = await signInWithGoogle();
      if (cancelled) {
        setIsGoogleLoading(false);
        return;
      }
      if (error) {
        setErrorMessage(error.message);
        setIsGoogleLoading(false);
        return;
      }
      if (session) {
        setSession(session);
        setUser(session.user);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMessage(msg);
    }
    setIsGoogleLoading(false);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-slate-950"
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingVertical: 32 }}
        className="px-8"
      >
        <View className="relative">
          <View className="absolute top-[-100] left-[-50] w-80 h-80 bg-primary/10 rounded-full blur-3xl" />
          <View className="absolute bottom-[-50] right-[-100] w-96 h-96 bg-secondary/10 rounded-full blur-3xl" />

          <View className="items-center mb-8 mt-4">
            <View className="bg-white p-4 rounded-full mb-6 shadow-lg">
              <Image 
                source={require('../../assets/MegaSafe Logo.png')} 
                style={{ width: 60, height: 60 }}
                resizeMode="contain"
              />
            </View>
            <Text className="text-4xl font-extrabold text-white tracking-tight mb-2">
              Mega<Text className="text-primary">Safe</Text>
            </Text>
            <Text className="text-slate-400 text-center font-medium text-base px-4">
              Save Together, Grow Together
            </Text>
          </View>

          <View className="space-y-5 bg-slate-900/50 p-6 rounded-3xl border border-white/10 backdrop-blur-md">
            <View className="flex-row bg-slate-950/80 rounded-2xl p-1 border border-slate-800 mb-2">
              <TouchableOpacity
                onPress={() => {
                  setAuthMode('email');
                  clearErrorOnChange();
                }}
                className={`flex-1 py-2.5 rounded-xl ${authMode === 'email' ? 'bg-primary' : ''}`}
              >
                <Text
                  className={`text-center font-semibold ${authMode === 'email' ? 'text-white' : 'text-slate-400'}`}
                >
                  Email
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setAuthMode('phone');
                  clearErrorOnChange();
                }}
                className={`flex-1 py-2.5 rounded-xl ${authMode === 'phone' ? 'bg-primary' : ''}`}
              >
                <Text
                  className={`text-center font-semibold ${authMode === 'phone' ? 'text-white' : 'text-slate-400'}`}
                >
                  Phone
                </Text>
              </TouchableOpacity>
            </View>

            {authMode === 'email' ? (
              <>
                <View>
                  <Text className="text-slate-400 text-sm font-semibold mb-2 ml-1 uppercase tracking-wider">
                    Email Address
                  </Text>
                  <View className="flex-row items-center bg-slate-950/80 border border-slate-800 rounded-2xl px-4 py-1 h-14">
                    <Mail size={20} color="#94A3B8" />
                    <TextInput
                      className="flex-1 text-white ml-3 text-base h-full"
                      placeholder="Secure email"
                      placeholderTextColor="#475569"
                      keyboardType="email-address"
                      autoCapitalize="none"
                      value={email}
                      onChangeText={(t) => {
                        setEmail(t);
                        clearErrorOnChange();
                      }}
                    />
                  </View>
                </View>

                <View>
                  <Text className="text-slate-400 text-sm font-semibold mb-2 ml-1 uppercase tracking-wider">
                    Passphrase
                  </Text>
                  <View className="flex-row items-center bg-slate-950/80 border border-slate-800 rounded-2xl px-4 py-1 h-14">
                    <Lock size={20} color="#94A3B8" />
                    <TextInput
                      className="flex-1 text-white ml-3 text-base h-full"
                      placeholder="********"
                      placeholderTextColor="#475569"
                      secureTextEntry={!showPassword}
                      value={password}
                      onChangeText={(t) => {
                        setPassword(t);
                        clearErrorOnChange();
                      }}
                    />
                    <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                      {showPassword ? (
                        <EyeOff size={20} color="#94A3B8" />
                      ) : (
                        <Eye size={20} color="#94A3B8" />
                      )}
                    </TouchableOpacity>
                  </View>
                </View>

                <TouchableOpacity
                  className="self-end mt-1"
                  onPress={() => router.push('/(auth)/forgot-password')}
                >
                  <Text className="text-primary font-medium">Forgot Access Key?</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleEmailLogin}
                  disabled={isLoading || isGoogleLoading}
                  className="bg-primary h-14 rounded-2xl flex-row items-center justify-center mt-4 shadow-lg shadow-primary/30 active:opacity-80"
                >
                  {isLoading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <>
                      <Text className="text-white text-lg font-bold mr-2">Sign In</Text>
                      <ChevronRight size={20} color="white" strokeWidth={3} />
                    </>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View>
                  <Text className="text-slate-400 text-sm font-semibold mb-2 ml-1 uppercase tracking-wider">
                    Mobile number
                  </Text>
                  <Text className="text-slate-500 text-xs mb-2 ml-1">
                    Include country code (e.g. +233...)
                  </Text>
                  <View className="flex-row items-center bg-slate-950/80 border border-slate-800 rounded-2xl px-4 py-1 h-14">
                    <Smartphone size={20} color="#94A3B8" />
                    <TextInput
                      className="flex-1 text-white ml-3 text-base h-full"
                      placeholder="+233201234567"
                      placeholderTextColor="#475569"
                      keyboardType="phone-pad"
                      autoCapitalize="none"
                      value={phone}
                      onChangeText={(t) => {
                        setPhone(t);
                        clearErrorOnChange();
                      }}
                    />
                  </View>
                </View>

                <TouchableOpacity
                  onPress={handleSendPhoneOtp}
                  disabled={isLoading || isGoogleLoading}
                  className="bg-secondary h-14 rounded-2xl flex-row items-center justify-center mt-4 shadow-lg shadow-secondary/30 active:opacity-80"
                >
                  {isLoading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <>
                      <Text className="text-white text-lg font-bold mr-2">Send verification code</Text>
                      <ChevronRight size={20} color="white" strokeWidth={3} />
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}

            {errorMessage ? (
              <Text className="text-red-400 text-sm mt-2 px-1">{errorMessage}</Text>
            ) : null}

            <View className="flex-row items-center my-4">
              <View className="flex-1 h-px bg-slate-700" />
              <Text className="text-slate-500 text-xs font-medium mx-3 uppercase">or continue with</Text>
              <View className="flex-1 h-px bg-slate-700" />
            </View>

            <TouchableOpacity
              onPress={handleGoogle}
              disabled={isLoading || isGoogleLoading}
              className="h-14 rounded-2xl flex-row items-center justify-center bg-white border border-slate-200 active:opacity-90"
            >
              {isGoogleLoading ? (
                <ActivityIndicator color="#1e293b" />
              ) : (
                <>
                  <View className="w-8 h-8 rounded-full bg-slate-100 items-center justify-center mr-3">
                    <Text className="text-slate-800 font-bold text-lg">G</Text>
                  </View>
                  <Text className="text-slate-900 text-base font-bold">Continue with Google</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <View className="flex-row justify-center mt-8 mb-4">
            <Text className="text-slate-500">Unregistered entity? </Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
              <Text className="text-secondary font-bold">Sign Up</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
