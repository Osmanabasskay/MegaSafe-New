import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Search, Key, Shield, Users, Landmark, ArrowLeft, ShieldAlert } from 'lucide-react-native';

const RECOMMENDED_GROUPS = [
  { id: '1', name: 'Alpha Wealth Collective', tag: 'MS-9920-X', amount: 'NLe 500', members: 12, max: 15, iconBg: 'bg-[#93C5FD]', Icon: Shield },
  { id: '2', name: 'Summit Savings Circle', tag: 'MS-1145-K', amount: 'NLe 1,200', members: 8, max: 10, iconBg: 'bg-[#FDE68A]', Icon: Users },
  { id: '3', name: 'Foundation Trust', tag: 'MS-4482-L', amount: 'NLe 250', members: 24, max: 50, iconBg: 'bg-[#E0E7FF]', Icon: Landmark },
];

export default function DiscoverScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-[#FAFAFC]">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
        
        {/* Header Logo Area Placeholder */}
        <View className="px-6 pt-4 pb-2 flex-row flex-start items-center">
          <TouchableOpacity onPress={() => router.back()} className="mr-4">
             <ArrowLeft size={24} color="#F97316" />
          </TouchableOpacity>
          <Text className="text-[#1E2B5A] font-black text-lg tracking-tight">MegaSafe</Text>
        </View>

        <ScrollView className="flex-1 px-6 pt-6" contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
          
          <Text className="text-[#1E2B5A] text-3xl font-black tracking-tight mb-3">
            Expand Your Circle
          </Text>
          <Text className="text-gray-600 font-medium text-[15px] leading-relaxed mb-8">
            Securely connect with existing savings groups or enter a private invite code to join a verified vault.
          </Text>

          {/* Private Invite */}
          <View className="bg-white rounded-[24px] p-6 mb-6 shadow-sm border border-gray-50/50">
            <View className="flex-row items-center mb-4">
               <Key color="#B45309" size={20} className="mr-3" />
               <Text className="text-[#1E2B5A] font-bold text-lg">Private Invite</Text>
            </View>
            <View className="bg-[#F0F4FA] rounded-[16px] px-4 py-4 mb-4 border border-transparent focus:border-[#F97316]">
              <TextInput 
                className="text-[#1E2B5A] font-medium text-base"
                placeholder="Enter 6-digit code" 
                placeholderTextColor="#9ca3af"
              />
            </View>
            <TouchableOpacity className="bg-[#F97316] py-4 rounded-[16px] flex-row justify-center items-center shadow-lg shadow-orange-500/30">
              <Text className="text-[#1E2B5A] font-black text-base">Join via Code</Text>
            </TouchableOpacity>
          </View>

          {/* Search Groups */}
          <View className="bg-white rounded-[24px] p-6 mb-8 shadow-sm border border-gray-50/50">
            <View className="flex-row items-center mb-4">
               <Search color="#3B82F6" size={20} className="mr-3" />
               <Text className="text-[#1E2B5A] font-bold text-lg">Search Groups</Text>
            </View>
            <View className="bg-[white] rounded-[16px] px-4 py-4 flex-row items-center border border-gray-200 mb-4 shadow-sm">
              <Search color="#9CA3AF" size={18} className="mr-2" />
              <TextInput 
                className="flex-1 text-[#1E2B5A] font-medium text-base"
                placeholder="Search by name or Group ID" 
                placeholderTextColor="#9ca3af"
              />
            </View>
            <View className="flex-row flex-wrap">
              {['#Investment', '#FamilyVault', '#Education'].map(tag => (
                <TouchableOpacity key={tag} className="bg-[#E0E7FF] px-3 py-1.5 rounded-full mr-2 mb-2">
                  <Text className="text-[#1E2B5A] text-xs font-bold">{tag}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Recommended Groups */}
          <View className="flex-row justify-between items-center mb-4">
             <Text className="text-[#1E2B5A] text-xl font-bold tracking-tight">Recommended Groups</Text>
             <TouchableOpacity>
               <Text className="text-[#3B82F6] font-bold text-sm">View All</Text>
             </TouchableOpacity>
          </View>

          {RECOMMENDED_GROUPS.map((group) => (
            <View key={group.id} className="bg-white rounded-[24px] p-5 mb-5 shadow-sm border border-gray-50/50">
              <View className="flex-row items-center mb-4">
                <View className={`w-14 h-14 ${group.iconBg} rounded-[14px] items-center justify-center mr-4 shadow-sm`}>
                  <group.Icon color="#1E2B5A" size={24} />
                </View>
                <View className="flex-1">
                  <Text className="text-[#1E2B5A] font-bold text-[17px] leading-tight mb-1">{group.name}</Text>
                  <Text className="text-gray-500 text-xs font-semibold tracking-wider">ID: {group.tag}</Text>
                </View>
              </View>

              <View className="flex-row justify-between mb-5 px-1">
                <View>
                  <Text className="text-[#92400E] text-[9px] font-black tracking-[0.1em] uppercase mb-1">CONTRIBUTION</Text>
                  <View className="flex-row items-baseline">
                    <Text className="text-[#1E2B5A] font-black text-xl">{group.amount}</Text>
                    <Text className="text-gray-500 text-xs font-semibold ml-1">/mo</Text>
                  </View>
                </View>
                <View>
                  <Text className="text-[#92400E] text-[9px] font-black tracking-[0.1em] uppercase mb-1">MEMBERS</Text>
                  <View className="flex-row items-baseline">
                    <Text className="text-[#1E2B5A] font-black text-xl">{group.members}</Text>
                    <Text className="text-gray-500 text-xs font-semibold ml-1">/{group.max}</Text>
                  </View>
                </View>
              </View>

              <TouchableOpacity className="bg-[#E0E7FF] py-3.5 rounded-[12px] items-center border border-[#C7D2FE]">
                <Text className="text-[#1E2B5A] font-black text-[15px]">Request to Join</Text>
              </TouchableOpacity>
            </View>
          ))}

          <View className="items-center mt-6 mb-4">
            <ShieldAlert color="#a1a1aa" size={24} className="mb-2" />
            <Text className="text-gray-400 text-[10px] font-black tracking-widest uppercase">
              END-TO-END ENCRYPTED GROUP MEMBERSHIP
            </Text>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
