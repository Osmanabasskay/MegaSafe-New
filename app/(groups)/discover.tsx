import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Key, Landmark, Search, Shield, ShieldAlert, Users } from 'lucide-react-native';

// ─── Data ──────────────────────────────────────────────────────
const RECOMMENDED_GROUPS = [
  { id: '1', name: 'Alpha Wealth Collective', tag: 'MS-9920-X', amount: 'NLe 500',   members: 12, max: 15, iconBg: 'bg-[#93C5FD]', Icon: Shield   },
  { id: '2', name: 'Summit Savings Circle',   tag: 'MS-1145-K', amount: 'NLe 1,200', members: 8,  max: 10, iconBg: 'bg-[#FDE68A]', Icon: Users    },
  { id: '3', name: 'Foundation Trust',        tag: 'MS-4482-L', amount: 'NLe 250',   members: 24, max: 50, iconBg: 'bg-[#E0E7FF]', Icon: Landmark },
];

const QUICK_TAGS = ['#Investment', '#FamilyVault', '#Education'];

// ─── Screen ────────────────────────────────────────────────────
export default function DiscoverScreen() {
  const router = useRouter();
  // Accept ?q= param from the header search bar so the query lands pre-filled
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [searchQuery, setSearchQuery] = useState(q ?? '');

  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return RECOMMENDED_GROUPS;
    return RECOMMENDED_GROUPS.filter(
      (g) => g.name.toLowerCase().includes(q) || g.tag.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        {/* ── Top bar ────────────────────────────────────────── */}
        <View className="px-6 pt-4 pb-2 flex-row items-center">
          <TouchableOpacity onPress={() => router.back()} className="mr-4">
            <ArrowLeft size={24} color="#F97316" />
          </TouchableOpacity>
          <Text className="text-[#1E2B5A] font-black text-lg tracking-tight">Mi Osusu</Text>
        </View>

        <ScrollView
          className="flex-1 px-6 pt-6"
          contentContainerStyle={{ paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text className="text-[#1E2B5A] text-3xl font-black tracking-tight mb-3">
            Expand Your Circle
          </Text>
          <Text className="text-gray-500 font-medium text-[15px] leading-relaxed mb-8">
            Securely connect with existing savings groups or enter a private invite code to join a verified vault.
          </Text>

          {/* ── Search Groups — auto-focused so keyboard appears instantly ── */}
          <View className="bg-white rounded-[24px] p-6 mb-6 shadow-sm">
            <View className="flex-row items-center mb-4">
              <Search color="#3B82F6" size={20} />
              <Text className="text-[#1E2B5A] font-bold text-lg ml-3">Search Groups</Text>
            </View>

            <View className="bg-gray-100 rounded-[16px] px-4 py-4 flex-row items-center mb-4">
              <Search color="#9CA3AF" size={18} />
              <TextInput
                className="flex-1 text-[#1E2B5A] font-medium text-base ml-2"
                placeholder="Search by name or Group ID"
                placeholderTextColor="#9CA3AF"
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
            </View>

            {/* Quick-filter tags */}
            <View className="flex-row flex-wrap">
              {QUICK_TAGS.map((tag) => (
                <TouchableOpacity
                  key={tag}
                  className="bg-[#E0E7FF] px-3 py-1.5 rounded-full mr-2 mb-2"
                  onPress={() => setSearchQuery(tag.replace('#', ''))}
                >
                  <Text className="text-[#1E2B5A] text-xs font-bold">{tag}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* ── Private Invite ──────────────────────────────── */}
          <View className="bg-white rounded-[24px] p-6 mb-8 shadow-sm">
            <View className="flex-row items-center mb-4">
              <Key color="#B45309" size={20} />
              <Text className="text-[#1E2B5A] font-bold text-lg ml-3">Private Invite</Text>
            </View>
            <View className="bg-[#F0F4FA] rounded-[16px] px-4 py-4 mb-4">
              <TextInput
                className="text-[#1E2B5A] font-medium text-base"
                placeholder="Enter 6-digit code"
                placeholderTextColor="#9CA3AF"
                keyboardType="number-pad"
                maxLength={6}
              />
            </View>
            <TouchableOpacity className="bg-[#F97316] py-4 rounded-[16px] flex-row justify-center items-center">
              <Text className="text-white font-black text-base">Join via Code</Text>
            </TouchableOpacity>
          </View>

          {/* ── Recommended / Search results ───────────────── */}
          <View className="flex-row justify-between items-center mb-4">
            <Text className="text-[#1E2B5A] text-xl font-bold tracking-tight">
              {searchQuery.trim() ? `Results for "${searchQuery.trim()}"` : 'Recommended Groups'}
            </Text>
            {!searchQuery.trim() && (
              <TouchableOpacity>
                <Text className="text-[#3B82F6] font-bold text-sm">View All</Text>
              </TouchableOpacity>
            )}
          </View>

          {filteredGroups.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 36 }}>
              <Search color="#D1D5DB" size={40} />
              <Text style={{ color: '#9CA3AF', fontSize: 14, fontWeight: '600', marginTop: 14, textAlign: 'center' }}>
                No groups match "{searchQuery.trim()}"
              </Text>
              <Text style={{ color: '#D1D5DB', fontSize: 12, marginTop: 6 }}>
                Try a different name or Group ID
              </Text>
            </View>
          ) : (
            filteredGroups.map((group) => (
              <View key={group.id} className="bg-white rounded-[24px] p-5 mb-5 shadow-sm">
                <View className="flex-row items-center mb-4">
                  <View className={`w-14 h-14 ${group.iconBg} rounded-[14px] items-center justify-center mr-4`}>
                    <group.Icon color="#1E2B5A" size={24} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-[#1E2B5A] font-bold text-[17px] leading-tight mb-1">
                      {group.name}
                    </Text>
                    <Text className="text-gray-400 text-xs font-semibold tracking-wider">
                      ID: {group.tag}
                    </Text>
                  </View>
                </View>

                <View className="flex-row justify-between mb-5 px-1">
                  <View>
                    <Text className="text-[#92400E] text-[9px] font-black tracking-[0.1em] uppercase mb-1">
                      CONTRIBUTION
                    </Text>
                    <View className="flex-row items-baseline">
                      <Text className="text-[#1E2B5A] font-black text-xl">{group.amount}</Text>
                      <Text className="text-gray-400 text-xs font-semibold ml-1">/mo</Text>
                    </View>
                  </View>
                  <View>
                    <Text className="text-[#92400E] text-[9px] font-black tracking-[0.1em] uppercase mb-1">
                      MEMBERS
                    </Text>
                    <View className="flex-row items-baseline">
                      <Text className="text-[#1E2B5A] font-black text-xl">{group.members}</Text>
                      <Text className="text-gray-400 text-xs font-semibold ml-1">/{group.max}</Text>
                    </View>
                  </View>
                </View>

                <TouchableOpacity className="bg-[#E0E7FF] py-3.5 rounded-[12px] items-center">
                  <Text className="text-[#1E2B5A] font-black text-[15px]">Request to Join</Text>
                </TouchableOpacity>
              </View>
            ))
          )}

          {/* ── Footer ─────────────────────────────────────── */}
          <View className="items-center mt-4 mb-4">
            <ShieldAlert color="#D1D5DB" size={22} />
            <Text className="text-gray-300 text-[10px] font-black tracking-widest uppercase mt-2">
              END-TO-END ENCRYPTED GROUP MEMBERSHIP
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
