import React from 'react';
import { Alert, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Download, Receipt, Share2 } from 'lucide-react-native';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';

export default function ReceiptsScreen() {
  const router = useRouter();
  const { receipts, preferences } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;

  const shareReceipt = async (receiptId: string) => {
    const receipt = receipts.find((item) => item.id === receiptId);
    if (!receipt) return;
    await Share.share({
      title: `Receipt ${receipt.receiptNumber}`,
      message: [
        `Receipt: ${receipt.receiptNumber}`,
        `Transaction: ${receipt.transactionId}`,
        `Amount: NLe ${receipt.amount.toFixed(2)}`,
        `Group: ${receipt.groupName}`,
        `Method: ${receipt.paymentMethod}`,
        `Status: ${receipt.status}`,
      ].join('\n'),
    });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { backgroundColor: C.bg }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerIcon}>
          <ArrowLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <Text style={[styles.title, { color: C.text }]}>Receipts</Text>
        <View style={styles.headerIcon} />
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.content}>
        {receipts.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: C.card }]}>
            <Receipt size={34} color={C.textMuted} />
            <Text style={[styles.emptyTitle, { color: C.text }]}>No receipts yet</Text>
            <Text style={[styles.emptyText, { color: C.textSub }]}>Complete a payment to generate a receipt.</Text>
          </View>
        ) : (
          receipts.map((receipt) => (
            <View key={receipt.id} style={[styles.card, { backgroundColor: C.card }]}>
              <Text style={[styles.cardTitle, { color: C.text }]}>{receipt.groupName}</Text>
              <Text style={[styles.cardMeta, { color: C.textSub }]}>
                {receipt.receiptNumber} • {new Date(receipt.paidAt).toLocaleString()}
              </Text>
              <Text style={styles.amount}>NLe {receipt.amount.toFixed(2)}</Text>
              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.action}
                  onPress={() =>
                    Alert.alert('Download', `Receipt ${receipt.receiptNumber} is stored in your account.`)
                  }
                >
                  <Download size={15} color="#F97316" />
                  <Text style={styles.actionText}>Download</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.action} onPress={() => void shareReceipt(receipt.id)}>
                  <Share2 size={15} color="#F97316" />
                  <Text style={styles.actionText}>Share</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerIcon: {
    width: 28,
    alignItems: 'center',
  },
  title: {
    fontSize: 21,
    fontWeight: '700',
  },
  list: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 30,
  },
  emptyCard: {
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: 50,
  },
  emptyTitle: {
    marginTop: 10,
    fontSize: 18,
    fontWeight: '700',
  },
  emptyText: {
    marginTop: 4,
    fontSize: 13,
  },
  card: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardMeta: {
    fontSize: 12,
    marginBottom: 6,
  },
  amount: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F97316',
    marginBottom: 8,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  actionText: {
    marginLeft: 5,
    color: '#F97316',
    fontWeight: '700',
    fontSize: 12,
  },
});
