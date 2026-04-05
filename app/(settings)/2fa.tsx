import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Switch,
  Alert,
  TextInput,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Shield,
  Smartphone,
  Mail,
  Key,
  Check,
  X,
  Info,
} from 'lucide-react-native';

export default function TwoFactorAuthScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<'sms' | 'email'>('sms');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [showVerification, setShowVerification] = useState(false);

  const handleEnable2FA = () => {
    if (!phoneNumber && selectedMethod === 'sms') {
      Alert.alert('Error', 'Please enter your phone number');
      return;
    }
    if (!email && selectedMethod === 'email') {
      Alert.alert('Error', 'Please enter your email address');
      return;
    }
    setShowVerification(true);
  };

  const handleVerifyCode = () => {
    if (verificationCode.length !== 6) {
      Alert.alert('Error', 'Please enter a 6-digit verification code');
      return;
    }
    setTwoFactorEnabled(true);
    setShowVerification(false);
    Alert.alert('Success', 'Two-factor authentication has been enabled');
  };

  const handleDisable2FA = () => {
    Alert.alert(
      'Disable 2FA',
      'Are you sure you want to disable two-factor authentication? This will make your account less secure.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disable',
          style: 'destructive',
          onPress: () => {
            setTwoFactorEnabled(false);
            Alert.alert('Success', 'Two-factor authentication has been disabled');
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Two-Factor Authentication</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Status Card */}
        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <Shield size={24} color={twoFactorEnabled ? "#10B981" : "#F97316"} />
            <Text style={styles.statusTitle}>
              {twoFactorEnabled ? '2FA Enabled' : '2FA Disabled'}
            </Text>
          </View>
          <Text style={styles.statusDescription}>
            {twoFactorEnabled
              ? 'Your account is protected with two-factor authentication.'
              : 'Add an extra layer of security to your account.'}
          </Text>
          {twoFactorEnabled && (
            <TouchableOpacity style={styles.disableButton} onPress={handleDisable2FA}>
              <Text style={styles.disableButtonText}>Disable 2FA</Text>
            </TouchableOpacity>
          )}
        </View>

        {!twoFactorEnabled && !showVerification && (
          <>
            {/* Method Selection */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Choose Verification Method</Text>
              
              <TouchableOpacity
                style={[
                  styles.methodCard,
                  selectedMethod === 'sms' && styles.selectedMethodCard,
                ]}
                onPress={() => setSelectedMethod('sms')}
              >
                <Smartphone size={20} color={selectedMethod === 'sms' ? '#F97316' : '#6B7280'} />
                <View style={styles.methodContent}>
                  <Text style={styles.methodTitle}>SMS</Text>
                  <Text style={styles.methodDescription}>Receive verification codes via text message</Text>
                </View>
                {selectedMethod === 'sms' && <Check size={20} color="#F97316" />}
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.methodCard,
                  selectedMethod === 'email' && styles.selectedMethodCard,
                ]}
                onPress={() => setSelectedMethod('email')}
              >
                <Mail size={20} color={selectedMethod === 'email' ? '#F97316' : '#6B7280'} />
                <View style={styles.methodContent}>
                  <Text style={styles.methodTitle}>Email</Text>
                  <Text style={styles.methodDescription}>Receive verification codes via email</Text>
                </View>
                {selectedMethod === 'email' && <Check size={20} color="#F97316" />}
              </TouchableOpacity>
            </View>

            {/* Contact Information */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Contact Information</Text>
              
              {selectedMethod === 'sms' ? (
                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>Phone Number</Text>
                  <TextInput
                    style={styles.input}
                    value={phoneNumber}
                    onChangeText={setPhoneNumber}
                    placeholder="+232 76 123 456"
                    keyboardType="phone-pad"
                  />
                </View>
              ) : (
                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>Email Address</Text>
                  <TextInput
                    style={styles.input}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="your.email@example.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </View>
              )}
            </View>

            {/* Enable Button */}
            <TouchableOpacity style={styles.enableButton} onPress={handleEnable2FA}>
              <Text style={styles.enableButtonText}>Enable 2FA</Text>
            </TouchableOpacity>
          </>
        )}

        {showVerification && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Verify Your Identity</Text>
            
            <View style={styles.verificationCard}>
              <Info size={24} color="#F97316" />
              <Text style={styles.verificationTitle}>
                Enter the 6-digit code sent to {selectedMethod === 'sms' ? phoneNumber : email}
              </Text>
              <Text style={styles.verificationDescription}>
                Please check your {selectedMethod === 'sms' ? 'text messages' : 'email'} and enter the verification code below.
              </Text>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Verification Code</Text>
              <TextInput
                style={styles.verificationInput}
                value={verificationCode}
                onChangeText={setVerificationCode}
                placeholder="000000"
                keyboardType="number-pad"
                maxLength={6}
                textAlign="center"
              />
            </View>

            <TouchableOpacity style={styles.verifyButton} onPress={handleVerifyCode}>
              <Text style={styles.verifyButtonText}>Verify Code</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.resendButton}>
              <Text style={styles.resendButtonText}>Resend Code</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Information */}
        <View style={styles.infoSection}>
          <Text style={styles.infoTitle}>About Two-Factor Authentication</Text>
          <Text style={styles.infoText}>
            Two-factor authentication adds an extra layer of security to your account. When enabled, you'll need to provide both your password and a verification code to sign in.
          </Text>
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
  statusCard: {
    backgroundColor: '#FFFFFF',
    margin: 24,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E2B5A',
    marginLeft: 12,
  },
  statusDescription: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
    marginBottom: 16,
  },
  disableButton: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  disableButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#EF4444',
  },
  section: {
    marginHorizontal: 24,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E2B5A',
    marginBottom: 16,
  },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  selectedMethodCard: {
    borderColor: '#F97316',
    backgroundColor: '#FFF7ED',
  },
  methodContent: {
    flex: 1,
    marginLeft: 12,
  },
  methodTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1E2B5A',
    marginBottom: 4,
  },
  methodDescription: {
    fontSize: 14,
    color: '#6B7280',
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1E2B5A',
    marginBottom: 8,
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
  },
  verificationInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 20,
    color: '#1E2B5A',
    letterSpacing: 8,
  },
  enableButton: {
    backgroundColor: '#F97316',
    marginHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 24,
  },
  enableButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  verificationCard: {
    backgroundColor: '#FFF7ED',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 20,
  },
  verificationTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1E2B5A',
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  verificationDescription: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
  },
  verifyButton: {
    backgroundColor: '#F97316',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  verifyButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  resendButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  resendButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F97316',
  },
  infoSection: {
    margin: 24,
    padding: 16,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1E2B5A',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
  },
});
