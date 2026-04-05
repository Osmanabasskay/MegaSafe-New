import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase, supabaseConfigured } from '../../lib/supabase';
import { useAuthStore } from '../../stores/authStore';
import { Shield } from 'lucide-react-native';

const COOLDOWN_SEC = 60;

export default function OTPScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ phone?: string }>();
  const { setSession, setUser } = useAuthStore();
  const [code, setCode] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const rawPhone = params.phone != null ? String(params.phone) : '';
  let phoneE164 = rawPhone;
  try {
    if (rawPhone) phoneE164 = decodeURIComponent(rawPhone);
  } catch {
    phoneE164 = rawPhone;
  }

  useEffect(() => {
    if (!phoneE164) {
      setErrorMessage('Missing phone number. Go back and send a code again.');
    }
  }, [phoneE164]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const sendOtp = useCallback(async () => {
    if (!supabaseConfigured || !phoneE164) return;
    setIsResending(true);
    setErrorMessage(null);
    const { error } = await supabase.auth.signInWithOtp({
      phone: phoneE164,
      options: { shouldCreateUser: true },
    });
    setIsResending(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setCooldown(COOLDOWN_SEC);
  }, [phoneE164]);

  const handleVerify = async () => {
    setErrorMessage(null);
    if (!supabaseConfigured) {
      setErrorMessage('Supabase is not configured.');
      return;
    }
    if (!phoneE164) {
      setErrorMessage('Missing phone number.');
      return;
    }
    const token = code.trim().replace(/\s/g, '');
    if (token.length < 6) {
      setErrorMessage('Enter the 6-digit code from your SMS.');
      return;
    }

    setIsVerifying(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        phone: phoneE164,
        token,
        type: 'sms',
      });
      setIsVerifying(false);
      if (error) {
        setErrorMessage(error.message);
        return;
      }
      if (data.session) {
        setSession(data.session);
        setUser(data.session.user);
        router.replace('/(main)/home');
      }
    } catch (e) {
      setIsVerifying(false);
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMessage(msg);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-slate-950 px-8 justify-center"
    >
      <View className="items-center mb-10">
        <View className="bg-slate-900 p-4 rounded-2xl border border-white/5 mb-4">
          <Shield size={48} color="#F97316" strokeWidth={1.5} />
        </View>
        <Text className="text-3xl font-extrabold text-white text-center mb-2">Verify phone</Text>
        <Text className="text-slate-400 text-center text-base px-2">
          Enter the code we sent
          {phoneE164 ? (
            <>
              {'\n'}
              <Text className="text-slate-300 font-medium">{phoneE164}</Text>
            </>
          ) : null}
        </Text>
      </View>

      <View className="bg-slate-900/50 p-6 rounded-3xl border border-white/10">
        <TextInput
          className="border-2 border-slate-700 rounded-2xl text-center text-2xl py-4 text-white tracking-[8px] font-semibold bg-slate-950/80"
          placeholder="••••••"
          placeholderTextColor="#475569"
          keyboardType="number-pad"
          maxLength={8}
          value={code}
          onChangeText={(t) => {
            setCode(t.replace(/[^\d]/g, ''));
            if (errorMessage) setErrorMessage(null);
          }}
        />

        {errorMessage ? (
          <Text className="text-red-400 text-sm mt-3 text-center">{errorMessage}</Text>
        ) : null}

        <TouchableOpacity
          className="bg-primary h-14 rounded-2xl items-center justify-center mt-6 shadow-lg shadow-primary/30 active:opacity-80"
          onPress={handleVerify}
          disabled={isVerifying}
        >
          {isVerifying ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white font-bold text-lg">Verify & continue</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          className="mt-5 items-center py-2"
          onPress={sendOtp}
          disabled={isResending || cooldown > 0 || !phoneE164}
        >
          {isResending ? (
            <ActivityIndicator color="#94A3B8" />
          ) : (
            <Text className={`font-semibold ${cooldown > 0 ? 'text-slate-600' : 'text-primary'}`}>
              {cooldown > 0 ? `Resend code (${cooldown}s)` : 'Resend code'}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity className="mt-4 items-center" onPress={() => router.back()}>
          <Text className="text-slate-500 font-medium">Change number</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
