import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Save } from 'lucide-react-native';
import { useAuthStore } from '../../stores/authStore';
import { useAppDataStore } from '../../stores/appDataStore';
import { upsertBasicProfile } from '../../lib/profileService';
import { getCredentialDisplayName, normalizeProfileName } from '../../lib/profileName';

const emailPattern = /^\S+@\S+\.\S+$/;

export default function ProfileEditScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { profile, updateProfile, linkPhoneNumber } = useAppDataStore();

  const initialName = useMemo(() => {
    const normalized = normalizeProfileName(profile.fullName);
    if (normalized) return normalized;
    return getCredentialDisplayName(profile.email, profile.phone);
  }, [profile.email, profile.fullName, profile.phone]);

  const [fullName, setFullName] = useState(initialName);
  const [email, setEmail] = useState(profile.email ?? '');
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmedName = normalizeProfileName(fullName);
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPhone = phone.trim();

    if (!trimmedName) {
      Alert.alert('Invalid details', 'Full name is required.');
      return;
    }
    if (trimmedEmail && !emailPattern.test(trimmedEmail)) {
      Alert.alert('Invalid details', 'Enter a valid email address.');
      return;
    }

    setSaving(true);
    try {
      updateProfile({
        fullName: trimmedName,
        email: trimmedEmail,
        phone: trimmedPhone,
      });

      if (trimmedPhone) {
        linkPhoneNumber(trimmedPhone);
      }

      if (user?.id) {
        const parts = trimmedName.split(' ');
        const firstName = parts[0] ?? '';
        const lastName = parts.slice(1).join(' ');
        const { error } = await upsertBasicProfile({
          userId: user.id,
          firstName,
          lastName,
          email: trimmedEmail || undefined,
          phone: trimmedPhone || undefined,
        });

        if (error) {
          Alert.alert('Saved locally', `Profile updated in app, but cloud sync failed: ${error.message}`);
          setSaving(false);
          return;
        }
      }

      Alert.alert('Profile updated', 'Your profile details are now in sync.');
      router.back();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not update profile.';
      Alert.alert('Update failed', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconButton}>
          <ArrowLeft size={22} color="#F97316" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <Text style={styles.label}>Full Name</Text>
          <TextInput
            style={styles.input}
            value={fullName}
            onChangeText={setFullName}
            placeholder="Your full name"
            placeholderTextColor="#9CA3AF"
          />

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="name@example.com"
            placeholderTextColor="#9CA3AF"
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <Text style={styles.label}>Phone Number</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="+23276123456"
            placeholderTextColor="#9CA3AF"
            keyboardType="phone-pad"
          />

          <TouchableOpacity style={styles.saveButton} onPress={() => void handleSave()} disabled={saving}>
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Save size={16} color="#FFFFFF" />
                <Text style={styles.saveButtonText}>Save Changes</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
  },
  iconButton: {
    width: 32,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 30,
  },
  card: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 16,
  },
  label: {
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: '#1F2937',
    fontSize: 15,
  },
  saveButton: {
    marginTop: 18,
    backgroundColor: '#F97316',
    borderRadius: 12,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  saveButtonText: {
    marginLeft: 8,
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
});
