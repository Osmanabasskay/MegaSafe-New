import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { CalendarDays, Users, Wallet, ChevronLeft, ShieldCheck } from 'lucide-react-native';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { preferences } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { backgroundColor: C.bg }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backButton, { backgroundColor: isDark ? '#431407' : '#FFF7ED' }]}>
          <ChevronLeft size={22} color="#F97316" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: C.text }]}>Vault Details</Text>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={[styles.heroCard, { backgroundColor: C.card }]}>
          <View style={styles.heroTop}>
            <View style={[styles.heroIcon, { backgroundColor: isDark ? '#431407' : '#FFF7ED' }]}>
              <ShieldCheck size={24} color="#F97316" />
            </View>
            <View>
              <Text style={[styles.groupName, { color: C.text }]}>Family Fund</Text>
              <Text style={[styles.groupMeta, { color: C.textSub }]}>NLe 50 / Weekly</Text>
            </View>
          </View>

          <View style={styles.metaRow}>
            <Users size={16} color={C.textSub} />
            <Text style={[styles.metaText, { color: C.textSub }]}>10 Members · Collecting on Sundays</Text>
          </View>
        </View>

        <View style={[styles.actionCard, { backgroundColor: C.card }]}>
          <Text style={[styles.actionLabel, { color: C.textMuted }]}>Next Contribution Due</Text>
          <View style={styles.countWrap}>
            <Text style={[styles.countValue, { color: C.text }]}>3</Text>
            <Text style={styles.countUnit}>Days</Text>
          </View>
          <TouchableOpacity style={styles.primaryBtn}>
            <Wallet size={18} color="#FFFFFF" />
            <Text style={styles.primaryBtnText}>Transmit Funds</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.section, { backgroundColor: C.card }]}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Active Roster</Text>
          {['Alpha Bah', 'Fatu Kamara', 'Mohamed Sesay'].map((name, i) => (
            <View key={name} style={styles.memberRow}>
              <View style={styles.memberLeft}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{name.charAt(0)}</Text>
                </View>
                <View>
                  <Text style={[styles.memberName, { color: C.text }]}>{name}</Text>
                  <Text style={[styles.memberMeta, { color: C.textMuted }]}>Position #{i + 1}</Text>
                </View>
              </View>
              {i === 1 ? <Text style={styles.collectedTag}>Collected</Text> : null}
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  heroCard: {
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  heroIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  groupName: {
    fontSize: 22,
    fontWeight: '800',
  },
  groupMeta: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: '600',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaText: {
    marginLeft: 8,
    fontSize: 12,
  },
  actionCard: {
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    alignItems: 'center',
  },
  actionLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  countWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 6,
    marginBottom: 12,
  },
  countValue: {
    fontSize: 52,
    fontWeight: '800',
    marginRight: 6,
  },
  countUnit: {
    color: '#F97316',
    fontSize: 18,
    fontWeight: '700',
  },
  primaryBtn: {
    backgroundColor: '#F97316',
    borderRadius: 12,
    paddingVertical: 12,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  primaryBtnText: {
    marginLeft: 8,
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  section: {
    borderRadius: 18,
    padding: 14,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  memberLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFEAD5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarText: {
    color: '#F97316',
    fontSize: 16,
    fontWeight: '700',
  },
  memberName: {
    fontSize: 14,
    fontWeight: '600',
  },
  memberMeta: {
    fontSize: 11,
    marginTop: 2,
  },
  collectedTag: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '700',
  },
});
