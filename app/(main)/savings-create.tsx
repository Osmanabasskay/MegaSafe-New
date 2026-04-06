import React, { useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, CheckCircle2 } from 'lucide-react-native';
import { useAppDataStore } from '../../stores/appDataStore';

type AutoSaveInterval = 'daily' | 'weekly' | 'monthly';

const categories = ['Emergency', 'Education', 'Business', 'Travel', 'Family', 'Personal'] as const;

const getDefaultTargetDate = (): string => {
  const date = new Date();
  date.setDate(date.getDate() + 90);
  return date.toISOString().slice(0, 10);
};

const isIsoDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

export default function SavingsCreateScreen() {
  const router = useRouter();
  const createSavingsGoal = useAppDataStore((state) => state.createSavingsGoal);

  const [title, setTitle] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [targetDate, setTargetDate] = useState(getDefaultTargetDate());
  const [category, setCategory] = useState<(typeof categories)[number]>('Personal');
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(false);
  const [autoSaveAmount, setAutoSaveAmount] = useState('');
  const [autoSaveInterval, setAutoSaveInterval] = useState<AutoSaveInterval>('weekly');
  const [submitting, setSubmitting] = useState(false);

  const parsedTarget = useMemo(() => Number(targetAmount), [targetAmount]);
  const parsedAutoSave = useMemo(() => Number(autoSaveAmount), [autoSaveAmount]);

  const validate = (): string | null => {
    if (title.trim().length < 2) return 'Enter a goal title with at least 2 characters.';
    if (!Number.isFinite(parsedTarget) || parsedTarget <= 0) return 'Enter a valid target amount greater than zero.';
    if (!isIsoDate(targetDate)) return 'Use target date format YYYY-MM-DD.';

    const dueDate = new Date(`${targetDate}T00:00:00`);
    if (Number.isNaN(dueDate.getTime())) return 'Target date is invalid.';

    if (autoSaveEnabled) {
      if (!Number.isFinite(parsedAutoSave) || parsedAutoSave <= 0) {
        return 'Enter a valid auto-save amount greater than zero.';
      }
      if (parsedAutoSave > parsedTarget) {
        return 'Auto-save amount cannot be greater than target amount.';
      }
    }

    return null;
  };

  const handleCreateGoal = () => {
    const validationError = validate();
    if (validationError) {
      Alert.alert('Invalid details', validationError);
      return;
    }

    setSubmitting(true);
    createSavingsGoal({
      title: title.trim(),
      targetAmount: parsedTarget,
      targetDate,
      category,
      autoSaveEnabled,
      autoSaveAmount: autoSaveEnabled ? parsedAutoSave : 0,
      autoSaveInterval,
    });
    setSubmitting(false);

    Alert.alert('Goal created', 'Your savings goal is ready.');
    router.replace('/(main)/savings');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconButton}>
          <ArrowLeft size={22} color="#F97316" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Create Savings Goal</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <Text style={styles.label}>Goal title</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Example: New business setup"
            placeholderTextColor="#9CA3AF"
            style={styles.input}
          />

          <Text style={styles.label}>Target amount (NLe)</Text>
          <TextInput
            value={targetAmount}
            onChangeText={setTargetAmount}
            placeholder="1000"
            placeholderTextColor="#9CA3AF"
            keyboardType="decimal-pad"
            style={styles.input}
          />

          <Text style={styles.label}>Target date</Text>
          <TextInput
            value={targetDate}
            onChangeText={setTargetDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#9CA3AF"
            style={styles.input}
          />

          <Text style={styles.label}>Category</Text>
          <View style={styles.chipRow}>
            {categories.map((item) => (
              <TouchableOpacity
                key={item}
                style={[styles.chip, category === item && styles.chipActive]}
                onPress={() => setCategory(item)}
              >
                <Text style={[styles.chipText, category === item && styles.chipTextActive]}>{item}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.switchRow}>
            <View style={styles.switchTextWrap}>
              <Text style={styles.switchTitle}>Enable auto-save</Text>
              <Text style={styles.switchSubtitle}>Automatically contribute based on your schedule</Text>
            </View>
            <Switch
              value={autoSaveEnabled}
              onValueChange={setAutoSaveEnabled}
              trackColor={{ false: '#E5E7EB', true: '#F97316' }}
              thumbColor="#FFFFFF"
            />
          </View>

          {autoSaveEnabled ? (
            <>
              <Text style={styles.label}>Auto-save amount (NLe)</Text>
              <TextInput
                value={autoSaveAmount}
                onChangeText={setAutoSaveAmount}
                placeholder="50"
                placeholderTextColor="#9CA3AF"
                keyboardType="decimal-pad"
                style={styles.input}
              />

              <Text style={styles.label}>Auto-save interval</Text>
              <View style={styles.chipRow}>
                {(['daily', 'weekly', 'monthly'] as const).map((item) => (
                  <TouchableOpacity
                    key={item}
                    style={[styles.chip, autoSaveInterval === item && styles.chipActive]}
                    onPress={() => setAutoSaveInterval(item)}
                  >
                    <Text style={[styles.chipText, autoSaveInterval === item && styles.chipTextActive]}>
                      {item}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          ) : null}
        </View>

        <TouchableOpacity
          style={[styles.createButton, submitting && styles.createButtonDisabled]}
          disabled={submitting}
          onPress={handleCreateGoal}
        >
          <CheckCircle2 size={18} color="#FFFFFF" />
          <Text style={styles.createButtonText}>{submitting ? 'Saving...' : 'Create goal'}</Text>
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
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: {
    width: 32,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 36,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
  },
  label: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 6,
    marginTop: 6,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: '#111827',
    fontSize: 15,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
  },
  chip: {
    backgroundColor: '#F3F4F6',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    marginBottom: 8,
  },
  chipActive: {
    backgroundColor: '#F97316',
  },
  chipText: {
    color: '#374151',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  switchTextWrap: {
    flex: 1,
    marginRight: 10,
  },
  switchTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  switchSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  createButton: {
    marginTop: 4,
    backgroundColor: '#F97316',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  createButtonDisabled: {
    opacity: 0.6,
  },
  createButtonText: {
    marginLeft: 8,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});

