import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Plus, Minus, Calendar, List, AlignLeft, Shuffle, Settings2, ArrowLeft } from 'lucide-react-native';
import { useGroupCreationStore } from '../../stores/groupCreationStore';
import type { PayoutOrder } from '../../types/group';

export default function CreateGroupScreen() {
  const router = useRouter();
  const { draft, updateBaseConfig } = useGroupCreationStore();
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>(draft.frequency === 'biweekly' ? 'weekly' : draft.frequency);
  const [members, setMembers] = useState(Math.max(2, draft.maxMembers));
  const [rotationOrder, setRotationOrder] = useState<'alphabetical' | 'randomized' | 'custom'>(
    draft.payoutOrder === 'random' ? 'randomized' : 'alphabetical'
  );
  const [amount, setAmount] = useState(draft.contributionAmount > 0 ? draft.contributionAmount.toFixed(2) : '');
  const [startDate, setStartDate] = useState(draft.cycleStartDate);

  const toPayoutOrder = (value: 'alphabetical' | 'randomized' | 'custom'): PayoutOrder =>
    value === 'randomized' ? 'random' : 'sequential';

  const isValidDate = (value: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00`);
    return !Number.isNaN(parsed.getTime());
  };

  const handleCreate = () => {
    const contributionAmount = Number.parseFloat(amount);
    if (!Number.isFinite(contributionAmount) || contributionAmount <= 0) {
      Alert.alert('Invalid amount', 'Enter a contribution amount greater than 0.');
      return;
    }
    if (members < 2 || members > 100) {
      Alert.alert('Invalid member count', 'Members must be between 2 and 100.');
      return;
    }
    if (!isValidDate(startDate)) {
      Alert.alert('Invalid date', 'Use YYYY-MM-DD format for the start date.');
      return;
    }

    updateBaseConfig({
      contributionAmount,
      frequency,
      maxMembers: members,
      cycleStartDate: startDate,
      totalCycles: members,
      payoutOrder: toPayoutOrder(rotationOrder),
    });

    router.push('/(groups)/rules');
  };

  return (
    <SafeAreaView className="flex-1 bg-[#FFFFFF]">
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
            Create a New Group
          </Text>
          <Text className="text-gray-600 font-medium text-[15px] leading-relaxed mb-8">
            Establish a secure contribution circle with trusted members. Configure your rotational vault settings below.
          </Text>

          {/* FINANCIAL COMMITMENTS */}
          <View className="bg-white rounded-[24px] p-6 mb-6 shadow-sm overflow-hidden relative ">
            <View className="absolute -top-10 -right-10 w-32 h-32 bg-[#FFF7ED] rounded-full" />
            <Text className="text-[#92400E] text-[10px] font-black tracking-[0.15em] uppercase mb-5">
              FINANCIAL COMMITMENTS
            </Text>
            
            <View className="mb-6">
              <Text className="text-gray-600 text-xs font-semibold mb-2 ml-1">Contribution Amount (NLe)</Text>
              <View className="bg-[#F0F4FA] rounded-[16px] px-4 py-4 flex-row items-center">
                <Text className="text-[#1E2B5A] font-black mr-2">NLe</Text>
                <TextInput 
                  className="flex-1 text-[#1E2B5A] font-black text-xl"
                  placeholder="0.00" 
                  placeholderTextColor="#9ca3af"
                  keyboardType="numeric"
                  value={amount} 
                  onChangeText={setAmount} 
                />
              </View>
            </View>

            <View>
              <Text className="text-gray-600 text-xs font-semibold mb-2 ml-1">Frequency</Text>
              <View className="bg-[#F0F4FA] p-1.5 rounded-[14px] flex-row">
                {['daily', 'weekly', 'monthly'].map((freq) => (
                  <TouchableOpacity 
                    key={freq}
                    onPress={() => setFrequency(freq as any)}
                    className={`flex-1 py-3 rounded-[10px] items-center ${frequency === freq ? 'bg-[#F97316] shadow-sm' : 'bg-transparent'}`}
                  >
                    <Text className={`text-xs font-bold capitalize ${frequency === freq ? 'text-white' : 'text-[#1E2B5A]'}`}>
                      {freq}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          {/* STRUCTURE */}
          <View className="bg-white rounded-[24px] p-6 mb-6 shadow-sm ">
            <Text className="text-[#92400E] text-[10px] font-black tracking-[0.15em] uppercase mb-4">
              STRUCTURE
            </Text>
            <Text className="text-[#1E2B5A] font-bold text-lg mb-1">Number of Members</Text>
            <Text className="text-gray-500 text-xs leading-relaxed mb-5">
              Define the size of your trust circle. Larger groups increase the rotation cycle length.
            </Text>
            
            <View className="bg-[#F0F4FA] rounded-[16px] p-4 flex-row justify-between items-center">
              <TouchableOpacity onPress={() => setMembers(Math.max(2, members - 1))} className="w-12 h-12 bg-[#E0E7FF] rounded-xl items-center justify-center">
                <Minus color="#1E2B5A" size={20} className="font-black" />
              </TouchableOpacity>
              <Text className="text-[#1E2B5A] text-2xl font-black">{members}</Text>
              <TouchableOpacity onPress={() => setMembers(members + 1)} className="w-12 h-12 bg-[#E0E7FF] rounded-xl items-center justify-center">
                <Plus color="#1E2B5A" size={20} className="font-black" />
              </TouchableOpacity>
            </View>
          </View>

          {/* TIMELINE */}
          <View className="bg-white rounded-[24px] p-6 mb-6 shadow-sm ">
            <Text className="text-[#92400E] text-[10px] font-black tracking-[0.15em] uppercase mb-4">
              TIMELINE
            </Text>
            <Text className="text-[#1E2B5A] font-bold text-lg mb-1">Start Date</Text>
            <Text className="text-gray-500 text-xs leading-relaxed mb-5">
              The cycle begins on this date.
            </Text>
            
            <View className="bg-[#F0F4FA] rounded-[16px] px-4 py-4 flex-row justify-between items-center">
               <Calendar color="#B45309" size={18} className="mr-3" />
               <TextInput
                 className="flex-1 text-[#1E2B5A] font-medium"
                 placeholder="YYYY-MM-DD"
                 placeholderTextColor="#9ca3af"
                 value={startDate}
                 onChangeText={setStartDate}
                 autoCapitalize="none"
               />
               <Calendar color="#1E2B5A" size={16} />
            </View>
          </View>

          {/* ROTATION ORDER */}
          <View className="bg-[#F0F4FA] rounded-[24px] p-2 mb-8 shadow-sm">
             <View className="p-4 flex-row items-center mb-2">
                <View className="w-10 h-10 bg-[#E0E7FF] rounded-full items-center justify-center mr-4">
                  <List color="#1E2B5A" size={20} />
                </View>
                <View className="flex-1">
                  <Text className="text-[#1E2B5A] font-bold text-base mb-1">Rotation Order</Text>
                  <Text className="text-gray-500 text-xs">How will members be prioritized for payouts?</Text>
                </View>
             </View>

             <TouchableOpacity 
                activeOpacity={0.8}
                onPress={() => setRotationOrder('alphabetical')}
                className={`rounded-xl p-4 mb-2 flex-row items-center ${rotationOrder === 'alphabetical' ? 'bg-[#FFF7ED]' : 'bg-white'}`}
             >
                <View className={`w-5 h-5 rounded-full border-2 items-center justify-center mr-4 ${rotationOrder === 'alphabetical' ? 'border-[#F97316]' : 'border-gray-300'}`}>
                  {rotationOrder === 'alphabetical' && <View className="w-2.5 h-2.5 rounded-full bg-[#F97316]" />}
                </View>
                <View>
                  <Text className="text-[#1E2B5A] font-bold text-sm">Alphabetical</Text>
                  <Text className="text-gray-500 text-xs">By member name (A-Z)</Text>
                </View>
             </TouchableOpacity>

             <TouchableOpacity 
                activeOpacity={0.8}
                onPress={() => setRotationOrder('randomized')}
                className={`rounded-xl p-4 mb-2 flex-row items-center ${rotationOrder === 'randomized' ? 'bg-[#FFF7ED]' : 'bg-[#FFFFFF]'}`}
             >
                <View className={`w-5 h-5 rounded-full border-2 items-center justify-center mr-4 ${rotationOrder === 'randomized' ? 'border-[#F97316]' : 'border-gray-300'}`}>
                  {rotationOrder === 'randomized' && <View className="w-2.5 h-2.5 rounded-full bg-[#F97316]" />}
                </View>
                <View>
                  <Text className="text-[#1E2B5A] font-bold text-sm">Randomized</Text>
                  <Text className="text-gray-500 text-xs">System generated shuffle</Text>
                </View>
             </TouchableOpacity>

             <TouchableOpacity 
                activeOpacity={0.8}
                onPress={() => setRotationOrder('custom')}
                className={`rounded-xl p-4 flex-row items-center ${rotationOrder === 'custom' ? 'bg-[#FFF7ED]' : 'bg-[#FFFFFF]'}`}
             >
                <View className={`w-5 h-5 rounded-full border-2 items-center justify-center mr-4 ${rotationOrder === 'custom' ? 'border-[#F97316]' : 'border-gray-300'}`}>
                  {rotationOrder === 'custom' && <View className="w-2.5 h-2.5 rounded-full bg-[#F97316]" />}
                </View>
                <View>
                  <Text className="text-[#1E2B5A] font-bold text-sm">Custom</Text>
                  <Text className="text-gray-500 text-xs">Manual order selection</Text>
                </View>
             </TouchableOpacity>
          </View>

          {/* Submit Button */}
          <TouchableOpacity 
            onPress={handleCreate}
            className="bg-[#F97316] py-4 rounded-[16px] flex-row justify-center items-center mb-4 shadow-lg shadow-orange-500/30"
          >
            <Text className="text-[#1E2B5A] font-black text-lg">Confirm & Create Group</Text>
          </TouchableOpacity>

          <Text className="text-center text-gray-400 text-[10px] font-bold tracking-wider uppercase px-4 pb-4">
            Securely Encrypted by MegaSafe Protocol
          </Text>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}


