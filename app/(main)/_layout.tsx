import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronRight,
  Globe,
  HelpCircle,
  Home,
  Lock,
  LogOut,
  Moon,
  Phone,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  User,
  X,
} from 'lucide-react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useAuthStore } from '../../src/store/authStore';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';
import { fetchProfile } from '../../src/services/profileService';
import { GroupListItem, listGroupsForUser } from '../../src/services/groupService';
import {
  getCredentialDisplayName,
  getProfileFirstName,
  getProfileInitials,
  isPlaceholderProfileName,
  normalizeProfileName,
} from '../../src/utils/profileName';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.82, 340);

export default function MainTabsLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuthStore();
  const {
    profile,
    notifications,
    preferences,
    disputes,
    receipts,
    savingsGoals,
    vaultTransactions,
    linkedMobileMoneyAccounts,
    linkedBankAccounts,
    initializeForUser,
    updateProfile,
    setProfileAvatar,
    updatePreferences,
  } = useAppDataStore();

  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;

  const [drawerOpen, setDrawerOpen] = useState(false);
  const slideAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  // ── Header search ──────────────────────────────────────────
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchWidth = useRef(new Animated.Value(0)).current;
  const searchInputRef = useRef<TextInput>(null);

  const openSearch = useCallback(() => {
    setSearchActive(true);
    Animated.spring(searchWidth, { toValue: 1, useNativeDriver: false, speed: 18, bounciness: 3 }).start(
      () => searchInputRef.current?.focus()
    );
  }, [searchWidth]);

  const closeSearch = useCallback(() => {
    searchInputRef.current?.blur();
    Animated.timing(searchWidth, { toValue: 0, duration: 200, useNativeDriver: false }).start(() => {
      setSearchActive(false);
      setSearchQuery('');
    });
  }, [searchWidth]);

  const submitSearch = useCallback(() => {
    const q = searchQuery.trim();
    closeSearch();
    setTimeout(() => {
      router.push(q ? `/(groups)/discover?q=${encodeURIComponent(q)}` as never : '/(groups)/discover' as never);
    }, 240);
  }, [closeSearch, router, searchQuery]);

  // ── Header layout height (used to position the search overlay) ──
  const [headerHeight, setHeaderHeight] = useState(0);

  // ── Fetched group list (for search) ────────────────────────────
  const [groups, setGroups] = useState<GroupListItem[]>([]);

  useEffect(() => {
    if (!user?.id) return;
    listGroupsForUser(user.id).then(({ groups: g }) => setGroups(g)).catch(() => {});
  }, [user?.id]);

  // ── Live search results memo ────────────────────────────────────
  const searchResults = useMemo(() => {
    const q = searchQuery.trim();
    if (q.length < 1) return { groups: [], savings: [], transactions: [], total: 0 };
    const qLow = q.toLowerCase();

    const matchedGroups = groups
      .filter(g => g.name.toLowerCase().includes(qLow))
      .slice(0, 4);

    const matchedSavings = savingsGoals
      .filter(s =>
        s.title.toLowerCase().includes(qLow) ||
        s.category.toLowerCase().includes(qLow)
      )
      .slice(0, 4);

    const matchedTxns = vaultTransactions
      .filter(t =>
        t.description.toLowerCase().includes(qLow) ||
        (t.groupName != null && t.groupName.toLowerCase().includes(qLow))
      )
      .slice(0, 3);

    return {
      groups: matchedGroups,
      savings: matchedSavings,
      transactions: matchedTxns,
      total: matchedGroups.length + matchedSavings.length + matchedTxns.length,
    };
  }, [searchQuery, groups, savingsGoals, vaultTransactions]);

  useEffect(() => {
    initializeForUser(user);
  }, [initializeForUser, user]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (!user?.id) return;
      const { profile: remoteProfile } = await fetchProfile(user.id);
      if (!mounted || !remoteProfile) return;

      const currentProfile = useAppDataStore.getState().profile;
      const remoteName = normalizeProfileName(
        [remoteProfile.first_name, remoteProfile.last_name]
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .join(' ')
      );
      const currentName = normalizeProfileName(currentProfile.fullName);
      const credentialName = getCredentialDisplayName(
        remoteProfile.email ?? user.email ?? currentProfile.email,
        remoteProfile.phone ?? user.phone ?? currentProfile.phone
      );

      const resolvedName = !isPlaceholderProfileName(remoteName)
        ? remoteName
        : !isPlaceholderProfileName(currentName)
          ? currentName
          : credentialName;

      updateProfile({
        fullName: resolvedName,
        email: remoteProfile.email ?? user.email ?? currentProfile.email,
        phone: remoteProfile.phone ?? user.phone ?? currentProfile.phone,
        verificationStatus: remoteProfile.kyc_status === 'approved' ? 'Verified' : 'Pending',
      });

      if (remoteProfile.avatar_url) {
        setProfileAvatar(remoteProfile.avatar_url);
      }
    };

    void run();
    return () => {
      mounted = false;
    };
  }, [setProfileAvatar, updateProfile, user]);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.read).length,
    [notifications]
  );

  const credentialName = useMemo(
    () => getCredentialDisplayName(profile.email, profile.phone),
    [profile.email, profile.phone]
  );

  const profileInitials = useMemo(
    () => getProfileInitials(profile.fullName, credentialName),
    [credentialName, profile.fullName]
  );

  const displayName = useMemo(
    () =>
      isPlaceholderProfileName(profile.fullName)
        ? credentialName
        : normalizeProfileName(profile.fullName),
    [credentialName, profile.fullName]
  );

  const firstName = useMemo(
    () => getProfileFirstName(profile.fullName, credentialName),
    [credentialName, profile.fullName]
  );

  const openDisputes = useMemo(
    () => disputes.filter((d) => d.status === 'open' || d.status === 'under_review').length,
    [disputes]
  );

  const openDrawer = useCallback(() => {
    setDrawerOpen(true);
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 4,
        speed: 14,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 260,
        useNativeDriver: true,
      }),
    ]).start();
  }, [backdropOpacity, slideAnim]);

  const closeDrawer = useCallback(() => {
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: -DRAWER_WIDTH,
        useNativeDriver: true,
        bounciness: 0,
        speed: 18,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start(() => setDrawerOpen(false));
  }, [backdropOpacity, slideAnim]);

  const handleSignOut = async () => {
    closeDrawer();
    await logout();
    router.replace('/(auth)/login');
  };

  const navigate = (path: string) => {
    closeDrawer();
    setTimeout(() => router.push(path as never), 240);
  };

  const bottomInset = Math.max(insets.bottom, 14);

  const HeaderBar = () => (
    <View style={[styles.headerBar, { paddingTop: Math.max(insets.top, 8) + 8, backgroundColor: C.bg }]}>
      {/* Profile button + name — opens slide-out drawer */}
      {!searchActive && (
        <TouchableOpacity
          style={styles.profileRow}
          onPress={openDrawer}
          activeOpacity={0.8}
        >
          {/* Avatar */}
          <View style={styles.profilePhotoWrap}>
            {profile.avatarUrl ? (
              <Image source={{ uri: profile.avatarUrl }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitials}>{profileInitials}</Text>
              </View>
            )}
            <View style={styles.onlineDot} />
          </View>
          {/* Name block */}
          <View style={styles.nameBlock}>
            <Text style={[styles.greetingText, { color: C.textMuted }]}>Welcome back</Text>
            <Text style={[styles.usernameText, { color: C.text }]} numberOfLines={1}>{firstName}</Text>
          </View>
        </TouchableOpacity>
      )}

      {/* Spacer so bell stays right when search is inactive */}
      {!searchActive && <View style={{ flex: 1 }} />}

      {/* Animated inline search input */}
      {searchActive && (
        <Animated.View
          style={[
            styles.searchInputWrap,
            {
              flex: searchWidth.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }) as unknown as number,
              opacity: searchWidth,
              backgroundColor: C.iconBg,
            },
          ]}
        >
          <Search size={15} color={C.textMuted} style={{ marginRight: 6 }} />
          <TextInput
            ref={searchInputRef}
            style={[styles.searchInputField, { color: C.text }]}
            placeholder="Search Osusu, savings…"
            placeholderTextColor={C.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            onSubmitEditing={submitSearch}
            autoFocus={false}
          />
          <TouchableOpacity onPress={closeSearch} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <X size={16} color="#9CA3AF" />
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Search icon (compact, shown when not active) */}
      {!searchActive && (
        <TouchableOpacity
          style={[styles.searchIconBtn, { backgroundColor: C.iconBg }]}
          onPress={openSearch}
          activeOpacity={0.75}
        >
          <Search size={20} color={C.textSub} />
        </TouchableOpacity>
      )}

      {/* Notification bell */}
      <TouchableOpacity
        style={styles.bellButton}
        onPress={() => router.push('/components/notifications')}
        activeOpacity={0.8}
      >
        <FontAwesome name="bell-o" size={22} color={C.textSub} />
        {unreadCount > 0 ? (
          <View style={styles.notificationBadge}>
            <Text style={styles.notificationBadgeText}>{Math.min(99, unreadCount)}</Text>
          </View>
        ) : null}
      </TouchableOpacity>
    </View>
  );

  /* ─── Drawer ───────────────────────────────────────────────── */
  const DrawerNavItem = ({
    icon,
    label,
    subtitle,
    path,
    badge,
  }: {
    icon: React.ReactNode;
    label: string;
    subtitle?: string;
    path: string;
    badge?: number;
  }) => (
    <TouchableOpacity style={styles.drawerItem} onPress={() => navigate(path)} activeOpacity={0.75}>
      <View style={[styles.drawerItemIcon, { backgroundColor: C.bgSoft }]}>{icon}</View>
      <View style={styles.drawerItemText}>
        <Text style={[styles.drawerItemLabel, { color: C.text }]}>{label}</Text>
        {subtitle ? <Text style={[styles.drawerItemSub, { color: C.textSub }]}>{subtitle}</Text> : null}
      </View>
      {badge !== undefined && badge > 0 ? (
        <View style={styles.drawerBadge}>
          <Text style={styles.drawerBadgeText}>{badge}</Text>
        </View>
      ) : (
        <ChevronRight size={16} color={C.textMuted} />
      )}
    </TouchableOpacity>
  );

  // ── Highlight matching substring inside a result name ──────────
  const HighlightText = ({ text, nameStyle }: { text: string; nameStyle?: object }) => {
    const q = searchQuery.trim();
    const qLow = q.toLowerCase();
    const lowerText = text.toLowerCase();
    const idx = q.length > 0 ? lowerText.indexOf(qLow) : -1;
    if (idx === -1) {
      return <Text style={[styles.searchResultName, { color: C.text }, nameStyle]}>{text}</Text>;
    }
    return (
      <Text style={[styles.searchResultName, { color: C.text }, nameStyle]}>
        {text.slice(0, idx)}
        <Text style={styles.searchResultHighlight}>{text.slice(idx, idx + q.length)}</Text>
        {text.slice(idx + q.length)}
      </Text>
    );
  };

  // ── Navigate from a search result then close search ────────────
  const navigateFromSearch = useCallback((path: string) => {
    closeSearch();
    setTimeout(() => router.push(path as never), 80);
  }, [closeSearch, router]);

  return (
    <View style={[styles.container, { backgroundColor: C.bg }]}>
      <View onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
        {HeaderBar()}
      </View>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: '#F97316',
          tabBarInactiveTintColor: '#6B7280',
          tabBarStyle: {
            backgroundColor: C.tabBar,
            paddingBottom: bottomInset,
            paddingTop: 10,
            height: 62 + bottomInset,
            borderTopWidth: 1,
            borderTopColor: C.tabBorder,
          },
          tabBarItemStyle: {
            flex: 1,
            paddingVertical: 6,
            alignItems: 'center',
            justifyContent: 'center',
          },
          tabBarLabelStyle: {
            fontSize: 12,
            fontWeight: '600',
            marginTop: 4,
          },
        }}
      >
        <Tabs.Screen
          name="home"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, focused }) => <Home color={color} size={focused ? 28 : 24} />,
          }}
        />
        <Tabs.Screen
          name="vault"
          options={{
            title: 'Vault',
            tabBarIcon: ({ color, focused }) => <FontAwesome name="bank" size={focused ? 28 : 24} color={color} />,
          }}
        />
        <Tabs.Screen
          name="groups"
          options={{
            title: 'Osusu',
            tabBarIcon: ({ color, focused }) => <FontAwesome name="group" size={focused ? 28 : 24} color={color} />,
          }}
        />
        <Tabs.Screen
          name="savings"
          options={{
            title: 'Savings',
            tabBarIcon: ({ color, focused }) => (
              <MaterialIcons name="savings" size={focused ? 28 : 24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="savings-create"
          options={{
            href: null,
          }}
        />
      </Tabs>

      {/* ── Live Search Results Overlay ────────────────────────── */}
      {searchActive && searchQuery.trim().length > 0 && (
        <View style={[styles.searchOverlay, { top: headerHeight, backgroundColor: C.bg, borderTopColor: C.border }]}>
          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Groups */}
            {searchResults.groups.length > 0 && (
              <>
                <View style={styles.searchSection}>
                  <FontAwesome name="group" size={11} color="#9CA3AF" />
                  <Text style={styles.searchSectionLabel}>OSUSU GROUPS</Text>
                </View>
                {searchResults.groups.map((g) => (
                  <TouchableOpacity
                    key={g.id}
                    style={styles.searchResultRow}
                    activeOpacity={0.7}
                    onPress={() => navigateFromSearch(`/(groups)/${g.id}`)}
                  >
                    <View style={[styles.searchResultIcon, { backgroundColor: '#FFF7ED' }]}>
                      <FontAwesome name="group" size={16} color="#F97316" />
                    </View>
                    <View style={styles.searchResultInfo}>
                      <HighlightText text={g.name} />
                      <Text style={[styles.searchResultSub, { color: C.textSub }]} numberOfLines={1}>
                        {g.members} members · {g.frequency}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {/* Savings Goals */}
            {searchResults.savings.length > 0 && (
              <>
                <View style={styles.searchSection}>
                  <MaterialIcons name="savings" size={11} color="#9CA3AF" />
                  <Text style={styles.searchSectionLabel}>SAVINGS GOALS</Text>
                </View>
                {searchResults.savings.map((s) => (
                  <TouchableOpacity
                    key={s.id}
                    style={styles.searchResultRow}
                    activeOpacity={0.7}
                    onPress={() => navigateFromSearch('/(main)/savings')}
                  >
                    <View style={[styles.searchResultIcon, { backgroundColor: '#EFF6FF' }]}>
                      <MaterialIcons name="savings" size={16} color="#3B82F6" />
                    </View>
                    <View style={styles.searchResultInfo}>
                      <HighlightText text={s.title} />
                      <Text style={[styles.searchResultSub, { color: C.textSub }]} numberOfLines={1}>
                        {s.category} · {s.status}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {/* Vault Transactions */}
            {searchResults.transactions.length > 0 && (
              <>
                <View style={styles.searchSection}>
                  <FontAwesome name="bank" size={11} color="#9CA3AF" />
                  <Text style={styles.searchSectionLabel}>VAULT TRANSACTIONS</Text>
                </View>
                {searchResults.transactions.map((t) => (
                  <TouchableOpacity
                    key={t.id}
                    style={styles.searchResultRow}
                    activeOpacity={0.7}
                    onPress={() => navigateFromSearch('/(main)/vault')}
                  >
                    <View style={[styles.searchResultIcon, { backgroundColor: '#F5F3FF' }]}>
                      <FontAwesome name="bank" size={16} color="#8B5CF6" />
                    </View>
                    <View style={styles.searchResultInfo}>
                      <HighlightText text={t.description} />
                      <Text style={[styles.searchResultSub, { color: C.textSub }]} numberOfLines={1}>
                        {t.groupName ?? t.type} · {t.status}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {/* Empty state */}
            {searchResults.total === 0 && (
              <View style={styles.searchEmpty}>
                <Search size={26} color={C.borderStrong} />
                <Text style={[styles.searchEmptyTitle, { color: C.text }]}>No results found</Text>
                <Text style={[styles.searchEmptyText, { color: C.textMuted }]}>
                  Nothing matched "{searchQuery.trim()}"
                </Text>
              </View>
            )}

            {/* Bottom padding */}
            <View style={{ height: 8 }} />
          </ScrollView>
        </View>
      )}

      {/* ── Profile Slide-Out Drawer ─────────────────────────── */}
      {drawerOpen && (
        <Modal transparent visible={drawerOpen} animationType="none" onRequestClose={closeDrawer}>
          {/* Backdrop */}
          <Animated.View style={[styles.drawerBackdrop, { opacity: backdropOpacity }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeDrawer} />
          </Animated.View>

          {/* Drawer panel */}
          <Animated.View
            style={[
              styles.drawerPanel,
              {
                transform: [{ translateX: slideAnim }],
                paddingTop: insets.top + 16,
                paddingBottom: insets.bottom + 24,
                backgroundColor: C.bg,
              },
            ]}
          >
            {/* Close button */}
            <TouchableOpacity style={styles.drawerClose} onPress={closeDrawer}>
              <X size={20} color="#6B7280" />
            </TouchableOpacity>

            {/* Avatar & name */}
            <View style={styles.drawerProfile}>
              <TouchableOpacity
                onPress={() => navigate('/components/profile')}
                activeOpacity={0.85}
              >
                {profile.avatarUrl ? (
                  <Image source={{ uri: profile.avatarUrl }} style={styles.drawerAvatar} />
                ) : (
                  <View style={styles.drawerAvatarFallback}>
                    <Text style={styles.drawerAvatarText}>{profileInitials}</Text>
                  </View>
                )}
              </TouchableOpacity>
              <View style={styles.drawerProfileInfo}>
                <Text style={[styles.drawerProfileName, { color: C.text }]} numberOfLines={1}>
                  {displayName}
                </Text>
                <Text style={[styles.drawerProfileSub, { color: C.textSub }]} numberOfLines={1}>
                  {profile.email || profile.phone || 'Member'}
                </Text>
                <View style={styles.drawerVerifyBadge}>
                  <ShieldCheck size={12} color="#10B981" />
                  <Text style={styles.drawerVerifyText}>{profile.verificationStatus}</Text>
                </View>
              </View>
            </View>

            <View style={[styles.drawerDivider, { backgroundColor: C.border }]} />

            <ScrollView showsVerticalScrollIndicator={false} style={styles.drawerScroll}>
              {/* Account */}
              <Text style={[styles.drawerSectionLabel, { color: C.textMuted }]}>ACCOUNT</Text>
              <DrawerNavItem
                icon={<User size={18} color="#000000" />}
                label="My Profile"
                subtitle={firstName}
                path="/components/profile"
              />
              <DrawerNavItem
                icon={<Shield size={18} color="#000000" />}
                label="KYC Verification"
                subtitle={profile.verificationStatus}
                path="/(kyc)/id-photos"
              />
              <DrawerNavItem
                icon={<Phone size={18} color="#000000" />}
                label="Payment Methods"
                subtitle={`${linkedMobileMoneyAccounts.length + linkedBankAccounts.length} linked`}
                path="/components/payment-methods"
              />

              <View style={[styles.drawerDivider, { backgroundColor: C.border }]} />

              {/* Activity */}
              <Text style={[styles.drawerSectionLabel, { color: C.textMuted }]}>ACTIVITY</Text>
              <DrawerNavItem
                icon={<FontAwesome name="bell-o" size={18} color="#000000" />}
                label="Notifications"
                subtitle={
                  unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'
                }
                path="/components/notifications"
                badge={unreadCount}
              />
              <DrawerNavItem
                icon={<Shield size={18} color="#000000" />}
                label="Disputes"
                subtitle={`${openDisputes} active`}
                path="/components/disputes"
                badge={openDisputes}
              />
              <DrawerNavItem
                icon={<FontAwesome name="bank" size={18} color="#000000" />}
                label="Payment Receipts"
                subtitle={`${receipts.length} stored`}
                path="/components/receipts"
              />

              <View style={[styles.drawerDivider, { backgroundColor: C.border }]} />

              {/* Settings */}
              <Text style={[styles.drawerSectionLabel, { color: C.textMuted }]}>SETTINGS</Text>
              <DrawerNavItem
                icon={<Settings size={18} color="#6B7280" />}
                label="Settings"
                subtitle="Security, preferences and more"
                path="/components/settings"
              />
              <DrawerNavItem
                icon={<Lock size={18} color="#6B7280" />}
                label="Change Password"
                path="/(settings)/change-password"
              />
              <DrawerNavItem
                icon={<Moon size={18} color="#6B7280" />}
                label="Dark Mode"
                subtitle={preferences.darkMode ? 'Enabled' : 'Disabled'}
                path="/components/settings"
              />

              <View style={[styles.drawerDivider, { backgroundColor: C.border }]} />

              {/* Support */}
              <Text style={[styles.drawerSectionLabel, { color: C.textMuted }]}>SUPPORT</Text>
              <DrawerNavItem
                icon={<HelpCircle size={18} color="#6B7280" />}
                label="Help Center"
                path="/(settings)/help"
              />
              <DrawerNavItem
                icon={<Globe size={18} color="#6B7280" />}
                label="Terms & Privacy"
                path="/(settings)/terms"
              />

              <View style={[styles.drawerDivider, { backgroundColor: C.border }]} />

              {/* Sign Out */}
              <TouchableOpacity
                style={styles.drawerSignOut}
                onPress={() => void handleSignOut()}
                activeOpacity={0.8}
              >
                <LogOut size={18} color="#EF4444" />
                <Text style={styles.drawerSignOutText}>Sign Out</Text>
              </TouchableOpacity>
            </ScrollView>
          </Animated.View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    gap: 10,
  },
  /* Profile row (avatar + name, tappable) */
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  nameBlock: {
    flexShrink: 1,
  },
  greetingText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#9CA3AF',
    letterSpacing: 0.2,
  },
  usernameText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1E2B5A',
    letterSpacing: -0.3,
  },

  /* Profile avatar */
  profilePhotoWrap: {
    position: 'relative',
  },
  avatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#F97316',
  },
  avatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FDBA74',
  },
  avatarInitials: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  onlineDot: {
    position: 'absolute',
    right: 1,
    bottom: 1,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#10B981',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },

  /* Search icon (collapsed state) */
  searchIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },

  /* Animated inline search input (expanded state) */
  searchInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginRight: 6,
    overflow: 'hidden',
  },
  searchInputField: {
    flex: 1,
    fontSize: 13,
    color: '#1E2B5A',
    paddingVertical: 0,
  },

  /* Bell */
  bellButton: {
    padding: 4,
    position: 'relative',
  },
  notificationBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
  },

  /* ── Drawer ──────────────────────────────────── */
  drawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  drawerPanel: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 6, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 24,
  },
  drawerClose: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  drawerProfile: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 8,
  },
  drawerAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 3,
    borderColor: '#F97316',
    marginRight: 14,
  },
  drawerAvatarFallback: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    borderWidth: 3,
    borderColor: '#FDBA74',
  },
  drawerAvatarText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
  },
  drawerProfileInfo: {
    flex: 1,
  },
  drawerProfileName: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1E2B5A',
    marginBottom: 2,
  },
  drawerProfileSub: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 6,
  },
  drawerVerifyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 9,
    alignSelf: 'flex-start',
  },
  drawerVerifyText: {
    marginLeft: 4,
    color: '#059669',
    fontSize: 11,
    fontWeight: '700',
  },
  drawerDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginHorizontal: 20,
    marginVertical: 10,
  },
  drawerScroll: {
    flex: 1,
    paddingHorizontal: 12,
  },
  drawerSectionLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#9CA3AF',
    letterSpacing: 1.2,
    marginLeft: 8,
    marginTop: 6,
    marginBottom: 4,
  },
  drawerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 2,
  },
  drawerItemIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  drawerItemText: {
    flex: 1,
  },
  drawerItemLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  drawerItemSub: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 1,
  },
  drawerBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  drawerBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  drawerSignOut: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    marginTop: 8,
    marginBottom: 8,
    marginHorizontal: 8,
  },
  drawerSignOutText: {
    marginLeft: 10,
    color: '#EF4444',
    fontWeight: '700',
    fontSize: 14,
  },

  /* ── Search overlay ──────────────────────────────────────────── */
  searchOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    maxHeight: 420,
    backgroundColor: '#FFFFFF',
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.10,
    shadowRadius: 18,
    elevation: 20,
    zIndex: 200,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    overflow: 'hidden',
  },
  searchSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 5,
  },
  searchSectionLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#9CA3AF',
    letterSpacing: 1.2,
  },
  searchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  searchResultIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    flexShrink: 0,
  },
  searchResultInfo: {
    flex: 1,
    minWidth: 0,
  },
  searchResultName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E2B5A',
  },
  searchResultHighlight: {
    backgroundColor: '#FEF3C7',
    color: '#92400E',
    fontWeight: '800',
  },
  searchResultSub: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 1,
  },
  searchEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
    gap: 6,
  },
  searchEmptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#374151',
    marginTop: 4,
  },
  searchEmptyText: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
  },
});
