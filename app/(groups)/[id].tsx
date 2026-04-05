import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { CalendarDays, Users, Wallet, ChevronLeft, ShieldCheck, Banknote } from 'lucide-react-native';

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-slate-950">
      <View className="flex-row items-center px-6 pt-4 pb-2">
        <TouchableOpacity onPress={() => router.back()} className="mr-4 p-2 bg-slate-900 rounded-full border border-slate-800">
          <ChevronLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <Text className="text-xl font-bold text-white tracking-tight">Vault Details</Text>
      </View>

      <ScrollView className="flex-1 px-6 pt-6" showsVerticalScrollIndicator={false}>
        {/* Header Section */}
        <View className="mb-8 p-6 bg-slate-900 rounded-3xl border border-slate-800 shadow-xl overflow-hidden relative">
          <View className="absolute -top-10 -right-10 w-40 h-40 bg-orange-500/10 rounded-full blur-3xl" />
          <View className="flex-row items-center mb-4">
            <View className="bg-slate-950 p-3 rounded-2xl border border-slate-800 mr-4">
              <ShieldCheck size={28} color="#F97316" />
            </View>
            <View>
              <Text className="text-2xl font-extrabold text-white">Family Fund</Text>
              <View className="flex-row items-center mt-1">
                <Text className="text-primary font-bold">NLe 50</Text>
                <Text className="text-slate-400 text-sm ml-1">/ Weekly</Text>
              </View>
            </View>
          </View>
          
          <View className="flex-row items-center bg-slate-950/50 p-3 rounded-xl border border-slate-800/50">
            <Users size={16} color="#94A3B8" />
            <Text className="text-slate-400 text-sm ml-2">10 Members • Collecting on Sundays</Text>
          </View>
        </View>

        {/* Action Card */}
        <View className="bg-slate-900 rounded-3xl p-6 items-center mb-8 border border-slate-800 relative overflow-hidden">
          <View className="absolute top-0 w-full h-1 bg-primary/80" />
          <Text className="text-slate-400 font-semibold mb-2 uppercase tracking-widest text-xs">Next Contribution Due</Text>
          <View className="flex-row items-baseline mb-6">
            <Text className="text-6xl font-black text-white mr-2">3</Text>
            <Text className="text-lg text-primary font-bold uppercase tracking-wider">Days</Text>
          </View>
          <TouchableOpacity className="bg-primary w-full py-4 rounded-2xl flex-row justify-center items-center shadow-lg shadow-primary/20">
            <Wallet size={20} color="white" className="mr-2" />
            <Text className="text-white font-bold text-lg">Transmit Funds</Text>
          </TouchableOpacity>
        </View>

        {/* Members Roster */}
        <View className="mb-10">
          <Text className="text-xl font-bold text-white mb-4 tracking-tight">Active Roster</Text>
          <View className="bg-slate-900 rounded-3xl border border-slate-800 p-2">
            {["Alpha Bah", "Fatu Kamara", "Mohamed Sesay"].map((name, i) => (
              <View key={i} className={`flex-row justify-between items-center p-4 ${i !== 2 ? 'border-b border-slate-800' : ''}`}>
                 <View className="flex-row items-center">
                   <View className="w-12 h-12 rounded-full bg-slate-800 items-center justify-center mr-4 border border-slate-700">
                     <Text className="text-primary font-bold text-lg">{name.charAt(0)}</Text>
                   </View>
                   <View>
                     <Text className="text-white font-semibold text-base">{name}</Text>
                     <Text className="text-slate-500 text-xs mt-0.5">Position #{i + 1}</Text>
                   </View>
                 </View>
                 {i === 1 && (
                   <View className="bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
                     <Text className="text-emerald-500 font-bold text-xs">Collected</Text>
                   </View>
                 )}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
