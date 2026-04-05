import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { Tabs } from 'expo-router';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, Wallet, Users, TrendingUp, User, Bell, Menu, X, Settings, LogOut, HelpCircle, ShieldCheck } from 'lucide-react-native';

export default function MainTabsLayout() {
  const [showSettings, setShowSettings] = useState(false);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const HeaderBar = () => (
    <View style={styles.headerBar}>
      <View style={styles.userInfo}>
        <TouchableOpacity 
          style={styles.profilePhoto}
          onPress={() => router.push('/components/profile')}
        >
          <View style={styles.avatarPlaceholder}>
            <User size={20} color="#FFFFFF" />
          </View>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Osman Abass</Text>
        <View style={styles.verifiedBadge}>
          <ShieldCheck size={14} color="#FFFFFF" />
          <Text style={styles.verifiedText}>Verified</Text>
        </View>
      </View>
      <View style={styles.headerActions}>
        <TouchableOpacity 
          style={styles.headerButton}
          onPress={() => router.push('/components/notifications')}
        >
          <Bell size={20} color="#374151" />
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.headerButton}
          onPress={() => setShowSettings(true)}
        >
          <Menu size={20} color="#374151" />
        </TouchableOpacity>
      </View>
    </View>
  );

  const SettingsModal = () => (
    <Modal
      visible={showSettings}
      transparent={true}
      animationType="fade"
      onRequestClose={() => setShowSettings(false)}
    >
      <TouchableOpacity 
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={() => setShowSettings(false)}
      >
        <View style={styles.settingsModal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Settings</Text>
            <TouchableOpacity onPress={() => setShowSettings(false)}>
              <X size={20} color="#6B7280" />
            </TouchableOpacity>
          </View>
          
          <TouchableOpacity 
            style={styles.settingsItem}
            onPress={() => {
              setShowSettings(false);
              router.push('/components/profile');
            }}
          >
            <User size={20} color="#6B7280" />
            <Text style={styles.settingsText}>Profile</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.settingsItem}
            onPress={() => {
              setShowSettings(false);
              router.push('/components/settings');
            }}
          >
            <Settings size={20} color="#6B7280" />
            <Text style={styles.settingsText}>Settings</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.settingsItem}>
            <HelpCircle size={20} color="#6B7280" />
            <Text style={styles.settingsText}>Help & Support</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.settingsItem}>
            <LogOut size={20} color="#EF4444" />
            <Text style={styles.settingsText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );

  return (
    <View style={styles.container}>
      <HeaderBar />
      <SettingsModal />
      <Tabs screenOptions={{ 
        headerShown: false,
        tabBarActiveTintColor: '#F97316', 
        tabBarInactiveTintColor: '#6b7280',
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopWidth: 1,
          borderTopColor: '#E5E7EB',
          paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
          paddingTop: 8,
          height: 65 + (insets.bottom > 0 ? insets.bottom : 0),
        },
        tabBarItemStyle: {
          flex: 1,
          paddingVertical: 8,
          paddingHorizontal: 0,
          alignItems: 'center',
          justifyContent: 'center',
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '500',
          marginTop: 4,
        },
        tabBarIconStyle: {
          marginBottom: 4,
        },
      }}>
        <Tabs.Screen 
          name="home" 
          options={{
            title: 'Home',
            tabBarIcon: ({ color, size, focused }) => (
              <Home color={color} size={focused ? 28 : 24} />
            )
          }} 
        />
        <Tabs.Screen 
          name="vault" 
          options={{
            title: 'Vault',
            tabBarIcon: ({ color, size, focused }) => (
              <Wallet color={color} size={focused ? 28 : 24} />
            )
          }} 
        />
        <Tabs.Screen 
          name="groups" 
          options={{
            title: 'Groups',
            tabBarIcon: ({ color, size, focused }) => (
              <Users color={color} size={focused ? 28 : 24} />
            )
          }} 
        />
        <Tabs.Screen 
          name="savings" 
          options={{
            title: 'Savings',
            tabBarIcon: ({ color, size, focused }) => (
              <TrendingUp color={color} size={focused ? 28 : 24} />
            )
          }} 
        />
 
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAFC',
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profilePhoto: {
    marginRight: 12,
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
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: {
    marginLeft: 12,
    padding: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingsModal: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    width: '80%',
    maxWidth: 300,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  settingsText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#374151',
    marginLeft: 16,
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
  customTabBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 8,
    paddingHorizontal: 0,
  },
  customTabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  customTabLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
  },
});
