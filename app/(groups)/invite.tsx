import React, { useEffect, useMemo, useState } from 'react';
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
  Share,
  ActivityIndicator,
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
import { useAuthStore } from '../../stores/authStore';
import { useGroupCreationStore } from '../../stores/groupCreationStore';
import { createGroup, generateInviteCode } from '../../lib/groupService';

export default function InviteMembersScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { draft, addInvite, removeInvite, setInviteCode: setDraftInviteCode, resetDraft } = useGroupCreationStore();
  const [inviteCode, setInviteCode] = useState(draft.inviteCode);
  const [emailInvite, setEmailInvite] = useState('');
  const [phoneInvite, setPhoneInvite] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const inviteLink = useMemo(() => `https://megasafe.app/join/${inviteCode}`, [inviteCode]);
  const invitedMembers = draft.invites;

  useEffect(() => {
    if (inviteCode) return;
    const generated = generateInviteCode();
    setInviteCode(generated);
    setDraftInviteCode(generated);
  }, [inviteCode, setDraftInviteCode]);

  const shareInvite = async (message: string): Promise<void> => {
    try {
      await Share.share({ message });
    } catch {
      Alert.alert('Share failed', 'Unable to open the share sheet right now.');
    }
  };

  const copyInviteCode = () => {
    void shareInvite(`Join my MegaSafe group using invite code: ${inviteCode}`);
  };

  const copyInviteLink = () => {
    void shareInvite(`Join my MegaSafe group: ${inviteLink}`);
  };

  const sendEmailInvite = () => {
    if (!emailInvite.trim()) {
      Alert.alert('Error', 'Please enter an email address');
      return;
    }
    const normalizedEmail = emailInvite.trim().toLowerCase();
    if (!/\S+@\S+\.\S+/.test(normalizedEmail)) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    const id = `invite-email-${Date.now()}`;
    addInvite({
      id,
      name: normalizedEmail.split('@')[0],
      email: normalizedEmail,
      phone: '',
      status: 'pending',
    });

    Alert.alert('Success', 'Invitation sent via email!');
    setEmailInvite('');
  };

  const sendPhoneInvite = () => {
    if (!phoneInvite.trim()) {
      Alert.alert('Error', 'Please enter a phone number');
      return;
    }
    const normalizedPhone = phoneInvite.trim();
    const id = `invite-phone-${Date.now()}`;
    addInvite({
      id,
      name: normalizedPhone,
      email: '',
      phone: normalizedPhone,
      status: 'pending',
    });

    Alert.alert('Success', 'Invitation sent via SMS!');
    setPhoneInvite('');
  };

  const removeInvitation = (memberId: string) => {
    removeInvite(memberId);
  };

  const handleContinue = async () => {
    if (!user?.id) {
      Alert.alert('Sign in required', 'Please sign in again to create this group.');
      return;
    }
    if (!draft.name.trim()) {
      Alert.alert('Missing details', 'Please go back and provide a group name.');
      return;
    }
    if (draft.contributionAmount <= 0) {
      Alert.alert('Missing details', 'Please go back and enter a valid contribution amount.');
      return;
    }

    setIsSaving(true);
    const rulesSummary = JSON.stringify({
      rules: draft.rules,
      invites: draft.invites.map((invite) => ({
        name: invite.name,
        email: invite.email,
        phone: invite.phone,
      })),
    });

    const { group, error } = await createGroup({
      userId: user.id,
      name: draft.name,
      description: draft.description || null,
      contributionAmount: draft.contributionAmount,
      frequency: draft.frequency,
      maxMembers: draft.maxMembers,
      cycleStartDate: draft.cycleStartDate,
      totalCycles: draft.totalCycles,
      payoutOrder: draft.payoutOrder,
      isPublic: true,
      joinRequiresApproval: draft.rules.requireApproval,
      customRules: rulesSummary,
      inviteCode,
    });
    setIsSaving(false);

    if (error || !group) {
      Alert.alert('Unable to create group', error?.message ?? 'Please try again.');
      return;
    }

    resetDraft();
    router.push({
      pathname: '/(groups)/setup-complete',
      params: { groupId: group.id },
    });
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
          <TouchableOpacity
            style={[styles.continueButton, isSaving && { opacity: 0.7 }]}
            onPress={handleContinue}
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.continueButtonText}>Continue to Setup</Text>
            )}
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
    backgroundColor: '#FFFFFF',
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

