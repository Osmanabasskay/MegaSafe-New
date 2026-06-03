import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  TextInput,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Lock,
  Eye,
  EyeOff,
  Check,
  X,
  AlertTriangle,
} from 'lucide-react-native';
import { useAuthStore } from '../../src/store/authStore';
import { supabase, supabaseConfigured } from '../../src/services/supabase';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { preferences } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const validatePassword = (password: string) => {
    const requirements = {
      length: password.length >= 8,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /[0-9]/.test(password),
      special: /[!@#$%^&*(),.?":{}|<>]/.test(password),
    };
    return requirements;
  };

  const passwordRequirements = validatePassword(newPassword);
  const isPasswordValid = Object.values(passwordRequirements).every(Boolean);
  const canSubmit = currentPassword && newPassword && confirmPassword &&
                   newPassword === confirmPassword && isPasswordValid;

  const handleChangePassword = async () => {
    if (!canSubmit) {
      Alert.alert('Error', 'Please fill in all fields correctly');
      return;
    }

    setIsLoading(true);

    try {
      if (!supabaseConfigured || !user?.email) {
        Alert.alert('Error', 'Password changes require an active email session.');
        return;
      }

      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (reauthError) {
        Alert.alert('Error', 'Current password is incorrect.');
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        Alert.alert('Error', 'Failed to change password. Please try again.');
        return;
      }
      await supabase.auth.signOut({ scope: 'global' });

      Alert.alert(
        'Success',
        'Your password has been changed successfully.',
        [
          {
            text: 'OK',
            onPress: () => router.replace('/(auth)/login'),
          },
        ]
      );

      // Clear form
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      Alert.alert('Error', 'Failed to change password. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const RequirementItem = ({ met, text }: { met: boolean; text: string }) => (
    <View style={styles.requirementItem}>
      {met ? (
        <Check size={16} color="#10B981" />
      ) : (
        <X size={16} color="#EF4444" />
      )}
      <Text style={[styles.requirementText, { color: C.textSub }, met && styles.requirementMet]}>
        {text}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: C.bg }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: C.text }]}>Change Password</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Security Notice */}
        <View style={[styles.noticeCard, { backgroundColor: isDark ? '#431407' : '#FFF7ED' }]}>
          <AlertTriangle size={24} color="#F97316" />
          <Text style={[styles.noticeTitle, { color: C.text }]}>Security Notice</Text>
          <Text style={[styles.noticeText, { color: C.textSub }]}>
            For your security, please choose a strong password that you haven't used before.
          </Text>
        </View>

        {/* Current Password */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Current Password</Text>
          <View style={styles.inputContainer}>
            <TextInput
              style={[styles.input, { backgroundColor: C.inputBg, color: C.text }]}
              value={currentPassword}
              onChangeText={setCurrentPassword}
              placeholder="Enter current password"
              placeholderTextColor={C.textMuted}
              secureTextEntry={!showCurrentPassword}
              autoCapitalize="none"
            />
            <TouchableOpacity
              style={styles.eyeIcon}
              onPress={() => setShowCurrentPassword(!showCurrentPassword)}
            >
              {showCurrentPassword ? (
                <EyeOff size={20} color={C.textMuted} />
              ) : (
                <Eye size={20} color={C.textMuted} />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* New Password */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>New Password</Text>
          <View style={styles.inputContainer}>
            <TextInput
              style={[styles.input, { backgroundColor: C.inputBg, color: C.text }]}
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="Enter new password"
              placeholderTextColor={C.textMuted}
              secureTextEntry={!showNewPassword}
              autoCapitalize="none"
            />
            <TouchableOpacity
              style={styles.eyeIcon}
              onPress={() => setShowNewPassword(!showNewPassword)}
            >
              {showNewPassword ? (
                <EyeOff size={20} color={C.textMuted} />
              ) : (
                <Eye size={20} color={C.textMuted} />
              )}
            </TouchableOpacity>
          </View>

          {/* Password Requirements */}
          <View style={[styles.requirementsCard, { backgroundColor: C.iconBg }]}>
            <Text style={[styles.requirementsTitle, { color: C.text }]}>Password Requirements:</Text>
            <RequirementItem met={passwordRequirements.length} text="At least 8 characters" />
            <RequirementItem met={passwordRequirements.uppercase} text="One uppercase letter" />
            <RequirementItem met={passwordRequirements.lowercase} text="One lowercase letter" />
            <RequirementItem met={passwordRequirements.number} text="One number" />
            <RequirementItem met={passwordRequirements.special} text="One special character" />
          </View>
        </View>

        {/* Confirm Password */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Confirm New Password</Text>
          <View style={styles.inputContainer}>
            <TextInput
              style={[styles.input, { backgroundColor: C.inputBg, color: C.text }]}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm new password"
              placeholderTextColor={C.textMuted}
              secureTextEntry={!showConfirmPassword}
              autoCapitalize="none"
            />
            <TouchableOpacity
              style={styles.eyeIcon}
              onPress={() => setShowConfirmPassword(!showConfirmPassword)}
            >
              {showConfirmPassword ? (
                <EyeOff size={20} color={C.textMuted} />
              ) : (
                <Eye size={20} color={C.textMuted} />
              )}
            </TouchableOpacity>
          </View>

          {/* Password Match Indicator */}
          {confirmPassword ? (
            <View style={styles.matchIndicator}>
              {newPassword === confirmPassword ? (
                <>
                  <Check size={16} color="#10B981" />
                  <Text style={styles.matchText}>Passwords match</Text>
                </>
              ) : (
                <>
                  <X size={16} color="#EF4444" />
                  <Text style={styles.mismatchText}>Passwords do not match</Text>
                </>
              )}
            </View>
          ) : null}
        </View>

        {/* Change Password Button */}
        <TouchableOpacity
          style={[
            styles.changeButton,
            canSubmit && !isLoading ? styles.changeButtonActive : styles.changeButtonDisabled,
          ]}
          onPress={() => void handleChangePassword()}
          disabled={!canSubmit || isLoading}
        >
          <Text style={[
            styles.changeButtonText,
            canSubmit && !isLoading ? styles.changeButtonTextActive : styles.changeButtonTextDisabled,
          ]}>
            {isLoading ? 'Changing Password...' : 'Change Password'}
          </Text>
        </TouchableOpacity>

        {/* Additional Security Tips */}
        <View style={[styles.tipsSection, { backgroundColor: C.iconBg }]}>
          <Text style={[styles.tipsTitle, { color: C.text }]}>Security Tips</Text>
          <View style={styles.tipItem}>
            <Lock size={16} color={C.textMuted} />
            <Text style={[styles.tipText, { color: C.textSub }]}>Use a unique password for Mi Osusu</Text>
          </View>
          <View style={styles.tipItem}>
            <Lock size={16} color={C.textMuted} />
            <Text style={[styles.tipText, { color: C.textSub }]}>Avoid using personal information</Text>
          </View>
          <View style={styles.tipItem}>
            <Lock size={16} color={C.textMuted} />
            <Text style={[styles.tipText, { color: C.textSub }]}>Consider using a password manager</Text>
          </View>
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
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 16,
  },
  backButton: {
    marginRight: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    flex: 1,
  },
  headerSpacer: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  noticeCard: {
    margin: 24,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
  },
  noticeTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 8,
  },
  noticeText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  section: {
    marginHorizontal: 24,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  inputContainer: {
    position: 'relative',
  },
  input: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    paddingRight: 50,
  },
  eyeIcon: {
    position: 'absolute',
    right: 16,
    top: 14,
  },
  requirementsCard: {
    padding: 16,
    borderRadius: 12,
    marginTop: 12,
  },
  requirementsTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  requirementItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  requirementText: {
    fontSize: 14,
    marginLeft: 8,
  },
  requirementMet: {
    color: '#10B981',
  },
  matchIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  matchText: {
    fontSize: 14,
    color: '#10B981',
    marginLeft: 8,
  },
  mismatchText: {
    fontSize: 14,
    color: '#EF4444',
    marginLeft: 8,
  },
  changeButton: {
    marginHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 24,
  },
  changeButtonActive: {
    backgroundColor: '#F97316',
  },
  changeButtonDisabled: {
    backgroundColor: '#E5E7EB',
  },
  changeButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  changeButtonTextActive: {
    color: '#FFFFFF',
  },
  changeButtonTextDisabled: {
    color: '#9CA3AF',
  },
  tipsSection: {
    margin: 24,
    padding: 16,
    borderRadius: 12,
  },
  tipsTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  tipText: {
    fontSize: 14,
    marginLeft: 8,
    flex: 1,
  },
});
