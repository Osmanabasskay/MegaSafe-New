import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import {
  ArrowLeft,
  Bell,
  Camera,
  ChevronRight,
  Globe,
  HelpCircle,
  Info,
  Lock,
  LogOut,
  Moon,
  Phone,
  Shield,
  ShieldCheck,
  User,
} from 'lucide-react-native';
import { useAuthStore } from '../../src/store/authStore';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';
import { uploadAvatar } from '../../src/services/profileService';
import { supabaseConfigured } from '../../src/services/supabase';
import { getCredentialDisplayName, getProfileFirstName } from '../../src/utils/profileName';

export default function SettingsScreen() {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const {
    profile,
    preferences,
    notifications,
    disputes,
    receipts,
    linkedMobileMoneyAccounts,
    linkedBankAccounts,
    initializeForUser,
    updateProfile,
    updatePreferences,
    setProfileAvatar,
  } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;

  const [showPhoneNumber, setShowPhoneNumber] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  useEffect(() => {
    initializeForUser(user);
    if (user?.email) {
      updateProfile({ email: user.email });
    }
  }, [initializeForUser, updateProfile, user]);

  const unreadNotifications = useMemo(
    () => notifications.filter((item) => !item.read).length,
    [notifications]
  );
  const profileFirstName = useMemo(
    () => getProfileFirstName(profile.fullName, getCredentialDisplayName(profile.email, profile.phone)),
    [profile.email, profile.fullName, profile.phone]
  );
  const openDisputes = useMemo(
    () => disputes.filter((dispute) => dispute.status === 'open' || dispute.status === 'under_review').length,
    [disputes]
  );

  const requestImage = async (source: 'camera' | 'library'): Promise<string | null> => {
    if (source === 'camera') {
      const camera = await ImagePicker.requestCameraPermissionsAsync();
      if (!camera.granted) {
        Alert.alert('Permission needed', 'Allow camera access to take a profile photo.');
        return null;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
      });
      return result.canceled ? null : result.assets[0].uri;
    }

    const library = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!library.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to choose a profile photo.');
      return null;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
    });
    return result.canceled ? null : result.assets[0].uri;
  };

  const saveProfilePhoto = async (source: 'camera' | 'library') => {
    setIsUploadingPhoto(true);
    try {
      const localUri = await requestImage(source);
      if (!localUri) return;

      let persistedAvatar = localUri;
      if (user?.id && supabaseConfigured) {
        const { path, error } = await uploadAvatar(user.id, localUri);
        if (error) {
          Alert.alert('Upload warning', `Photo selected, but cloud sync failed: ${error.message}`);
        } else if (path) {
          persistedAvatar = path;
        }
      }

      setProfileAvatar(persistedAvatar);
      Alert.alert('Profile updated', 'Your profile photo has been saved.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update profile photo.';
      Alert.alert('Profile photo error', message);
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handlePhotoPicker = () => {
    Alert.alert('Profile Photo', 'Choose photo source', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Camera', onPress: () => void saveProfilePhoto('camera') },
      { text: 'Photo Library', onPress: () => void saveProfilePhoto('library') },
    ]);
  };

  const handleSignOut = async () => {
    await logout();
    router.replace('/(auth)/login');
  };

  const renderHeaderRow = (title: string, icon: React.ReactNode) => (
    <View style={styles.sectionHeader}>
      {icon}
      <Text style={[styles.sectionTitle, { color: C.text }]}>{title}</Text>
    </View>
  );

  const renderItem = (params: {
    title: string;
    subtitle?: string;
    icon: React.ReactNode;
    onPress?: () => void;
    right?: React.ReactNode;
    hideChevron?: boolean;
  }) => (
    <TouchableOpacity style={[styles.itemRow, { backgroundColor: C.bg }]} onPress={params.onPress} activeOpacity={0.8}>
      <View style={styles.itemLeft}>
        <View style={[styles.itemIcon, { backgroundColor: C.iconBg }]}>{params.icon}</View>
        <View style={styles.itemTextBlock}>
          <Text style={[styles.itemTitle, { color: C.text }]}>{params.title}</Text>
          {params.subtitle ? <Text style={[styles.itemSubtitle, { color: C.textSub }]}>{params.subtitle}</Text> : null}
        </View>
      </View>
      <View>{params.right ?? (!params.hideChevron ? <ChevronRight size={18} color={C.textMuted} /> : null)}</View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { backgroundColor: C.bg }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: C.text }]}>Settings</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* ── Account ── */}
        <View style={styles.section}>
          {renderHeaderRow('Account', <User size={20} color="#000000" />)}

          <View style={[styles.profileCard, { backgroundColor: C.card }]}>
            <TouchableOpacity onPress={handlePhotoPicker} disabled={isUploadingPhoto} style={styles.avatarWrap}>
              {profile.avatarUrl ? (
                <Image source={{ uri: profile.avatarUrl }} style={styles.avatarImage} />
              ) : (
                <View style={styles.avatarFallback}>
                  <User size={28} color="#FFFFFF" />
                </View>
              )}
              <View style={styles.cameraBadge}>
                {isUploadingPhoto ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Camera size={14} color="#FFFFFF" />
                )}
              </View>
            </TouchableOpacity>
            <View style={styles.profileInfo}>
              <Text style={[styles.profileName, { color: C.text }]}>{profileFirstName}</Text>
              <Text style={[styles.profileEmail, { color: C.textSub }]}>{profile.email || 'No email yet'}</Text>
              {/* Phase 4: Shield/TrustGuard icon removed — text-only KYC badge */}
              <View style={[styles.kycBadge, { backgroundColor: isDark ? '#065F46' : '#D1FAE5' }]}>
                <Text style={styles.kycText}>{profile.verificationStatus}</Text>
              </View>
            </View>
          </View>

          {renderItem({
            title: 'Profile',
            subtitle: 'View and edit profile details',
            icon: <User size={18} color="#000000" />,
            onPress: () => router.push('/components/profile-edit'),
          })}
          {renderItem({
            title: 'Phone Number',
            subtitle: showPhoneNumber ? profile.phone || 'Not set' : 'Tap to reveal',
            icon: <Phone size={18} color="#000000" />,
            onPress: () => setShowPhoneNumber((prev) => !prev),
          })}
        </View>

        {/* ── Security ── */}
        <View style={styles.section}>
          {renderHeaderRow('Security', <Shield size={20} color="#000000" />)}
          {renderItem({
            title: 'Change Password',
            subtitle: 'Update account password',
            icon: <Lock size={18} color="#000000" />,
            onPress: () => router.push('/(settings)/change-password'),
          })}
          {renderItem({
            title: 'Two-Factor Authentication',
            subtitle: preferences.twoFactorAuth ? 'Enabled' : 'Disabled',
            icon: <ShieldCheck size={18} color="#000000" />,
            right: (
              <Switch
                value={preferences.twoFactorAuth}
                onValueChange={(value) => updatePreferences({ twoFactorAuth: value })}
                trackColor={{ false: C.switchOff, true: '#F97316' }}
                thumbColor="#FFFFFF"
              />
            ),
            hideChevron: true,
          })}
          {renderItem({
            title: 'Biometric Authentication',
            subtitle: preferences.biometricAuth ? 'Enabled' : 'Disabled',
            icon: <Shield size={18} color="#000000" />,
            right: (
              <Switch
                value={preferences.biometricAuth}
                onValueChange={(value) => updatePreferences({ biometricAuth: value })}
                trackColor={{ false: C.switchOff, true: '#F97316' }}
                thumbColor="#FFFFFF"
              />
            ),
            hideChevron: true,
          })}
        </View>

        {/* ── Preferences ── */}
        <View style={styles.section}>
          {renderHeaderRow('Preferences', <Bell size={20} color="#000000" />)}
          {renderItem({
            title: 'Notifications',
            subtitle: unreadNotifications > 0 ? `${unreadNotifications} unread` : 'All caught up',
            icon: <Bell size={18} color="#000000" />,
            onPress: () => router.push('/components/notifications'),
            right: (
              <Switch
                value={preferences.notificationsEnabled}
                onValueChange={(value) => updatePreferences({ notificationsEnabled: value })}
                trackColor={{ false: C.switchOff, true: '#F97316' }}
                thumbColor="#FFFFFF"
              />
            ),
            hideChevron: true,
          })}
          {renderItem({
            title: 'Dark Mode',
            subtitle: preferences.darkMode ? 'Enabled' : 'Disabled',
            icon: <Moon size={18} color="#000000" />,
            right: (
              <Switch
                value={preferences.darkMode}
                onValueChange={(value) => updatePreferences({ darkMode: value })}
                trackColor={{ false: C.switchOff, true: '#F97316' }}
                thumbColor="#FFFFFF"
              />
            ),
            hideChevron: true,
          })}
          {renderItem({
            title: 'Language',
            subtitle: 'English',
            icon: <Globe size={18} color="#000000" />,
            hideChevron: true,
          })}
        </View>

        {/* ── Payments ── */}
        <View style={styles.section}>
          {renderHeaderRow('Payments', <Phone size={20} color="#000000" />)}
          {renderItem({
            title: 'Payment Methods',
            subtitle: `${linkedMobileMoneyAccounts.length} mobile money • ${linkedBankAccounts.length} bank linked`,
            icon: <Phone size={18} color="#000000" />,
            onPress: () => router.push('/components/payment-methods'),
          })}
        </View>

        {/* ── Support ── */}
        <View style={styles.section}>
          {renderHeaderRow('Support', <HelpCircle size={20} color="#000000" />)}
          {renderItem({
            title: 'Disputes & Cases',
            subtitle: `${openDisputes} active`,
            icon: <Shield size={18} color="#000000" />,
            onPress: () => router.push('/components/disputes'),
          })}
          {renderItem({
            title: 'Help Center',
            subtitle: `${openDisputes} active dispute(s)`,
            icon: <HelpCircle size={18} color="#000000" />,
            onPress: () => router.push('/(settings)/help'),
          })}
          {renderItem({
            title: 'Terms of Service',
            icon: <Lock size={18} color="#000000" />,
            onPress: () => router.push('/(settings)/terms'),
          })}
          {renderItem({
            title: 'Privacy Policy',
            icon: <Lock size={18} color="#000000" />,
            onPress: () => router.push('/(settings)/privacy'),
          })}
          {renderItem({
            title: 'About Mi Osusu',
            subtitle: `${receipts.length} receipts generated`,
            icon: <Info size={18} color="#000000" />,
            onPress: () => router.push('/(settings)/about'),
          })}
          {renderItem({
            title: 'Payment Receipts',
            subtitle: `${receipts.length} stored`,
            icon: <Info size={18} color="#000000" />,
            onPress: () => router.push('/components/receipts'),
          })}
        </View>

        {/* ── Sign Out ── */}
        <View style={styles.section}>
          <TouchableOpacity style={[styles.signOutButton, { backgroundColor: C.card }]} onPress={() => void handleSignOut()}>
            <LogOut size={20} color="#EF4444" />
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  backButton: {
    width: 36,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
  },
  scrollView: {
    flex: 1,
  },
  section: {
    marginTop: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  sectionTitle: {
    marginLeft: 8,
    fontSize: 17,
    fontWeight: '700',
  },
  profileCard: {
    marginHorizontal: 24,
    marginBottom: 10,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrap: {
    position: 'relative',
    marginRight: 14,
  },
  avatarImage: {
    width: 62,
    height: 62,
    borderRadius: 31,
  },
  avatarFallback: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#1E2B5A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 2,
  },
  profileEmail: {
    fontSize: 13,
    marginBottom: 6,
  },
  kycBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  kycText: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '600',
  },
  itemRow: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  itemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  itemIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  itemTextBlock: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  itemSubtitle: {
    marginTop: 2,
    fontSize: 12,
  },
  signOutButton: {
    marginHorizontal: 24,
    marginBottom: 24,
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutText: {
    marginLeft: 8,
    color: '#EF4444',
    fontWeight: '700',
    fontSize: 15,
  },
});
