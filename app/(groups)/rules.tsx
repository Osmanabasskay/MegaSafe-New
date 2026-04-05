import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Switch,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { 
  ArrowLeft, 
  Shield, 
  Users, 
  Clock, 
  AlertTriangle, 
  DollarSign, 
  Calendar,
  Check,
  X
} from 'lucide-react-native';

interface GroupRules {
  requireApproval: boolean;
  allowLatePayments: boolean;
  latePaymentFee: string;
  maxMissedPayments: number;
  emergencyWithdrawal: boolean;
  withdrawalLimit: string;
  meetingFrequency: 'weekly' | 'monthly' | 'quarterly';
  digitalOnly: boolean;
  autoReminders: boolean;
  reminderDays: number;
}

export default function GroupRulesScreen() {
  const router = useRouter();
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [rules, setRules] = useState<GroupRules>({
    requireApproval: true,
    allowLatePayments: true,
    latePaymentFee: '5.00',
    maxMissedPayments: 2,
    emergencyWithdrawal: false,
    withdrawalLimit: '50.00',
    meetingFrequency: 'monthly',
    digitalOnly: true,
    autoReminders: true,
    reminderDays: 3,
  });

  const updateRule = (key: keyof GroupRules, value: any) => {
    setRules(prev => ({ ...prev, [key]: value }));
  };

  const handleNext = () => {
    // TODO: Save rules and navigate to invite members
    router.push('/(groups)/invite');
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardContainer}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft size={24} color="#F97316" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Group Rules</Text>
        </View>

        <ScrollView 
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Group Info */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Shield size={20} color="#F97316" />
              <Text style={styles.sectionTitle}>Group Information</Text>
            </View>
            
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Group Name</Text>
              <TextInput
                style={styles.textInput}
                placeholder="Enter group name"
                placeholderTextColor="#9CA3AF"
                value={groupName}
                onChangeText={setGroupName}
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Description</Text>
              <TextInput
                style={[styles.textInput, styles.textArea]}
                placeholder="Describe the purpose of this group"
                placeholderTextColor="#9CA3AF"
                value={groupDescription}
                onChangeText={setGroupDescription}
                multiline
                numberOfLines={3}
              />
            </View>
          </View>

          {/* Membership Rules */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Users size={20} color="#F97316" />
              <Text style={styles.sectionTitle}>Membership Rules</Text>
            </View>

            <View style={styles.ruleItem}>
              <View style={styles.ruleContent}>
                <Text style={styles.ruleTitle}>Require Approval</Text>
                <Text style={styles.ruleDescription}>
                  New members must be approved before joining
                </Text>
              </View>
              <Switch
                value={rules.requireApproval}
                onValueChange={(value) => updateRule('requireApproval', value)}
                trackColor={{ false: '#E5E7EB', true: '#FED7AA' }}
                thumbColor={rules.requireApproval ? '#F97316' : '#9CA3AF'}
              />
            </View>

            <View style={styles.ruleItem}>
              <View style={styles.ruleContent}>
                <Text style={styles.ruleTitle}>Digital Only</Text>
                <Text style={styles.ruleDescription}>
                  Only accept digital payments, no cash
                </Text>
              </View>
              <Switch
                value={rules.digitalOnly}
                onValueChange={(value) => updateRule('digitalOnly', value)}
                trackColor={{ false: '#E5E7EB', true: '#FED7AA' }}
                thumbColor={rules.digitalOnly ? '#F97316' : '#9CA3AF'}
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Maximum Missed Payments</Text>
              <TextInput
                style={styles.textInput}
                placeholder="2"
                placeholderTextColor="#9CA3AF"
                value={rules.maxMissedPayments.toString()}
                onChangeText={(value) => updateRule('maxMissedPayments', parseInt(value) || 0)}
                keyboardType="numeric"
              />
            </View>
          </View>

          {/* Payment Rules */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <DollarSign size={20} color="#F97316" />
              <Text style={styles.sectionTitle}>Payment Rules</Text>
            </View>

            <View style={styles.ruleItem}>
              <View style={styles.ruleContent}>
                <Text style={styles.ruleTitle}>Allow Late Payments</Text>
                <Text style={styles.ruleDescription}>
                  Members can pay after the deadline with fees
                </Text>
              </View>
              <Switch
                value={rules.allowLatePayments}
                onValueChange={(value) => updateRule('allowLatePayments', value)}
                trackColor={{ false: '#E5E7EB', true: '#FED7AA' }}
                thumbColor={rules.allowLatePayments ? '#F97316' : '#9CA3AF'}
              />
            </View>

            {rules.allowLatePayments && (
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Late Payment Fee (NLe)</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="5.00"
                  placeholderTextColor="#9CA3AF"
                  value={rules.latePaymentFee}
                  onChangeText={(value) => updateRule('latePaymentFee', value)}
                  keyboardType="numeric"
                />
              </View>
            )}
          </View>

          {/* Emergency Rules */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <AlertTriangle size={20} color="#F97316" />
              <Text style={styles.sectionTitle}>Emergency Rules</Text>
            </View>

            <View style={styles.ruleItem}>
              <View style={styles.ruleContent}>
                <Text style={styles.ruleTitle}>Emergency Withdrawal</Text>
                <Text style={styles.ruleDescription}>
                  Allow members to withdraw in emergencies
                </Text>
              </View>
              <Switch
                value={rules.emergencyWithdrawal}
                onValueChange={(value) => updateRule('emergencyWithdrawal', value)}
                trackColor={{ false: '#E5E7EB', true: '#FED7AA' }}
                thumbColor={rules.emergencyWithdrawal ? '#F97316' : '#9CA3AF'}
              />
            </View>

            {rules.emergencyWithdrawal && (
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Emergency Withdrawal Limit (NLe)</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="50.00"
                  placeholderTextColor="#9CA3AF"
                  value={rules.withdrawalLimit}
                  onChangeText={(value) => updateRule('withdrawalLimit', value)}
                  keyboardType="numeric"
                />
              </View>
            )}
          </View>

          {/* Meeting Settings */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Calendar size={20} color="#F97316" />
              <Text style={styles.sectionTitle}>Meeting Settings</Text>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Meeting Frequency</Text>
              <View style={styles.frequencyContainer}>
                {['weekly', 'monthly', 'quarterly'].map((freq) => (
                  <TouchableOpacity
                    key={freq}
                    style={[
                      styles.frequencyButton,
                      rules.meetingFrequency === freq && styles.frequencyButtonActive
                    ]}
                    onPress={() => updateRule('meetingFrequency', freq)}
                  >
                    <Text style={[
                      styles.frequencyText,
                      rules.meetingFrequency === freq && styles.frequencyTextActive
                    ]}>
                      {freq.charAt(0).toUpperCase() + freq.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          {/* Reminder Settings */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Clock size={20} color="#F97316" />
              <Text style={styles.sectionTitle}>Reminder Settings</Text>
            </View>

            <View style={styles.ruleItem}>
              <View style={styles.ruleContent}>
                <Text style={styles.ruleTitle}>Auto Reminders</Text>
                <Text style={styles.ruleDescription}>
                  Automatically remind members before payments
                </Text>
              </View>
              <Switch
                value={rules.autoReminders}
                onValueChange={(value) => updateRule('autoReminders', value)}
                trackColor={{ false: '#E5E7EB', true: '#FED7AA' }}
                thumbColor={rules.autoReminders ? '#F97316' : '#9CA3AF'}
              />
            </View>

            {rules.autoReminders && (
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Remind Days Before</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="3"
                  placeholderTextColor="#9CA3AF"
                  value={rules.reminderDays.toString()}
                  onChangeText={(value) => updateRule('reminderDays', parseInt(value) || 0)}
                  keyboardType="numeric"
                />
              </View>
            )}
          </View>

          {/* Continue Button */}
          <TouchableOpacity style={styles.continueButton} onPress={handleNext}>
            <Text style={styles.continueButtonText}>Continue to Invite Members</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAFC',
  },
  keyboardContainer: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  backButton: {
    marginRight: 16,
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
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 100,
  },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E2B5A',
    marginLeft: 12,
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1F2937',
    backgroundColor: '#F9FAFB',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  ruleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  ruleContent: {
    flex: 1,
    marginRight: 16,
  },
  ruleTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 4,
  },
  ruleDescription: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
  },
  frequencyContainer: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 4,
  },
  frequencyButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  frequencyButtonActive: {
    backgroundColor: '#F97316',
  },
  frequencyText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6B7280',
  },
  frequencyTextActive: {
    color: '#FFFFFF',
  },
  continueButton: {
    backgroundColor: '#F97316',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  continueButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
