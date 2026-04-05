import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  TrendingUp,
  DollarSign,
  Target,
  Calendar,
  Plus,
  MoreVertical,
  Users,
  Clock,
  CheckCircle,
} from 'lucide-react-native';

interface SavingsGoal {
  id: string;
  name: string;
  targetAmount: string;
  currentAmount: string;
  progress: number;
  deadline: string;
  category: string;
  contributors: number;
  status: 'active' | 'completed' | 'paused';
}

export default function SavingsScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const savingsGoals: SavingsGoal[] = [
    {
      id: '1',
      name: 'Emergency Fund',
      targetAmount: '5000.00',
      currentAmount: '3200.00',
      progress: 64,
      deadline: 'Dec 31, 2024',
      category: 'Personal',
      contributors: 1,
      status: 'active',
    },
    {
      id: '2',
      name: 'Family Vacation',
      targetAmount: '3000.00',
      currentAmount: '1800.00',
      progress: 60,
      deadline: 'Jun 30, 2025',
      category: 'Family',
      contributors: 3,
      status: 'active',
    },
    {
      id: '3',
      name: 'New Car',
      targetAmount: '10000.00',
      currentAmount: '2500.00',
      progress: 25,
      deadline: 'Mar 31, 2025',
      category: 'Personal',
      contributors: 2,
      status: 'active',
    },
    {
      id: '4',
      name: 'Home Renovation',
      targetAmount: '8000.00',
      currentAmount: '8000.00',
      progress: 100,
      deadline: 'Nov 30, 2024',
      category: 'Home',
      contributors: 4,
      status: 'completed',
    },
  ];

  const totalSavings = savingsGoals.reduce((sum, goal) => sum + parseFloat(goal.currentAmount), 0);
  const totalTarget = savingsGoals.reduce((sum, goal) => sum + parseFloat(goal.targetAmount), 0);
  const overallProgress = (totalSavings / totalTarget) * 100;

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => {
      setRefreshing(false);
    }, 1000);
  };

  const renderGoalCard = (goal: SavingsGoal) => (
    <TouchableOpacity
      key={goal.id}
      style={styles.goalCard}
      onPress={() => router.push('/(groups)/contribute')}
    >
      <View style={styles.goalHeader}>
        <View style={styles.goalInfo}>
          <Text style={styles.goalName}>{goal.name}</Text>
          <View style={styles.goalMeta}>
            <Text style={styles.goalCategory}>{goal.category}</Text>
            <View style={styles.contributors}>
              <Users size={12} color="#6B7280" />
              <Text style={styles.contributorsText}>{goal.contributors}</Text>
            </View>
          </View>
        </View>
        <View style={styles.goalStatus}>
          {goal.status === 'completed' ? (
            <CheckCircle size={16} color="#10B981" />
          ) : (
            <MoreVertical size={16} color="#6B7280" />
          )}
        </View>
      </View>

      <View style={styles.progressSection}>
        <View style={styles.progressHeader}>
          <Text style={styles.progressAmount}>NLe {goal.currentAmount}</Text>
          <Text style={styles.progressTarget}>of NLe {goal.targetAmount}</Text>
        </View>
        <View style={styles.progressBar}>
          <View 
            style={[
              styles.progressFill,
              { width: `${goal.progress}%` },
              goal.status === 'completed' && styles.completedProgress
            ]}
          />
        </View>
        <Text style={styles.progressText}>{goal.progress}% complete</Text>
      </View>

      <View style={styles.goalFooter}>
        <View style={styles.deadline}>
          <Clock size={12} color="#6B7280" />
          <Text style={styles.deadlineText}>{goal.deadline}</Text>
        </View>
        <TouchableOpacity style={styles.addFundsButton}>
          <Plus size={12} color="#F97316" />
          <Text style={styles.addFundsText}>Add Funds</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Savings Goals</Text>
        <TouchableOpacity style={styles.createButton}>
          <Plus size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Overall Summary */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryHeader}>
          <Text style={styles.summaryTitle}>Total Savings Progress</Text>
          <Target size={20} color="#F97316" />
        </View>
        <View style={styles.summaryAmounts}>
          <Text style={styles.currentAmount}>NLe {totalSavings.toFixed(2)}</Text>
          <Text style={styles.targetAmount}>of NLe {totalTarget.toFixed(2)}</Text>
        </View>
        <View style={styles.summaryProgress}>
          <View style={styles.summaryProgressBar}>
            <View 
              style={[
                styles.summaryProgressFill,
                { width: `${Math.min(overallProgress, 100)}%` }
              ]}
            />
          </View>
          <Text style={styles.summaryProgressText}>{overallProgress.toFixed(1)}%</Text>
        </View>
      </View>

      {/* Quick Stats */}
      <View style={styles.quickStats}>
        <View style={styles.statCard}>
          <TrendingUp size={20} color="#10B981" />
          <Text style={styles.statTitle}>Active Goals</Text>
          <Text style={styles.statValue}>
            {savingsGoals.filter(g => g.status === 'active').length}
          </Text>
        </View>
        <View style={styles.statCard}>
          <CheckCircle size={20} color="#F97316" />
          <Text style={styles.statTitle}>Completed</Text>
          <Text style={styles.statValue}>
            {savingsGoals.filter(g => g.status === 'completed').length}
          </Text>
        </View>
        <View style={styles.statCard}>
          <Calendar size={20} color="#1D4ED8" />
          <Text style={styles.statTitle}>This Month</Text>
          <Text style={styles.statValue}>NLe 450</Text>
        </View>
      </View>

      {/* Goals List */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionTitle}>Your Goals</Text>
        {savingsGoals.map(renderGoalCard)}
        
        <TouchableOpacity 
          style={styles.createGoalCard}
          onPress={() => router.push('/(groups)/create')}
        >
          <View style={styles.createGoalContent}>
            <View style={styles.createGoalIcon}>
              <Plus size={24} color="#F97316" />
            </View>
            <View style={styles.createGoalInfo}>
              <Text style={styles.createGoalTitle}>Create New Goal</Text>
              <Text style={styles.createGoalDescription}>
                Set a new savings target and track your progress
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  createButton: {
    backgroundColor: '#F97316',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    margin: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  summaryAmounts: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 12,
  },
  currentAmount: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1E2B5A',
    marginRight: 8,
  },
  targetAmount: {
    fontSize: 16,
    color: '#6B7280',
  },
  summaryProgress: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryProgressBar: {
    flex: 1,
    height: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 4,
    marginRight: 12,
  },
  summaryProgressFill: {
    height: '100%',
    backgroundColor: '#F97316',
    borderRadius: 4,
  },
  summaryProgressText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  quickStats: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginHorizontal: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  statTitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 8,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingTop: 0,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E2B5A',
    marginBottom: 16,
  },
  goalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  goalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  goalInfo: {
    flex: 1,
  },
  goalName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E2B5A',
    marginBottom: 4,
  },
  goalMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  goalCategory: {
    fontSize: 12,
    color: '#6B7280',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginRight: 8,
  },
  contributors: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  contributorsText: {
    fontSize: 12,
    color: '#6B7280',
    marginLeft: 4,
  },
  goalStatus: {
    padding: 8,
  },
  progressSection: {
    marginBottom: 16,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  progressAmount: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  progressTarget: {
    fontSize: 14,
    color: '#6B7280',
  },
  progressBar: {
    height: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 4,
    marginBottom: 4,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#F97316',
    borderRadius: 4,
  },
  completedProgress: {
    backgroundColor: '#10B981',
  },
  progressText: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'right',
  },
  goalFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  deadline: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  deadlineText: {
    fontSize: 12,
    color: '#6B7280',
    marginLeft: 4,
  },
  addFundsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addFundsText: {
    fontSize: 12,
    color: '#F97316',
    fontWeight: '500',
    marginLeft: 4,
  },
  createGoalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    borderWidth: 2,
    borderColor: '#F97316',
    borderStyle: 'dashed',
    marginTop: 8,
  },
  createGoalContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  createGoalIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  createGoalInfo: {
    flex: 1,
  },
  createGoalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E2B5A',
    marginBottom: 4,
  },
  createGoalDescription: {
    fontSize: 14,
    color: '#6B7280',
  },
});
