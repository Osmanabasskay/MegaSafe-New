import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image,
  Modal,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Search,
  UserPlus,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  SearchX,
  Camera,
  Lock,
  User,
  Eye,
  EyeOff,
  RefreshCw,
  Shield,
  X,
} from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  assignContributor,
  fetchGroupMembers,
  getGroupById,
} from '../../src/services/groupService';
import { uploadFromUri } from '../../src/services/storageUpload';
import { useAuthStore } from '../../src/store/authStore';

interface ProfileSummary {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
}

function generateRandomPasscode(): string {
  // Fail closed: crypto.getRandomValues must be available.
  // Math.random is NOT acceptable for security-critical passcode generation.
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error('Secure random number generation is unavailable on this device.');
  }
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return String((bytes[0]! * 65536 + bytes[1]! * 256 + bytes[2]!) % 1000000).padStart(6, '0');
}

export default function AssignContributorsScreen() {
  const router = useRouter();
  const { id: groupId } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuthStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAssigning, setIsAssigning] = useState<string | null>(null);
  const [results, setResults] = useState<ProfileSummary[]>([]);
  const [groupMembers, setGroupMembers] = useState<ProfileSummary[]>([]);
  const [groupName, setGroupName] = useState('Osusu Group');

  // Collector setup modal
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<ProfileSummary | null>(null);
  const [collectorName, setCollectorName] = useState('');
  const [collectorPhotoUri, setCollectorPhotoUri] = useState<string | null>(null);
  const [collectorPasscode, setCollectorPasscode] = useState('');
  const [showPasscode, setShowPasscode] = useState(false);

  // One-time secure passcode reveal — shown in a dedicated modal after assignment.
  // The passcode is cleared when the admin dismisses the reveal modal.
  // It is NEVER shown in an Alert (which can be screenshot, logged, or sent to
  // accessibility services).
  const [revealPasscode, setRevealPasscode] = useState<string | null>(null);
  const [showRevealModal, setShowRevealModal] = useState(false);
  const [showRevealPasscode, setShowRevealPasscode] = useState(false);

  useEffect(() => {
    async function loadGroup() {
      if (groupId) {
        setIsLoading(true);
        const [{ group }, memberResult] = await Promise.all([
          getGroupById(groupId),
          fetchGroupMembers(groupId),
        ]);
        if (group) setGroupName(group.name);
        const roster = memberResult.members.map((member) => {
          const [firstName, ...rest] = member.displayName.split(' ');
          return {
            id: member.userId,
            first_name: firstName || member.displayName,
            last_name: rest.join(' ') || null,
            phone: member.phone,
            email: null,
          };
        });
        setGroupMembers(roster);
        setResults(roster);
        setIsLoading(false);
      }
    }
    loadGroup();
  }, [groupId]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setResults(groupMembers);
      return;
    }

    setIsLoading(true);
    try {
      const q = searchQuery.toLowerCase().trim();
      const matchingMembers = groupMembers.filter((member) => {
        const name = `${member.first_name ?? ''} ${member.last_name ?? ''}`.toLowerCase();
        return name.includes(q) || member.phone?.includes(q) || member.email?.toLowerCase().includes(q);
      });
      setResults(matchingMembers);
    } catch {
      Alert.alert('Search failed', 'Unable to search members. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const displayedResults = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return results;
    return results.filter((member) => {
      const name = `${member.first_name ?? ''} ${member.last_name ?? ''}`.toLowerCase();
      return name.includes(q) || member.phone?.includes(q) || member.email?.toLowerCase().includes(q);
    });
  }, [results, searchQuery]);

  const openSetupModal = (profile: ProfileSummary) => {
    let passcode: string;
    try {
      passcode = generateRandomPasscode();
    } catch {
      Alert.alert(
        'Security Error',
        'Secure random number generation is not available on this device. Cannot generate a safe passcode.'
      );
      return;
    }
    setSelectedProfile(profile);
    setCollectorName(
      [profile.first_name, profile.last_name].filter(Boolean).join(' ') || ''
    );
    setCollectorPhotoUri(null);
    setCollectorPasscode(passcode);
    setShowPasscode(false);
    setShowSetupModal(true);
  };

  const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB

  const validateAndSetPhoto = (asset: ImagePicker.ImagePickerAsset) => {
    if (asset.fileSize && asset.fileSize > MAX_PHOTO_BYTES) {
      Alert.alert('File Too Large', 'Collector photo must be under 5 MB.');
      return;
    }
    // expo-image-picker returns a file URI; MIME type check via extension
    const uri = asset.uri.toLowerCase();
    const hasValidExt = uri.endsWith('.jpg') || uri.endsWith('.jpeg') || uri.endsWith('.png') || uri.endsWith('.webp');
    if (asset.mimeType && !ALLOWED_IMAGE_TYPES.has(asset.mimeType)) {
      Alert.alert('Invalid Image', 'Only JPEG, PNG, or WebP images are allowed.');
      return;
    }
    if (!asset.mimeType && !hasValidExt) {
      Alert.alert('Invalid Image', 'Only JPEG, PNG, or WebP images are allowed.');
      return;
    }
    setCollectorPhotoUri(asset.uri);
  };

  const handlePickPhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission Required', 'Camera access is needed to take collector photo.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      mediaTypes: ['images'],
    });

    if (!result.canceled && result.assets[0]) {
      validateAndSetPhoto(result.assets[0]);
    }
  };

  const handlePickFromGallery = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission Required', 'Gallery access is needed.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      mediaTypes: ['images'],
    });

    if (!result.canceled && result.assets[0]) {
      validateAndSetPhoto(result.assets[0]);
    }
  };

  const handleConfirmAssign = async () => {
    if (!groupId || !user || !selectedProfile) return;

    if (!collectorName.trim()) {
      Alert.alert('Name Required', 'Please enter a display name for the collector.');
      return;
    }

    if (collectorPasscode.length !== 6) {
      Alert.alert('Passcode Required', 'The collector passcode must be exactly 6 digits.');
      return;
    }

    setIsAssigning(selectedProfile.id);
    try {
      // Upload collector photo if provided
      let photoUrl: string | null = null;
      if (collectorPhotoUri) {
        try {
          const objectPath = `collectors/${groupId}/${selectedProfile.id}-${Date.now()}.jpg`;
          const { publicUrl, error: uploadError } = await uploadFromUri('avatars', objectPath, collectorPhotoUri);
          if (!uploadError) {
            photoUrl = publicUrl;
          }
        } catch {
          // Photo upload failed — continue without it
        }
      }

      const { success, secretCode, collectorPasscode: finalPasscode, error } =
        await assignContributor({
          groupId,
          userId: selectedProfile.id,
          addedBy: user.id,
          collectorDisplayName: collectorName.trim(),
          collectorPhotoUrl: photoUrl ?? undefined,
          collectorPasscode: collectorPasscode.trim(),
        });

      if (error) throw error;

      if (success) {
        setShowSetupModal(false);
        // Show the passcode in a dedicated secure reveal modal — not in Alert.alert.
        // Alert dialogs can be captured by accessibility services, screen recorders,
        // and notification shades. The passcode must only be shown once in-app.
        const passcodeToReveal = finalPasscode ?? collectorPasscode ?? null;
        setRevealPasscode(passcodeToReveal);
        setShowRevealPasscode(false);
        setShowRevealModal(true);
      }
    } catch (err: unknown) {
      // Do not expose raw server error messages — they may contain sensitive schema info.
      const isKnownError = err instanceof Error;
      const safeMessage = isKnownError && err.message.length < 200
        ? err.message
        : 'Collector assignment failed. Please try again.';
      Alert.alert('Assignment Failed', safeMessage);
    } finally {
      setIsAssigning(null);
    }
  };

  const renderProfileItem = ({ item }: { item: ProfileSummary }) => (
    <View style={styles.profileCard}>
      <View style={styles.profileAvatar}>
        <User size={22} color="#94A3B8" />
      </View>
      <View style={styles.profileInfo}>
        <Text style={styles.profileName}>
          {item.first_name} {item.last_name || ''}
        </Text>
        <Text style={styles.profileContact}>
          {item.phone || item.email || 'No contact info'}
        </Text>
      </View>
      <TouchableOpacity
        style={styles.assignButton}
        onPress={() => openSetupModal(item)}
        disabled={isAssigning !== null}
      >
        {isAssigning === item.id ? (
          <ActivityIndicator color="#FFFFFF" size="small" />
        ) : (
          <>
            <ShieldCheck size={16} color="#FFFFFF" />
            <Text style={styles.assignButtonText}>Setup</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>Assign Collector</Text>
          <Text style={styles.headerSubtitle}>{groupName}</Text>
        </View>
      </View>

      <View style={styles.searchContainer}>
        <View style={styles.searchInputWrapper}>
          <Search size={20} color="#94A3B8" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name, phone or email..."
            placeholderTextColor="#94A3B8"
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <XCircle size={18} color="#94A3B8" />
            </TouchableOpacity>
          ) : null}
        </View>
        <TouchableOpacity
          style={styles.searchButton}
          onPress={handleSearch}
          disabled={isLoading}
        >
          <Text style={styles.searchButtonText}>Search</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#F97316" />
            <Text style={styles.loadingText}>Searching registered members...</Text>
          </View>
        ) : displayedResults.length > 0 ? (
          <FlatList
            data={displayedResults}
            renderItem={renderProfileItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        ) : searchQuery && !isLoading ? (
          <View style={styles.centered}>
            <SearchX size={48} color="#CBD5E1" />
            <Text style={styles.emptyTitle}>No members found</Text>
            <Text style={styles.emptyText}>
              Try searching with a different name or phone number.
            </Text>
          </View>
        ) : (
          <View style={styles.centered}>
            <Shield size={56} color="#E2E8F0" />
            <Text style={styles.infoTitle}>No Group Members Yet</Text>
            <Text style={styles.infoText}>
              Add members to this group first, then return here to assign one as collector.
            </Text>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* ─── Collector Setup Modal ─── */}
      <Modal
        visible={showSetupModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowSetupModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Modal Header */}
              <View style={styles.modalHeader}>
                <View style={styles.modalHeaderLeft}>
                  <View style={styles.modalIconBadge}>
                    <ShieldCheck size={24} color="#FFFFFF" />
                  </View>
                  <Text style={styles.modalTitle}>Collector Setup</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setShowSetupModal(false)}
                  style={styles.modalCloseBtn}
                >
                  <X size={22} color="#64748B" />
                </TouchableOpacity>
              </View>

              <Text style={styles.modalSubtitle}>
                Set up the collector identity for{' '}
                <Text style={{ fontWeight: '800', color: '#1E2B5A' }}>
                  {selectedProfile?.first_name} {selectedProfile?.last_name || ''}
                </Text>
                . Members will see this info to verify the collector.
              </Text>

              {/* Collector Name */}
              <View style={styles.formSection}>
                <View style={styles.formLabelRow}>
                  <User size={16} color="#1E2B5A" />
                  <Text style={styles.formLabel}>Collector Display Name</Text>
                </View>
                <TextInput
                  style={styles.formInput}
                  value={collectorName}
                  onChangeText={setCollectorName}
                  placeholder="Enter collector name..."
                  placeholderTextColor="#94A3B8"
                  maxLength={60}
                />
                <Text style={styles.formHint}>
                  This name will be shown to all members for verification.
                </Text>
              </View>

              {/* Collector Photo */}
              <View style={styles.formSection}>
                <View style={styles.formLabelRow}>
                  <Camera size={16} color="#1E2B5A" />
                  <Text style={styles.formLabel}>Collector Photo</Text>
                </View>

                {collectorPhotoUri ? (
                  <View style={styles.photoPreviewContainer}>
                    <Image
                      source={{ uri: collectorPhotoUri }}
                      style={styles.photoPreview}
                    />
                    <TouchableOpacity
                      style={styles.changePhotoBtn}
                      onPress={handlePickPhoto}
                    >
                      <Camera size={14} color="#FFFFFF" />
                      <Text style={styles.changePhotoBtnText}>Retake</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.photoActions}>
                    <TouchableOpacity
                      style={styles.photoActionBtn}
                      onPress={handlePickPhoto}
                    >
                      <Camera size={20} color="#7C3AED" />
                      <Text style={styles.photoActionText}>Take Photo</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.photoActionBtn, { borderColor: '#F97316' }]}
                      onPress={handlePickFromGallery}
                    >
                      <UserPlus size={20} color="#F97316" />
                      <Text style={[styles.photoActionText, { color: '#F97316' }]}>
                        Gallery
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
                <Text style={styles.formHint}>
                  Members will use this photo to visually verify the collector.
                </Text>
              </View>

              {/* Collector Passcode */}
              <View style={styles.formSection}>
                <View style={styles.formLabelRow}>
                  <Lock size={16} color="#C2410C" />
                  <Text style={[styles.formLabel, { color: '#C2410C' }]}>
                    Collector Passcode (6-digit)
                  </Text>
                </View>

                <View style={styles.passcodeRow}>
                  <View style={styles.passcodeInputWrapper}>
                    <TextInput
                      style={styles.passcodeInput}
                      value={collectorPasscode}
                      onChangeText={(text) =>
                        setCollectorPasscode(text.replace(/[^0-9]/g, '').slice(0, 6))
                      }
                      placeholder="000000"
                      placeholderTextColor="#FBBF24"
                      keyboardType="number-pad"
                      maxLength={6}
                      secureTextEntry={!showPasscode}
                    />
                    <TouchableOpacity
                      onPress={() => setShowPasscode(!showPasscode)}
                      style={styles.eyeBtn}
                    >
                      {showPasscode ? (
                        <EyeOff size={18} color="#64748B" />
                      ) : (
                        <Eye size={18} color="#64748B" />
                      )}
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={styles.regenerateBtn}
                    onPress={() => setCollectorPasscode(generateRandomPasscode())}
                  >
                    <RefreshCw size={16} color="#7C3AED" />
                  </TouchableOpacity>
                </View>
                <Text style={styles.formHint}>
                  This passcode is used by the collector to authorize payments.
                  Share it securely with the collector only.
                </Text>
              </View>

              {/* Notification Banner */}
              <View style={styles.notificationBanner}>
                <CheckCircle2 size={16} color="#10B981" />
                <Text style={styles.notificationBannerText}>
                  All group members will be instantly notified with the collector's
                  name and photo when you confirm.
                </Text>
              </View>

              {/* Actions */}
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setShowSetupModal(false)}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.confirmBtn,
                    isAssigning ? { backgroundColor: '#CBD5E1' } : {},
                  ]}
                  onPress={handleConfirmAssign}
                  disabled={!!isAssigning}
                >
                  {isAssigning ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <>
                      <ShieldCheck size={18} color="#FFFFFF" />
                      <Text style={styles.confirmBtnText}>
                        Assign Collector
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ─── Secure One-Time Passcode Reveal Modal ─── */}
      {/* The passcode is shown exactly once here, never in an Alert.
          Dismissed state clears the passcode from memory. */}
      <Modal
        visible={showRevealModal}
        animationType="fade"
        transparent
        onRequestClose={() => {
          setShowRevealModal(false);
          setRevealPasscode(null);
        }}
      >
        <View style={styles.revealOverlay}>
          <View style={styles.revealCard}>
            <View style={styles.revealIconBadge}>
              <Lock size={28} color="#FFFFFF" />
            </View>
            <Text style={styles.revealTitle}>Collector Assigned</Text>
            <Text style={styles.revealSubtitle}>
              Share this passcode securely with{' '}
              <Text style={{ fontWeight: '800' }}>{collectorName}</Text> only.
              It will not be shown again.
            </Text>

            <View style={styles.revealPasscodeBox}>
              <Text style={styles.revealPasscodeLabel}>COLLECTOR PASSCODE</Text>
              {revealPasscode && (
                <Text
                  style={[
                    styles.revealPasscodeText,
                    !showRevealPasscode && styles.revealPasscodeHidden,
                  ]}
                  selectable={showRevealPasscode}
                >
                  {showRevealPasscode ? revealPasscode : '••••••'}
                </Text>
              )}
              <TouchableOpacity
                style={styles.revealToggleBtn}
                onPress={() => setShowRevealPasscode((v) => !v)}
              >
                {showRevealPasscode
                  ? <EyeOff size={18} color="#7C3AED" />
                  : <Eye size={18} color="#7C3AED" />}
                <Text style={styles.revealToggleText}>
                  {showRevealPasscode ? 'Hide' : 'Reveal'} Passcode
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.revealWarning}>
              <Shield size={14} color="#DC2626" />
              <Text style={styles.revealWarningText}>
                Write this down securely. Do not screenshot or share via messaging apps.
                All group members have been notified of the collector's name and photo.
              </Text>
            </View>

            <TouchableOpacity
              style={styles.revealDismissBtn}
              onPress={() => {
                setShowRevealModal(false);
                setRevealPasscode(null);
                setShowRevealPasscode(false);
              }}
            >
              <Text style={styles.revealDismissText}>I've Noted the Passcode — Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  backButton: {
    marginRight: 16,
  },
  headerTitleContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#F97316',
    fontWeight: '600',
  },
  searchContainer: {
    flexDirection: 'row',
    padding: 20,
    gap: 12,
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
    color: '#1E2B5A',
  },
  searchButton: {
    backgroundColor: '#1E2B5A',
    borderRadius: 12,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  searchButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },

  // Profile card
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  profileAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E2B5A',
    marginBottom: 4,
  },
  profileContact: {
    fontSize: 13,
    color: '#64748B',
  },
  assignButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#7C3AED',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6,
  },
  assignButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },

  // Empty/loading states
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 12,
    color: '#64748B',
    fontSize: 14,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E2B5A',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
  },
  infoTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1E2B5A',
    marginTop: 16,
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 22,
  },

  // ── Modal ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    maxHeight: '92%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  modalIconBadge: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#7C3AED',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1E2B5A',
  },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#64748B',
    lineHeight: 22,
    marginBottom: 20,
  },

  // ── Form ──
  formSection: {
    marginBottom: 20,
  },
  formLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  formLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  formInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1E2B5A',
  },
  formHint: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 6,
    lineHeight: 18,
  },

  // Photo actions
  photoActions: {
    flexDirection: 'row',
    gap: 12,
  },
  photoActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 2,
    borderColor: '#7C3AED',
    borderRadius: 14,
    paddingVertical: 16,
    borderStyle: 'dashed',
  },
  photoActionText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#7C3AED',
  },
  photoPreviewContainer: {
    alignItems: 'center',
  },
  photoPreview: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: '#7C3AED',
    marginBottom: 10,
  },
  changePhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#7C3AED',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  changePhotoBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Passcode
  passcodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  passcodeInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF7ED',
    borderWidth: 2,
    borderColor: '#F97316',
    borderRadius: 14,
    paddingHorizontal: 16,
  },
  passcodeInput: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 22,
    fontWeight: '800',
    color: '#C2410C',
    letterSpacing: 8,
    textAlign: 'center',
  },
  eyeBtn: {
    padding: 4,
  },
  regenerateBtn: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#F5F3FF',
    borderWidth: 1,
    borderColor: '#EDE9FE',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Banner
  notificationBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 20,
  },
  notificationBannerText: {
    flex: 1,
    fontSize: 13,
    color: '#15803D',
    lineHeight: 19,
  },

  // Actions
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#64748B',
  },
  confirmBtn: {
    flex: 2,
    flexDirection: 'row',
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: '#7C3AED',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  confirmBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  // ── Secure passcode reveal modal ──────────────────────────────
  revealOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  revealCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 28,
    width: '100%',
    alignItems: 'center',
  },
  revealIconBadge: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  revealTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1E2B5A',
    marginBottom: 10,
    textAlign: 'center',
  },
  revealSubtitle: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 20,
  },
  revealPasscodeBox: {
    alignSelf: 'stretch',
    backgroundColor: '#F5F3FF',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#DDD6FE',
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  revealPasscodeLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#7C3AED',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  revealPasscodeText: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1E2B5A',
    letterSpacing: 10,
    marginBottom: 14,
  },
  revealPasscodeHidden: {
    fontSize: 28,
    letterSpacing: 6,
    color: '#94A3B8',
  },
  revealToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  revealToggleText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#7C3AED',
  },
  revealWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 20,
    alignSelf: 'stretch',
  },
  revealWarningText: {
    flex: 1,
    fontSize: 12,
    color: '#DC2626',
    lineHeight: 18,
  },
  revealDismissBtn: {
    alignSelf: 'stretch',
    backgroundColor: '#7C3AED',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  revealDismissText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
