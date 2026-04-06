import React, { useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, Wallet, Users, TrendingUp, User, Bell, ShieldCheck } from 'lucide-react-native';
import { useAuthStore } from '../../stores/authStore';
import { useAppDataStore } from '../../stores/appDataStore';
import { fetchProfile } from '../../lib/profileService';
import {
  getCredentialDisplayName,
  getProfileFirstName,
  isPlaceholderProfileName,
  normalizeProfileName,
} from '../../lib/profileName';

export default function MainTabsLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const {
    profile,
    notifications,
    initializeForUser,
    updateProfile,
    setProfileAvatar,
  } = useAppDataStore();

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
  const firstName = useMemo(
    () => getProfileFirstName(profile.fullName, credentialName),
    [credentialName, profile.fullName]
  );

  const bottomInset = Math.max(insets.bottom, 14);

  const HeaderBar = () => (
    <View style={[styles.headerBar, { paddingTop: Math.max(insets.top, 8) + 8 }]}>
      <View style={styles.userInfo}>
        <TouchableOpacity
          style={styles.profilePhoto}
          onPress={() => router.push('/components/profile')}
        >
          {profile.avatarUrl ? (
            <Image source={{ uri: profile.avatarUrl }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <User size={20} color="#FFFFFF" />
            </View>
          )}
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {firstName}
        </Text>
        <View style={styles.verifiedBadge}>
          <ShieldCheck size={14} color="#FFFFFF" />
          <Text style={styles.verifiedText}>{profile.verificationStatus}</Text>
        </View>
      </View>

      <TouchableOpacity
        style={styles.headerButton}
        onPress={() => router.push('/components/notifications')}
      >
        <Bell size={20} color="#374151" />
        {unreadCount > 0 ? (
          <View style={styles.notificationBadge}>
            <Text style={styles.notificationBadgeText}>{Math.min(99, unreadCount)}</Text>
          </View>
        ) : null}
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <HeaderBar />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: '#F97316',
          tabBarInactiveTintColor: '#6B7280',
          tabBarStyle: {
            backgroundColor: '#FFFFFF',
            paddingBottom: bottomInset,
            paddingTop: 10,
            height: 62 + bottomInset,
          },
          tabBarItemStyle: {
            flex: 1,
            paddingVertical: 6,
            alignItems: 'center',
            justifyContent: 'center',
          },
          tabBarLabelStyle: {
            fontSize: 12,
            fontWeight: '500',
            marginTop: 4,
          },
          tabBarIconStyle: {
            marginBottom: 2,
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
            tabBarIcon: ({ color, focused }) => <Wallet color={color} size={focused ? 28 : 24} />,
          }}
        />
        <Tabs.Screen
          name="groups"
          options={{
            title: 'Groups',
            tabBarIcon: ({ color, focused }) => <Users color={color} size={focused ? 28 : 24} />,
          }}
        />
        <Tabs.Screen
          name="savings"
          options={{
            title: 'Savings',
            tabBarIcon: ({ color, focused }) => <TrendingUp color={color} size={focused ? 28 : 24} />,
          }}
        />
        <Tabs.Screen
          name="savings-create"
          options={{
            href: null,
          }}
        />
      </Tabs>
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  profilePhoto: {
    marginRight: 12,
  },
  avatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E2B5A',
    maxWidth: 150,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10B981',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 8,
  },
  verifiedText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#FFFFFF',
    marginLeft: 4,
  },
  headerButton: {
    padding: 6,
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
    fontSize: 10,
    fontWeight: '700',
  },
});
