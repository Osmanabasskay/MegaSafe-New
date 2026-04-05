import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { 
  ArrowLeft, 
  UserPlus, 
  Mail, 
  Phone, 
  Users, 
  Share2, 
  Copy,
  Check,
  X,
  MessageCircle
} from 'lucide-react-native';

interface InvitedMember {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: 'pending' | 'accepted' | 'declined';
}

export default function InviteMembersScreen() {
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState('MSF-ABC123');
  const [inviteLink, setInviteLink] = useState('https://megasafe.app/join/MSF-ABC123');
  const [emailInvite, setEmailInvite] = useState('');
  const [phoneInvite, setPhoneInvite] = useState('');
  const [invitedMembers, setInvitedMembers] = useState<InvitedMember[]>([
    {
      id: '1',
      name: 'John Doe',
      email: 'john@example.com',
      phone: '+232 76 123 456',
      status: 'accepted'
    },
    {
      id: '2',
      name: 'Jane Smith',
      email: 'jane@example.com',
      phone: '+232 30 987 654',
      status: 'pending'
    }
  ]);

  const copyInviteCode = () => {
    // TODO: Implement clipboard copy
    Alert.alert('Success', 'Invite code copied to clipboard!');
  };

  const copyInviteLink = () => {
    // TODO: Implement clipboard copy
    Alert.alert('Success', 'Invite link copied to clipboard!');
  };

  const sendEmailInvite = () => {
    if (!emailInvite.trim()) {
      Alert.alert('Error', 'Please enter an email address');
      return;
    }
    // TODO: Implement email invite
    Alert.alert('Success', 'Invitation sent via email!');
    setEmailInvite('');
  };

  const sendPhoneInvite = () => {
    if (!phoneInvite.trim()) {
      Alert.alert('Error', 'Please enter a phone number');
      return;
    }
    // TODO: Implement SMS invite
    Alert.alert('Success', 'Invitation sent via SMS!');
    setPhoneInvite('');
  };

  const removeInvitation = (memberId: string) => {
    setInvitedMembers(prev => prev.filter(member => member.id !== memberId));
  };

  const handleContinue = () => {
    // TODO: Save invitations and navigate to setup completion
    router.push('/(groups)/setup-complete');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'accepted': return '#10B981';
      case 'pending': return '#F59E0B';
      case 'declined': return '#EF4444';
      default: return '#6B7280';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'accepted': return 'Joined';
      case 'pending': return 'Pending';
      case 'declined': return 'Declined';
      default: return 'Unknown';
    }
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
          <Text style={styles.headerTitle}>Invite Members</Text>
        </View>

        <ScrollView 
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Invite Code Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Share2 size={20} color="#F97316" />
              <Text style={styles.sectionTitle}>Invite Code</Text>
            </View>
            
            <View style={styles.codeContainer}>
              <Text style={styles.codeLabel}>Share this code with trusted members:</Text>
              <View style={styles.codeBox}>
                <Text style={styles.codeText}>{inviteCode}</Text>
                <TouchableOpacity style={styles.copyButton} onPress={copyInviteCode}>
                  <Copy size={16} color="#F97316" />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.linkContainer}>
              <Text style={styles.linkLabel}>Or share this invite link:</Text>
              <View style={styles.linkBox}>
                <Text style={styles.linkText} numberOfLines={2}>{inviteLink}</Text>
                <TouchableOpacity style={styles.copyButton} onPress={copyInviteLink}>
                  <Copy size={16} color="#F97316" />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Direct Invite Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <UserPlus size={20} color="#F97316" />
              <Text style={styles.sectionTitle}>Direct Invites</Text>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Invite via Email</Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.textInput}
                  placeholder="Enter email address"
                  placeholderTextColor="#9CA3AF"
                  value={emailInvite}
                  onChangeText={setEmailInvite}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <TouchableOpacity style={styles.sendButton} onPress={sendEmailInvite}>
                  <Mail size={16} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Invite via Phone</Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.textInput}
                  placeholder="Enter phone number"
                  placeholderTextColor="#9CA3AF"
                  value={phoneInvite}
                  onChangeText={setPhoneInvite}
                  keyboardType="phone-pad"
                />
                <TouchableOpacity style={styles.sendButton} onPress={sendPhoneInvite}>
                  <Phone size={16} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Invited Members Section */}
          {invitedMembers.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Users size={20} color="#F97316" />
                <Text style={styles.sectionTitle}>Invited Members</Text>
                <Text style={styles.memberCount}>{invitedMembers.length} invited</Text>
              </View>

              {invitedMembers.map((member) => (
                <View key={member.id} style={styles.memberItem}>
                  <View style={styles.memberInfo}>
                    <View style={styles.memberAvatar}>
                      <Text style={styles.avatarText}>
                        {member.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                      </Text>
                    </View>
                    <View style={styles.memberDetails}>
                      <Text style={styles.memberName}>{member.name}</Text>
                      <Text style={styles.memberContact}>{member.email}</Text>
                      <Text style={styles.memberContact}>{member.phone}</Text>
                    </View>
                  </View>
                  <View style={styles.memberStatus}>
                    <View style={[styles.statusBadge, { backgroundColor: getStatusColor(member.status) }]}>
                      <Text style={styles.statusText}>{getStatusText(member.status)}</Text>
                    </View>
                    <TouchableOpacity 
                      style={styles.removeButton} 
                      onPress={() => removeInvitation(member.id)}
                    >
                      <X size={16} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Share Options */}
          <View style={styles.shareSection}>
            <Text style={styles.shareTitle}>Share with social apps</Text>
            <View style={styles.shareButtons}>
              <TouchableOpacity style={styles.shareButton}>
                <MessageCircle size={20} color="#1D4ED8" />
                <Text style={styles.shareButtonText}>WhatsApp</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.shareButton}>
                <Mail size={20} color="#EA4335" />
                <Text style={styles.shareButtonText}>Email</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Continue Button */}
          <TouchableOpacity style={styles.continueButton} onPress={handleContinue}>
            <Text style={styles.continueButtonText}>Continue to Setup</Text>
          </TouchableOpacity>

          <Text style={styles.note}>
            Note: Only invite people you trust. All members are financially responsible for contributions.
          </Text>
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
  memberCount: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6B7280',
    marginLeft: 'auto',
  },
  codeContainer: {
    marginBottom: 16,
  },
  codeLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 8,
  },
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 2,
    borderColor: '#F97316',
    borderStyle: 'dashed',
  },
  codeText: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#F97316',
    letterSpacing: 2,
  },
  linkContainer: {
    marginBottom: 16,
  },
  linkLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 8,
  },
  linkBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  linkText: {
    flex: 1,
    fontSize: 14,
    color: '#6B7280',
    marginRight: 12,
  },
  copyButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F97316',
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
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1F2937',
    backgroundColor: '#F9FAFB',
    marginRight: 12,
  },
  sendButton: {
    backgroundColor: '#F97316',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  memberInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  memberDetails: {
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 2,
  },
  memberContact: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 1,
  },
  memberStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginRight: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  removeButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#FEE2E2',
  },
  shareSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    alignItems: 'center',
  },
  shareTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 16,
  },
  shareButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  shareButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    marginLeft: 8,
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
  note: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 18,
  },
});
