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

export default function ChangePasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      Alert.alert(
        'Success',
        'Your password has been changed successfully.',
        [
          {
            text: 'OK',
            onPress: () => router.back(),
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
      <Text style={[styles.requirementText, met && styles.requirementMet]}>
        {text}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Change Password</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Security Notice */}
        <View style={styles.noticeCard}>
          <AlertTriangle size={24} color="#F97316" />
          <Text style={styles.noticeTitle}>Security Notice</Text>
          <Text style={styles.noticeText}>
            For your security, please choose a strong password that you haven't used before.
          </Text>
        </View>

        {/* Current Password */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Current Password</Text>
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              value={currentPassword}
              onChangeText={setCurrentPassword}
              placeholder="Enter current password"
              secureTextEntry={!showCurrentPassword}
              autoCapitalize="none"
            />
            <TouchableOpacity
              style={styles.eyeIcon}
              onPress={() => setShowCurrentPassword(!showCurrentPassword)}
            >
              {showCurrentPassword ? (
                <EyeOff size={20} color="#6B7280" />
              ) : (
                <Eye size={20} color="#6B7280" />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* New Password */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>New Password</Text>
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="Enter new password"
              secureTextEntry={!showNewPassword}
              autoCapitalize="none"
            />
            <TouchableOpacity
              style={styles.eyeIcon}
              onPress={() => setShowNewPassword(!showNewPassword)}
            >
              {showNewPassword ? (
                <EyeOff size={20} color="#6B7280" />
              ) : (
                <Eye size={20} color="#6B7280" />
              )}
            </TouchableOpacity>
          </View>

          {/* Password Requirements */}
          <View style={styles.requirementsCard}>
            <Text style={styles.requirementsTitle}>Password Requirements:</Text>
            <RequirementItem met={passwordRequirements.length} text="At least 8 characters" />
            <RequirementItem met={passwordRequirements.uppercase} text="One uppercase letter" />
            <RequirementItem met={passwordRequirements.lowercase} text="One lowercase letter" />
            <RequirementItem met={passwordRequirements.number} text="One number" />
            <RequirementItem met={passwordRequirements.special} text="One special character" />
          </View>
        </View>

        {/* Confirm Password */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Confirm New Password</Text>
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm new password"
              secureTextEntry={!showConfirmPassword}
              autoCapitalize="none"
            />
            <TouchableOpacity
              style={styles.eyeIcon}
              onPress={() => setShowConfirmPassword(!showConfirmPassword)}
            >
              {showConfirmPassword ? (
                <EyeOff size={20} color="#6B7280" />
              ) : (
                <Eye size={20} color="#6B7280" />
              )}
            </TouchableOpacity>
          </View>

          {/* Password Match Indicator */}
          {confirmPassword && (
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
          )}
        </View>

        {/* Change Password Button */}
        <TouchableOpacity
          style={[
            styles.changeButton,
            canSubmit && !isLoading ? styles.changeButtonActive : styles.changeButtonDisabled,
          ]}
          onPress={handleChangePassword}
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
        <View style={styles.tipsSection}>
          <Text style={styles.tipsTitle}>Security Tips</Text>
          <View style={styles.tipItem}>
            <Lock size={16} color="#6B7280" />
            <Text style={styles.tipText}>Use a unique password for MegaSafe</Text>
          </View>
          <View style={styles.tipItem}>
            <Lock size={16} color="#6B7280" />
            <Text style={styles.tipText}>Avoid using personal information</Text>
          </View>
          <View style={styles.tipItem}>
            <Lock size={16} color="#6B7280" />
            <Text style={styles.tipText}>Consider using a password manager</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

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
  noticeCard: {
    backgroundColor: '#FFF7ED',
    margin: 24,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  noticeTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1E2B5A',
    marginTop: 12,
    marginBottom: 8,
  },
  noticeText: {
    fontSize: 14,
    color: '#6B7280',
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
    color: '#1E2B5A',
    marginBottom: 12,
  },
  inputContainer: {
    position: 'relative',
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1E2B5A',
    paddingRight: 50,
  },
  eyeIcon: {
    position: 'absolute',
    right: 16,
    top: 14,
  },
  requirementsCard: {
    backgroundColor: '#F3F4F6',
    padding: 16,
    borderRadius: 12,
    marginTop: 12,
  },
  requirementsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E2B5A',
    marginBottom: 12,
  },
  requirementItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  requirementText: {
    fontSize: 14,
    color: '#6B7280',
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
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
  },
  tipsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1E2B5A',
    marginBottom: 12,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  tipText: {
    fontSize: 14,
    color: '#6B7280',
    marginLeft: 8,
    flex: 1,
  },
});
