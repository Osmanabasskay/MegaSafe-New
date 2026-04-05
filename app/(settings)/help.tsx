import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  HelpCircle,
  Phone,
  Mail,
  MessageCircle,
  Search,
  ChevronRight,
  FileText,
  CreditCard,
  Shield,
  Users,
  Send,
} from 'lucide-react-native';

export default function HelpCenterScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [contactForm, setContactForm] = useState({
    name: '',
    email: '',
    subject: '',
    message: '',
  });

  const helpCategories = [
    {
      id: 'getting-started',
      title: 'Getting Started',
      icon: <Users size={20} color="#6B7280" />,
      items: [
        {
          question: 'How do I create an account?',
          answer: 'To create an account, download the MegaSafe app and tap on "Sign Up". Follow the registration process by providing your personal information and verifying your identity.',
        },
        {
          question: 'What documents do I need for KYC?',
          answer: 'You\'ll need a valid government-issued ID (passport, national ID, or driver\'s license), proof of address, and a recent photograph. Additional documents may be required for business accounts.',
        },
        {
          question: 'How long does verification take?',
          answer: 'Standard verification typically takes 1-3 business days. Premium verification may be completed within a few hours during business days.',
        },
      ],
    },
    {
      id: 'account-security',
      title: 'Account & Security',
      icon: <Shield size={20} color="#6B7280" />,
      items: [
        {
          question: 'How do I enable two-factor authentication?',
          answer: 'Go to Settings > Security > Two-Factor Authentication. Choose your preferred method (SMS or email) and follow the setup instructions.',
        },
        {
          question: 'What should I do if I forgot my password?',
          answer: 'Tap on "Forgot Password" on the login screen. Enter your registered email or phone number, and follow the password reset instructions sent to you.',
        },
        {
          question: 'How can I secure my account?',
          answer: 'Enable 2FA, use a strong password, never share your credentials, and regularly review your account activity in the security settings.',
        },
      ],
    },
    {
      id: 'transactions',
      title: 'Transactions & Payments',
      icon: <CreditCard size={20} color="#6B7280" />,
      items: [
        {
          question: 'How do I add funds to my account?',
          answer: 'Navigate to the "Add Funds" section, select your preferred payment method, enter the amount, and follow the payment instructions.',
        },
        {
          question: 'What are the transaction limits?',
          answer: 'Transaction limits vary based on your verification level. Standard accounts have lower limits compared to premium verified accounts.',
        },
        {
          question: 'How long do transfers take?',
          answer: 'Internal transfers are instant. Bank transfers typically take 1-3 business days, while mobile money transfers are usually instant.',
        },
      ],
    },
    {
      id: 'groups',
      title: 'Groups & Collections',
      icon: <Users size={20} color="#6B7280" />,
      items: [
        {
          question: 'How do I create a collection group?',
          answer: 'Go to Groups > Create Group, enter the group details, add members, and set up the collection parameters.',
        },
        {
          question: 'Can I assign collectors to groups?',
          answer: 'Yes, group administrators can assign collectors who are authorized to collect payments on behalf of the group.',
        },
        {
          question: 'How are group funds distributed?',
          answer: 'Group funds can be distributed equally, based on contribution, or according to custom rules set by the group administrator.',
        },
      ],
    },
  ];

  const contactOptions = [
    {
      title: 'Phone Support',
      description: 'Mon-Fri, 9AM-6PM GMT',
      icon: <Phone size={20} color="#F97316" />,
      action: '+232 76 123 456',
      onPress: () => Linking.openURL('tel:+23276123456'),
    },
    {
      title: 'Email Support',
      description: 'We respond within 24 hours',
      icon: <Mail size={20} color="#F97316" />,
      action: 'support@megasafe.sl',
      onPress: () => Linking.openURL('mailto:support@megasafe.sl'),
    },
    {
      title: 'Live Chat',
      description: 'Available 24/7',
      icon: <MessageCircle size={20} color="#F97316" />,
      action: 'Start Chat',
      onPress: () => Alert.alert('Live Chat', 'Live chat feature coming soon!'),
    },
  ];

  const toggleCategory = (categoryId: string) => {
    setExpandedCategory(expandedCategory === categoryId ? null : categoryId);
  };

  const handleContactSubmit = () => {
    if (!contactForm.name || !contactForm.email || !contactForm.message) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }
    
    Alert.alert(
      'Support Request Sent',
      'We\'ll get back to you within 24 hours.',
      [
        {
          text: 'OK',
          onPress: () => {
            setContactForm({ name: '', email: '', subject: '', message: '' });
          },
        },
      ]
    );
  };

  const filteredCategories = helpCategories.map(category => ({
    ...category,
    items: category.items.filter(item =>
      item.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.answer.toLowerCase().includes(searchQuery.toLowerCase())
    ),
  })).filter(category => category.items.length > 0 || !searchQuery);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Help Center</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <Search size={20} color="#6B7280" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search for help..."
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        {/* Quick Contact Options */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contact Support</Text>
          {contactOptions.map((option, index) => (
            <TouchableOpacity key={index} style={styles.contactCard} onPress={option.onPress}>
              <View style={styles.contactIcon}>{option.icon}</View>
              <View style={styles.contactContent}>
                <Text style={styles.contactTitle}>{option.title}</Text>
                <Text style={styles.contactDescription}>{option.description}</Text>
                <Text style={styles.contactAction}>{option.action}</Text>
              </View>
              <ChevronRight size={20} color="#9CA3AF" />
            </TouchableOpacity>
          ))}
        </View>

        {/* FAQ Categories */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
          {filteredCategories.map((category) => (
            <View key={category.id} style={styles.categoryCard}>
              <TouchableOpacity
                style={styles.categoryHeader}
                onPress={() => toggleCategory(category.id)}
              >
                <View style={styles.categoryLeft}>
                  <View style={styles.categoryIcon}>{category.icon}</View>
                  <Text style={styles.categoryTitle}>{category.title}</Text>
                </View>
                <ChevronRight
                  size={20}
                  color="#6B7280"
                  style={[
                    styles.chevron,
                    expandedCategory === category.id && styles.chevronRotated,
                  ]}
                />
              </TouchableOpacity>

              {expandedCategory === category.id && (
                <View style={styles.categoryContent}>
                  {category.items.map((item, index) => (
                    <View key={index} style={styles.faqItem}>
                      <Text style={styles.faqQuestion}>{item.question}</Text>
                      <Text style={styles.faqAnswer}>{item.answer}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ))}
        </View>

        {/* Contact Form */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Send us a Message</Text>
          <View style={styles.formCard}>
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Name *</Text>
              <TextInput
                style={styles.input}
                value={contactForm.name}
                onChangeText={(text) => setContactForm({ ...contactForm, name: text })}
                placeholder="Your full name"
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Email *</Text>
              <TextInput
                style={styles.input}
                value={contactForm.email}
                onChangeText={(text) => setContactForm({ ...contactForm, email: text })}
                placeholder="your.email@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Subject</Text>
              <TextInput
                style={styles.input}
                value={contactForm.subject}
                onChangeText={(text) => setContactForm({ ...contactForm, subject: text })}
                placeholder="How can we help you?"
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Message *</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={contactForm.message}
                onChangeText={(text) => setContactForm({ ...contactForm, message: text })}
                placeholder="Describe your issue or question in detail..."
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>

            <TouchableOpacity style={styles.submitButton} onPress={handleContactSubmit}>
              <Send size={20} color="#FFFFFF" />
              <Text style={styles.submitButtonText}>Send Message</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Additional Resources */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Additional Resources</Text>
          
          <TouchableOpacity style={styles.resourceCard}>
            <FileText size={20} color="#6B7280" />
            <View style={styles.resourceContent}>
              <Text style={styles.resourceTitle}>User Guide</Text>
              <Text style={styles.resourceDescription}>Complete guide to using MegaSafe</Text>
            </View>
            <ChevronRight size={20} color="#9CA3AF" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.resourceCard}>
            <FileText size={20} color="#6B7280" />
            <View style={styles.resourceContent}>
              <Text style={styles.resourceTitle}>Video Tutorials</Text>
              <Text style={styles.resourceDescription}>Step-by-step video guides</Text>
            </View>
            <ChevronRight size={20} color="#9CA3AF" />
          </TouchableOpacity>
        </View>
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
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backButton: {
    marginRight: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1E2B5A',
    flex: 1,
  },
  headerSpacer: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    margin: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  searchInput: {
    flex: 1,
    marginLeft: 12,
    fontSize: 16,
    color: '#1E2B5A',
  },
  section: {
    marginHorizontal: 24,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E2B5A',
    marginBottom: 16,
  },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  contactIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  contactContent: {
    flex: 1,
  },
  contactTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1E2B5A',
    marginBottom: 4,
  },
  contactDescription: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 2,
  },
  contactAction: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F97316',
  },
  categoryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  categoryLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  categoryIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  categoryTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1E2B5A',
  },
  chevron: {
    transform: [{ rotate: '0deg' }],
  },
  chevronRotated: {
    transform: [{ rotate: '90deg' }],
  },
  categoryContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  faqItem: {
    marginBottom: 16,
  },
  faqQuestion: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E2B5A',
    marginBottom: 8,
  },
  faqAnswer: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E2B5A',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#1E2B5A',
  },
  textArea: {
    height: 100,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F97316',
    paddingVertical: 14,
    borderRadius: 8,
    marginTop: 8,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginLeft: 8,
  },
  resourceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  resourceContent: {
    flex: 1,
    marginLeft: 16,
  },
  resourceTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1E2B5A',
    marginBottom: 4,
  },
  resourceDescription: {
    fontSize: 14,
    color: '#6B7280',
  },
});
