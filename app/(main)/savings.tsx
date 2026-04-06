import React, { useMemo, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Calendar, CheckCircle, Plus, TrendingUp, Users } from 'lucide-react-native';
import { useAppDataStore } from '../../stores/appDataStore';

export default function SavingsScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const { savingsGoals, addToSavingsGoal, runAutoSaveSweep } = useAppDataStore();

  const totals = useMemo(() => {
    const totalTarget = savingsGoals.reduce((sum, goal) => sum + goal.targetAmount, 0);
    const totalSaved = savingsGoals.reduce((sum, goal) => sum + goal.currentAmount, 0);
    const progress = totalTarget > 0 ? (totalSaved / totalTarget) * 100 : 0;
    return { totalTarget, totalSaved, progress };
  }, [savingsGoals]);

  const activeGoals = useMemo(
    () => savingsGoals.filter((goal) => goal.status === 'active').length,
    [savingsGoals]
  );
  const completedGoals = useMemo(
    () => savingsGoals.filter((goal) => goal.status === 'completed').length,
    [savingsGoals]
  );

  const onRefresh = async () => {
    setRefreshing(true);
    const applied = runAutoSaveSweep();
    if (applied > 0) {
      Alert.alert('Auto-save applied', `${applied} goal(s) were auto-funded.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    setRefreshing(false);
  };

  const addFunds = (goalId: string, amount: number) => {
    addToSavingsGoal(goalId, amount);
  };

  const progressWidth = `${Math.min(100, Math.max(0, totals.progress))}%` as const;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Savings Goals</Text>
        <TouchableOpacity
          style={styles.createButton}
          onPress={() => router.push('/(main)/savings-create')}
        >
          <Plus size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <View style={styles.summaryCard}>
        <View style={styles.summaryHeader}>
          <Text style={styles.summaryTitle}>Total Progress</Text>
          <TrendingUp size={20} color="#F97316" />
        </View>
        <Text style={styles.summaryAmount}>NLe {totals.totalSaved.toFixed(2)}</Text>
        <Text style={styles.summaryTarget}>of NLe {totals.totalTarget.toFixed(2)}</Text>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: progressWidth }]} />
        </View>
        <Text style={styles.progressText}>{totals.progress.toFixed(1)}%</Text>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Users size={18} color="#1D4ED8" />
          <Text style={styles.statLabel}>Active</Text>
          <Text style={styles.statValue}>{activeGoals}</Text>
        </View>
        <View style={styles.statCard}>
          <CheckCircle size={18} color="#10B981" />
          <Text style={styles.statLabel}>Completed</Text>
          <Text style={styles.statValue}>{completedGoals}</Text>
        </View>
        <View style={styles.statCard}>
          <Calendar size={18} color="#F97316" />
          <Text style={styles.statLabel}>Auto-Save</Text>
          <Text style={styles.statValue}>
            {savingsGoals.filter((goal) => goal.autoSaveEnabled).length}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {savingsGoals.map((goal) => {
          const goalProgress = goal.targetAmount > 0 ? (goal.currentAmount / goal.targetAmount) * 100 : 0;
          return (
            <View key={goal.id} style={styles.goalCard}>
              <View style={styles.goalHead}>
                <View style={styles.goalInfo}>
                  <Text style={styles.goalTitle}>{goal.title}</Text>
                  <Text style={styles.goalMeta}>
                    {goal.category} - {goal.status.replace('_', ' ')}
                  </Text>
                </View>
                <Text style={styles.goalAmount}>NLe {goal.currentAmount.toFixed(2)}</Text>
              </View>

              <View style={styles.goalProgressBar}>
              <View
                style={[
                  styles.goalProgressFill,
                  { width: `${Math.min(goalProgress, 100)}%` as const },
                ]}
              />
              </View>
              <View style={styles.goalProgressMeta}>
                <Text style={styles.goalTarget}>Target NLe {goal.targetAmount.toFixed(2)}</Text>
                <Text style={styles.goalTarget}>{goalProgress.toFixed(1)}%</Text>
              </View>

              <View style={styles.goalFooter}>
                <Text style={styles.goalDate}>Due {goal.targetDate}</Text>
                <View style={styles.goalActions}>
                  <TouchableOpacity style={styles.addButton} onPress={() => addFunds(goal.id, 50)}>
                    <Text style={styles.addButtonText}>+50</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.addButton} onPress={() => addFunds(goal.id, 100)}>
                    <Text style={styles.addButtonText}>+100</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.autoSaveRow}>
                <Text style={styles.autoSaveLabel}>
                  {goal.autoSaveEnabled
                    ? `Auto-save NLe ${goal.autoSaveAmount.toFixed(2)} (${goal.autoSaveInterval})`
                    : 'Auto-save disabled'}
                </Text>
                <Text style={styles.autoSaveNext}>
                  {goal.autoSaveNextDate ? `Next ${goal.autoSaveNextDate}` : 'No schedule'}
                </Text>
              </View>
            </View>
          );
        })}

        <TouchableOpacity
          style={styles.createGoalCard}
          onPress={() => router.push('/(main)/savings-create')}
        >
          <Plus size={20} color="#F97316" />
          <Text style={styles.createGoalTitle}>Create another goal</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  createButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCard: {
    margin: 20,
    marginBottom: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  summaryTitle: {
    color: '#6B7280',
    fontSize: 13,
  },
  summaryAmount: {
    color: '#1E2B5A',
    fontSize: 28,
    fontWeight: '700',
  },
  summaryTarget: {
    color: '#6B7280',
    fontSize: 13,
    marginBottom: 10,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F3F4F6',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: '#F97316',
  },
  progressText: {
    marginTop: 6,
    color: '#6B7280',
    fontSize: 12,
    textAlign: 'right',
  },
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 6,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  statLabel: {
    marginTop: 4,
    color: '#6B7280',
    fontSize: 11,
  },
  statValue: {
    color: '#1E2B5A',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 20,
    paddingBottom: 36,
  },
  goalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  goalHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  goalInfo: {
    flex: 1,
    marginRight: 8,
  },
  goalTitle: {
    color: '#1E2B5A',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 3,
  },
  goalMeta: {
    color: '#6B7280',
    fontSize: 12,
  },
  goalAmount: {
    color: '#1E2B5A',
    fontSize: 15,
    fontWeight: '700',
  },
  goalProgressBar: {
    height: 7,
    borderRadius: 4,
    backgroundColor: '#F3F4F6',
    marginBottom: 5,
  },
  goalProgressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  goalProgressMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  goalTarget: {
    color: '#6B7280',
    fontSize: 11,
  },
  goalFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  goalDate: {
    color: '#6B7280',
    fontSize: 12,
  },
  goalActions: {
    flexDirection: 'row',
  },
  addButton: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginLeft: 6,
  },
  addButtonText: {
    color: '#F97316',
    fontSize: 12,
    fontWeight: '700',
  },
  autoSaveRow: {
    marginTop: 10,
    paddingTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  autoSaveLabel: {
    fontSize: 11,
    color: '#6B7280',
    flex: 1,
    marginRight: 8,
  },
  autoSaveNext: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  createGoalCard: {
    borderRadius: 12,
    backgroundColor: '#FFF7ED',
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  createGoalTitle: {
    marginLeft: 8,
    color: '#F97316',
    fontWeight: '700',
  },
});

