/**
 * Send flow — Step 1: Select a group or savings goal.
 *
 * Route params:
 *   type   'group' | 'savings'
 *   from   'home' | 'vault'  (passed through to success screen)
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, ChevronRight, PiggyBank, Search, Users, X } from 'lucide-react-native';
import { useAuthStore } from '../../src/store/authStore';
import { listGroupsForUser, type GroupListItem } from '../../src/services/groupService';
import { fetchSavingsGoals, formatSavingsCategory, type SavingsGoal } from '../../src/services/savingsService';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';

// ─── helpers ────────────────────────────────────────────────────
function initials(name: string): string {
  return name.split(' ').map((p) => p[0] ?? '').join('').toUpperCase().slice(0, 2);
}

// ─── screen ────────────────────────────────────────────────────
export default function SendSelectScreen() {
  const router = useRouter();
  const { type, from } = useLocalSearchParams<{ type?: string; from?: string }>();
  const { user } = useAuthStore();
  const { preferences } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;
  const isGroup = type !== 'savings';

  const [groups, setGroups] = useState<GroupListItem[]>([]);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const load = async () => {
      if (!user?.id) { setLoading(false); return; }
      if (isGroup) {
        const { groups: g } = await listGroupsForUser(user.id);
        setGroups(g);
      } else {
        const { goals: g } = await fetchSavingsGoals(user.id);
        setGoals(g);
      }
      setLoading(false);
    };
    void load();
  }, [user?.id, isGroup]);

  const filteredGroups = useMemo(() =>
    groups.filter((g) => g.name.toLowerCase().includes(search.toLowerCase())),
    [groups, search]
  );

  const filteredGoals = useMemo(() =>
    goals.filter((g) => g.title.toLowerCase().includes(search.toLowerCase())),
    [goals, search]
  );

  const goToDetail = (targetId: string, targetName: string, prefillAmount: number) => {
    router.push({
      pathname: '/(send)/detail',
      params: {
        type: type ?? 'group',
        from: from ?? 'home',
        targetId,
        targetName,
        prefillAmount: String(prefillAmount),
      },
    });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bgSoft }]} edges={['top', 'bottom']}>
      {/* ── Header ─────────────────────────────────────────── */}
      <View style={[styles.header, { backgroundColor: C.bg, borderBottomColor: C.border }]}>
        <TouchableOpacity style={[styles.backBtn, { backgroundColor: isDark ? '#431407' : '#FFF7ED' }]} onPress={() => router.back()}>
          <ArrowLeft size={22} color="#F97316" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: C.text }]}>{isGroup ? 'Send to Osusu' : 'Send to Savings'}</Text>
          <Text style={[styles.headerSub, { color: C.textMuted }]}>
            {isGroup ? 'Choose a group to contribute to' : 'Choose a savings goal to deposit into'}
          </Text>
        </View>
        <View style={{ width: 38 }} />
      </View>

      {/* ── Search ─────────────────────────────────────────── */}
      <View style={[styles.searchBar, { backgroundColor: C.card }]}>
        <Search size={16} color={C.textMuted} />
        <TextInput
          style={[styles.searchInput, { color: C.text }]}
          placeholder={isGroup ? 'Search groups…' : 'Search goals…'}
          placeholderTextColor={C.textMuted}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <X size={15} color="#9CA3AF" />
          </TouchableOpacity>
        )}
      </View>

      {/* ── List ───────────────────────────────────────────── */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#F97316" size="large" />
          <Text style={[styles.loadingText, { color: C.textMuted }]}>Loading…</Text>
        </View>
      ) : isGroup ? (
        <FlatList
          data={filteredGroups}
          keyExtractor={(g) => g.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Users size={44} color={C.border} strokeWidth={1.5} />
              <Text style={[styles.emptyTitle, { color: C.text }]}>No groups found</Text>
              <Text style={[styles.emptyDesc, { color: C.textMuted }]}>
                {search ? 'Try a different search term.' : 'Join or create an Osusu group first.'}
              </Text>
            </View>
          }
          renderItem={({ item: g }) => (
            <TouchableOpacity
              style={[styles.itemCard, { backgroundColor: C.card }]}
              onPress={() => goToDetail(g.id, g.name, g.contributionAmount)}
              activeOpacity={0.88}
            >
              <View style={styles.itemAvatar}>
                <Text style={styles.itemAvatarText}>{initials(g.name)}</Text>
              </View>
              <View style={styles.itemInfo}>
                <Text style={[styles.itemTitle, { color: C.text }]}>{g.name}</Text>
                <Text style={[styles.itemMeta, { color: C.textMuted }]}>
                  {g.members} members · NLe {g.contributionAmount.toFixed(0)}/{g.frequency}
                </Text>
              </View>
              <View style={styles.amountPill}>
                <Text style={styles.amountPillText}>NLe {g.contributionAmount.toFixed(0)}</Text>
              </View>
              <ChevronRight size={18} color="#D1D5DB" style={{ marginLeft: 6 }} />
            </TouchableOpacity>
          )}
        />
      ) : (
        <FlatList
          data={filteredGoals}
          keyExtractor={(g) => g.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <PiggyBank size={44} color={C.border} strokeWidth={1.5} />
              <Text style={[styles.emptyTitle, { color: C.text }]}>No goals found</Text>
              <Text style={[styles.emptyDesc, { color: C.textMuted }]}>
                {search ? 'Try a different search term.' : 'Create a savings goal first.'}
              </Text>
            </View>
          }
          renderItem={({ item: g }) => {
            // Display-only: both values come from the server; this is progress bar formatting.
            const pct = g.target_amount > 0 ? Math.round((g.current_amount / g.target_amount) * 100) : 0;
            return (
              <TouchableOpacity
                style={[styles.itemCard, { backgroundColor: C.card }]}
                onPress={() => goToDetail(g.id, g.title, 0)}
                activeOpacity={0.88}
              >
                <View style={[styles.itemAvatar, styles.itemAvatarGreen]}>
                  <Text style={[styles.itemAvatarText, styles.itemAvatarTextGreen]}>
                    {initials(g.title)}
                  </Text>
                </View>
                <View style={styles.itemInfo}>
                  <Text style={[styles.itemTitle, { color: C.text }]}>{g.title}</Text>
                  <Text style={[styles.itemMeta, { color: C.textMuted }]}>
                    {formatSavingsCategory(g.category)} · {pct}% of NLe {g.target_amount.toFixed(0)}
                  </Text>
                  {/* Progress bar */}
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${Math.min(pct, 100)}%` as `${number}%` }]} />
                  </View>
                </View>
                <ChevronRight size={18} color="#D1D5DB" style={{ marginLeft: 8 }} />
              </TouchableOpacity>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    gap: 10,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#FFF7ED',
    alignItems: 'center', justifyContent: 'center',
  },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#1E2B5A' },
  headerSub: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },

  /* Search */
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginVertical: 12,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 8,
    shadowColor: '#1E2B5A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  searchInput: { flex: 1, fontSize: 14, color: '#1E2B5A' },

  /* Loading / empty */
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#9CA3AF', fontSize: 14 },
  emptyWrap: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#1E2B5A', marginTop: 14, marginBottom: 6 },
  emptyDesc: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', lineHeight: 20 },

  /* List */
  listContent: { paddingHorizontal: 16, paddingBottom: 32 },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#1E2B5A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  itemAvatar: {
    width: 48, height: 48, borderRadius: 14,
    backgroundColor: '#FFF7ED',
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  itemAvatarGreen: { backgroundColor: '#ECFDF5' },
  itemAvatarText: { color: '#F97316', fontSize: 15, fontWeight: '800' },
  itemAvatarTextGreen: { color: '#10B981' },
  itemInfo: { flex: 1 },
  itemTitle: { fontSize: 15, fontWeight: '700', color: '#1E2B5A', marginBottom: 3 },
  itemMeta: { fontSize: 12, color: '#9CA3AF' },

  /* Progress bar (savings) */
  progressTrack: { height: 4, backgroundColor: '#F3F4F6', borderRadius: 2, marginTop: 6, width: '100%' },
  progressFill: { height: 4, backgroundColor: '#10B981', borderRadius: 2 },

  /* Amount pill (groups) */
  amountPill: {
    backgroundColor: '#FFF7ED',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  amountPillText: { fontSize: 12, fontWeight: '800', color: '#F97316' },
});
