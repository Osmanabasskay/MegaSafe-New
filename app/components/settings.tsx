import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Switch,
  Alert,
  TextInput,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import {
  ArrowLeft,
  User,
  Phone,
  CreditCard,
  Gift,
  Shield,
  Bell,
  Lock,
  HelpCircle,
  FileText,
  ChevronRight,
  Moon,
  Globe,
  Fingerprint,
  Eye,
  EyeOff,
  Copy,
  Check,
  X,
  LogOut,
  Info,
  Camera,
  Image as ImageIcon,
} from 'lucide-react-native';
import { uploadFromUri } from '../../lib/storageUpload';

export default function SettingsScreen() {
  const router = useRouter();
  const [darkMode, setDarkMode] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [biometricAuth, setBiometricAuth] = useState(false);
  const [showReferralCode, setShowReferralCode] = useState(false);
  const [showPhoneNumber, setShowPhoneNumber] = useState(false);
  const [twoFactorAuth, setTwoFactorAuth] = useState(false);
  const [profilePhotoUri, setProfilePhotoUri] = useState<string | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  const userProfile = {
    name: 'John Doe',
    email: 'john.doe@example.com',
    phone: '+232 76 123 456',
    referralCode: 'MEGASAFE2024',
    memberSince: 'January 2024',
    verificationStatus: 'Verified',
  };

  const bankAccounts = [
    {
      id: '1',
      bank: 'Sierra Leone Commercial Bank',
      accountNumber: '****1234',
      type: 'Savings',
      isDefault: true,
    },
    {
      id: '2',
      bank: 'EcoBank',
      accountNumber: '****5678',
      type: 'Current',
      isDefault: false,
    },
  ];

  const copyToClipboard = (text: string) => {
    // In a real app, you'd use Clipboard.setString(text)
    Alert.alert('Copied!', `${text} copied to clipboard`);
  };

  const toggleReferralCode = () => {
    setShowReferralCode(!showReferralCode);
  };

  const togglePhoneNumber = () => {
    setShowPhoneNumber(!showPhoneNumber);
  };

  const handleLogout = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out of MegaSafe?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: () => router.push('/welcome') },
      ]
    );
  };

  const pickFromLibrary = async (): Promise<string | null> => {
    console.log('pickFromLibrary called');
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    console.log('Library permission:', perm.granted);
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to upload your profile photo.');
      return null;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.85,
      aspect: [1, 1],
    });
    console.log('Library result:', result);
    if (result.canceled) return null;
    return result.assets[0].uri;
  };

  const pickFromCamera = async (): Promise<string | null> => {
    console.log('pickFromCamera called');
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    console.log('Camera permission:', perm.granted);
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow camera access to capture your profile photo.');
      return null;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.85,
      aspect: [1, 1],
    });
    console.log('Camera result:', result);
    if (result.canceled) return null;
    return result.assets[0].uri;
  };

  const handleProfilePhotoPress = () => {
    console.log('Profile photo pressed');
    Alert.alert('Profile Photo', 'Choose a source', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Camera', onPress: () => selectProfilePhoto(pickFromCamera) },
      { text: 'Photo library', onPress: () => selectProfilePhoto(pickFromLibrary) },
    ]);
  };

  const selectProfilePhoto = async (pickFunction: () => Promise<string | null>) => {
    console.log('selectProfilePhoto called');
    setIsUploadingPhoto(true);
    try {
      const uri = await pickFunction();
      console.log('Photo URI:', uri);
      if (uri) {
        // For now, just set the URI without uploading to test
        setProfilePhotoUri(uri);
        Alert.alert('Success', 'Profile photo updated successfully!');
        
        // TODO: Upload to storage later
        // const fileName = `profile-${Date.now()}.jpg`;
        // const { error } = await uploadFromUri('avatars', fileName, uri);
        
        // if (error) {
        //   Alert.alert('Upload Failed', error.message);
        // } else {
        //   setProfilePhotoUri(uri);
        //   Alert.alert('Success', 'Profile photo updated successfully!');
        // }
      }
    } catch (error) {
      console.error('Error selecting photo:', error);
      Alert.alert('Error', 'Failed to update profile photo');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const renderSectionHeader = (title: string, icon: any) => (
    <View style={styles.sectionHeader}>
      {icon}
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );

  const renderSettingItem = (
    title: string,
    subtitle?: string,
    icon?: any,
    onPress?: () => void,
    rightComponent?: React.ReactNode,
    showChevron: boolean = true
  ) => (
    <TouchableOpacity style={styles.settingItem} onPress={onPress}>
      <View style={styles.settingLeft}>
        {icon && <View style={styles.settingIcon}>{icon}</View>}
        <View style={styles.settingContent}>
          <Text style={styles.settingTitle}>{title}</Text>
          {subtitle && <Text style={styles.settingSubtitle}>{subtitle}</Text>}
        </View>
      </View>
      <View style={styles.settingRight}>
        {rightComponent || (showChevron && <ChevronRight size={20} color="#9CA3AF" />)}
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Profile Section */}
        <View style={styles.section}>
          {renderSectionHeader('Account', <User size={20} color="#F97316" />)}
          
          <View style={styles.profileCard}>
            <View style={styles.profileHeader}>
              <TouchableOpacity onPress={handleProfilePhotoPress} disabled={isUploadingPhoto} style={styles.avatarContainer}>
                <View style={[styles.avatar, isUploadingPhoto && styles.avatarUploading]}>
                  {isUploadingPhoto ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : profilePhotoUri ? (
                    <Image source={{ uri: profilePhotoUri }} style={styles.avatarImage} />
                  ) : (
                    <>
                      <Text style={styles.avatarText}>JD</Text>
                      <View style={styles.cameraIconOverlay}>
                        <Camera size={16} color="#FFFFFF" />
                      </View>
                    </>
                  )}
                </View>
              </TouchableOpacity>
              <View style={styles.profileInfo}>
                <Text style={styles.profileName}>{userProfile.name}</Text>
                <Text style={styles.profileEmail}>{userProfile.email}</Text>
                <View style={styles.verificationBadge}>
                  <Shield size={12} color="#10B981" />
                  <Text style={styles.verificationText}>{userProfile.verificationStatus}</Text>
                </View>
              </View>
            </View>
            <View style={styles.profileStats}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{userProfile.memberSince}</Text>
                <Text style={styles.statLabel}>Member Since</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>12</Text>
                <Text style={styles.statLabel}>Groups</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>NLe 2.5K</Text>
                <Text style={styles.statLabel}>Total Saved</Text>
              </View>
            </View>
          </View>

          {renderSettingItem(
            'Edit Profile',
            'Update your personal information',
            <User size={20} color="#6B7280" />,
            () => router.push('/settings/edit-profile')
          )}

          {/* Test button for profile photo */}
          {renderSettingItem(
            'Test Profile Photo',
            'Tap to test photo selection',
            <Camera size={20} color="#6B7280" />,
            handleProfilePhotoPress
          )}
        </View>

        {/* Contact Information */}
        <View style={styles.section}>
          {renderSectionHeader('Contact Information', <Phone size={20} color="#F97316" />)}
          
          {renderSettingItem(
            'Phone Number',
            showPhoneNumber ? userProfile.phone : '**** **** 456',
            <Phone size={20} color="#6B7280" />,
            togglePhoneNumber,
            <TouchableOpacity onPress={togglePhoneNumber}>
              {showPhoneNumber ? <EyeOff size={20} color="#6B7280" /> : <Eye size={20} color="#6B7280" />}
            </TouchableOpacity>
          )}

          {renderSettingItem(
            'Add Phone Number',
            'Link additional phone numbers',
            <Plus size={20} color="#6B7280" />,
            () => router.push('/settings/add-phone')
          )}
        </View>

        {/* Banking */}
        <View style={styles.section}>
          {renderSectionHeader('Banking', <CreditCard size={20} color="#F97316" />)}
          
          {renderSettingItem(
            'Bank Accounts',
            `${bankAccounts.length} accounts linked`,
            <CreditCard size={20} color="#6B7280" />,
            () => router.push('/settings/bank-accounts')
          )}

          {renderSettingItem(
            'Add Bank Account',
            'Link a new bank account for withdrawals',
            <Plus size={20} color="#6B7280" />,
            () => router.push('/settings/add-bank')
          )}

          {renderSettingItem(
            'Payment Methods',
            'Manage Orange Money, AfriMoney, etc.',
            <Wallet size={20} color="#6B7280" />,
            () => router.push('/settings/payment-methods')
          )}
        </View>

        {/* Referral */}
        <View style={styles.section}>
          {renderSectionHeader('Referral Program', <Gift size={20} color="#F97316" />)}
          
          <View style={styles.referralCard}>
            <View style={styles.referralHeader}>
              <Text style={styles.referralTitle}>Your Referral Code</Text>
              <TouchableOpacity onPress={copyToClipboard.bind(null, userProfile.referralCode)}>
                <Copy size={20} color="#F97316" />
              </TouchableOpacity>
            </View>
            <View style={styles.referralCodeContainer}>
              <Text style={styles.referralCode}>
                {showReferralCode ? userProfile.referralCode : '****-****-****'}
              </Text>
              <TouchableOpacity onPress={toggleReferralCode}>
                {showReferralCode ? <EyeOff size={20} color="#6B7280" /> : <Eye size={20} color="#6B7280" />}
              </TouchableOpacity>
            </View>
            <Text style={styles.referralDescription}>
              Share this code with friends and earn NLe 50 for each successful referral!
            </Text>
          </View>

          {renderSettingItem(
            'Referral History',
            'View your referral earnings and history',
            <Gift size={20} color="#6B7280" />,
            () => router.push('/settings/referral-history')
          )}
        </View>

        {/* Security */}
        <View style={styles.section}>
          {renderSectionHeader('Security', <Shield size={20} color="#F97316" />)}
          
          {renderSettingItem(
            'Change Password',
            'Update your account password',
            <Lock size={20} color="#6B7280" />,
            () => router.push('/settings/change-password')
          )}

          {renderSettingItem(
            'Two-Factor Authentication',
            'Add an extra layer of security',
            <Shield size={20} color="#6B7280" />,
            () => router.push('/settings/2fa'),
            <Switch
              value={twoFactorAuth}
              onValueChange={setTwoFactorAuth}
              trackColor={{ false: '#E5E7EB', true: '#F97316' }}
              thumbColor="#FFFFFF"
            />
          )}

          {renderSettingItem(
            'Biometric Authentication',
            'Use fingerprint or face recognition',
            <Fingerprint size={20} color="#6B7280" />,
            () => {},
            <Switch
              value={biometricAuth}
              onValueChange={setBiometricAuth}
              trackColor={{ false: '#E5E7EB', true: '#F97316' }}
              thumbColor="#FFFFFF"
            />
          )}
        </View>

        {/* Preferences */}
        <View style={styles.section}>
          {renderSectionHeader('Preferences', <Bell size={20} color="#F97316" />)}
          
          {renderSettingItem(
            'Notifications',
            'Manage push notifications and alerts',
            <Bell size={20} color="#6B7280" />,
            () => router.push('/settings/notifications'),
            <Switch
              value={notifications}
              onValueChange={setNotifications}
              trackColor={{ false: '#E5E7EB', true: '#F97316' }}
              thumbColor="#FFFFFF"
            />
          )}

          {renderSettingItem(
            'Dark Mode',
            'Toggle dark theme',
            <Moon size={20} color="#6B7280" />,
            () => {},
            <Switch
              value={darkMode}
              onValueChange={setDarkMode}
              trackColor={{ false: '#E5E7EB', true: '#F97316' }}
              thumbColor="#FFFFFF"
            />
          )}

          {renderSettingItem(
            'Language',
            'English',
            <Globe size={20} color="#6B7280" />,
            () => router.push('/settings/language')
          )}
        </View>

        {/* Support */}
        <View style={styles.section}>
          {renderSectionHeader('Support', <HelpCircle size={20} color="#F97316" />)}
          
          {renderSettingItem(
            'Help Center',
            'Get help and support',
            <HelpCircle size={20} color="#6B7280" />,
            () => router.push('/settings/help')
          )}

          {renderSettingItem(
            'Terms of Service',
            'Read our terms and conditions',
            <FileText size={20} color="#6B7280" />,
            () => router.push('/settings/terms')
          )}

          {renderSettingItem(
            'Privacy Policy',
            'Read our privacy policy',
            <FileText size={20} color="#6B7280" />,
            () => router.push('/settings/privacy')
          )}

          {renderSettingItem(
            'About MegaSafe',
            'Version 1.0.0',
            <Info size={20} color="#6B7280" />,
            () => router.push('/settings/about')
          )}
        </View>

        {/* Danger Zone */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.dangerButton} onPress={handleLogout}>
            <LogOut size={20} color="#EF4444" />
            <Text style={styles.dangerButtonText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const Plus = ({ size, color }: { size: number; color: string }) => (
  <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
    <Text style={{ fontSize: size * 0.8, color, fontWeight: 'bold' }}>+</Text>
  </View>
);

const Wallet = ({ size, color }: { size: number; color: string }) => (
  <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
    <Text style={{ fontSize: size * 0.4, color, fontWeight: 'bold' }}>NLe</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backButton: {
    marginRight: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1E2B5A',
    flex: 1,
  },
  headerSpacer: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  section: {
    marginTop: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E2B5A',
    marginLeft: 8,
  },
  profileCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 24,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarContainer: {
    marginRight: 16,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  avatarUploading: {
    opacity: 0.7,
  },
  avatarImage: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  cameraIconOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 12,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E2B5A',
    marginBottom: 4,
  },
  profileEmail: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 8,
  },
  verificationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  verificationText: {
    fontSize: 12,
    color: '#10B981',
    fontWeight: '500',
    marginLeft: 4,
  },
  profileStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E2B5A',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  statDivider: {
    width: 1,
    backgroundColor: '#E5E7EB',
    marginHorizontal: 16,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  settingContent: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1E2B5A',
    marginBottom: 2,
  },
  settingSubtitle: {
    fontSize: 14,
    color: '#6B7280',
  },
  settingRight: {
    alignItems: 'center',
  },
  referralCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 24,
    borderRadius: 16,
    padding: 20,
    borderWidth: 2,
    borderColor: '#F97316',
    borderStyle: 'dashed',
    marginBottom: 16,
  },
  referralHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  referralTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  referralCodeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  referralCode: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F97316',
    letterSpacing: 2,
  },
  referralDescription: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
  },
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EF4444',
    marginBottom: 24,
  },
  dangerButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#EF4444',
    marginLeft: 8,
  },
});
