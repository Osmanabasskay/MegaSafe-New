import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/authStore';
import { fetchProfile } from '../../lib/profileService';
import { Bell, Wallet, ArrowUpRight, ArrowDownLeft, PlusCircle, Search, Users } from 'lucide-react-native';

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setIsReady(true);
  }, []);

  const { data: profile } = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { profile: p, error } = await fetchProfile(user.id);
      if (error) throw error;
      return p;
    },
    enabled: !!user?.id,
  });

  const showKycBanner = profile?.kyc_status !== 'approved';

  const transactions = [
    { id: '1', title: 'Osusu Contribution', date: 'Today, 10:24 AM', amount: '-NLe 500.00', isOut: true },
    { id: '2', title: 'Group Payout', date: 'Yesterday, 3:15 PM', amount: '+NLe 2,500.00', isOut: false },
    { id: '3', title: 'Wallet Top-up', date: 'Oct 24, 09:12 AM', amount: '+NLe 1,000.00', isOut: false },
  ];

  const handleNavigation = (path: string) => {
    if (isReady && router) {
      router.push(path);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-950">
      <StatusBar barStyle="light-content" />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 40 }}>
        {showKycBanner ? (
          <TouchableOpacity
            className="mx-6 mt-4 mb-2 bg-amber-500/15 border border-amber-500/40 rounded-2xl p-4"
            onPress={() => handleNavigation('/(kyc)/id-photos')}
            activeOpacity={0.85}
          >
            <Text className="text-amber-200 font-bold text-base">Complete identity verification</Text>
            <Text className="text-amber-100/80 text-sm mt-1">
              Upload your ID and guarantor to unlock the full MegaSafe experience.
            </Text>
            <Text className="text-primary font-semibold text-sm mt-2">Continue KYC →</Text>
          </TouchableOpacity>
        ) : null}

        {/* Balance Card Section */}
        <View className="px-6 mt-2">
          <View className="bg-gradient-to-br from-slate-800 to-slate-900 p-6 rounded-3xl border border-slate-700 shadow-2xl shadow-black relative overflow-hidden">
            {/* Background Decor */}
            <View className="absolute -top-20 -right-20 w-40 h-40 bg-primary/20 rounded-full blur-2xl" />
            
            <View className="flex-row justify-between items-center mb-6">
              <View className="flex-row items-center">
                <Wallet size={20} color="#94A3B8" />
                <Text className="text-slate-400 text-sm font-semibold ml-2">Total Secured Assets</Text>
              </View>
            </View>
            <Text className="text-4xl font-extrabold text-white tracking-tight mb-8">
              NLe 14,250.00
            </Text>
            
            {/* Quick Actions */}
            <View className="flex-row justify-between border-t border-slate-700 pt-5">
              <TouchableOpacity 
                className="flex-row items-center"
                onPress={() => handleNavigation('/(main)/vault')}
              >
                <View className="w-10 h-10 bg-primary/20 rounded-full items-center justify-center mr-3">
                  <ArrowDownLeft size={20} color="#F97316" />
                </View>
                <Text className="text-white font-medium">Deposit</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                className="flex-row items-center"
                onPress={() => handleNavigation('/(main)/vault')}
              >
                <View className="w-10 h-10 bg-secondary/20 rounded-full items-center justify-center mr-3">
                  <ArrowUpRight size={20} color="#3B82F6" />
                </View>
                <Text className="text-white font-medium">Withdraw</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Feature Grid */}
        <View className="px-6 mt-8">
          <View className="flex-row justify-between mb-4">
            <TouchableOpacity 
              onPress={() => handleNavigation('/(groups)/create')}
              className="bg-slate-900 w-[48%] p-5 rounded-2xl border border-slate-800 items-center justify-center shadow-lg"
            >
              <PlusCircle size={32} color="#F97316" className="mb-3" />
              <Text className="text-white font-bold text-center">Create Group</Text>
              <Text className="text-slate-500 text-xs mt-1">Start Osusu</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              onPress={() => handleNavigation('/(groups)/discover')}
              className="bg-slate-900 w-[48%] p-5 rounded-2xl border border-slate-800 items-center justify-center shadow-lg"
            >
              <Search size={32} color="#3B82F6" className="mb-3" />
              <Text className="text-white font-bold text-center">Discover</Text>
              <Text className="text-slate-500 text-xs mt-1">Find Groups</Text>
            </TouchableOpacity>
          </View>
          
          <View className="flex-row justify-between">
            <TouchableOpacity 
              onPress={() => handleNavigation('/(main)/savings')}
              className="bg-orange-950/20 w-[48%] p-5 rounded-2xl border border-orange-900/50 items-center justify-center shadow-lg"
            >
              <PlusCircle size={32} color="#F97316" className="mb-3" />
              <Text className="text-orange-400 font-bold text-center">Savings</Text>
              <Text className="text-slate-500 text-xs mt-1">View Savings</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              onPress={() => handleNavigation('/(main)/groups')}
              className="bg-blue-950/20 w-[48%] p-5 rounded-2xl border border-blue-900/50 items-center justify-center shadow-lg"
            >
              <Users size={32} color="#3B82F6" className="mb-3" />
              <Text className="text-blue-400 font-bold text-center">My Groups</Text>
              <Text className="text-slate-500 text-xs mt-1">View Groups</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Recent Transactions */}
        <View className="px-6 mt-10">
          <View className="flex-row justify-between items-center mb-4">
            <Text className="text-white text-xl font-bold tracking-tight">Recent Ledger</Text>
            <TouchableOpacity onPress={() => handleNavigation('/(main)/vault')}>
              <Text className="text-primary font-medium">View All</Text>
            </TouchableOpacity>
          </View>

          <View className="bg-slate-900 rounded-3xl p-2 border border-slate-800">
            {transactions.map((tx, index) => (
              <View 
                key={tx.id} 
                className={`flex-row justify-between items-center p-4 ${index !== transactions.length - 1 ? 'border-b border-slate-800' : ''}`}
              >
                <View className="flex-row items-center flex-1">
                  <View className={`w-12 h-12 rounded-full items-center justify-center ${tx.isOut ? 'bg-orange-500/10' : 'bg-green-500/10'}`}>
                    {tx.isOut ? (
                      <ArrowUpRight size={20} color="#F97316" />
                    ) : (
                      <ArrowDownLeft size={20} color="#22C55E" />
                    )}
                  </View>
                  <View className="ml-4 flex-1">
                    <Text className="text-white font-semibold text-base mb-1">{tx.title}</Text>
                    <Text className="text-slate-500 text-xs">{tx.date}</Text>
                  </View>
                </View>
                <Text className={`font-extrabold ${tx.isOut ? 'text-white' : 'text-green-400'}`}>
                  {tx.amount}
                </Text>
              </View>
            ))}
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}
