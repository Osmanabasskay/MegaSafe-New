import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Dimensions,
  Easing,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, ArrowRight, Check, Square } from 'lucide-react-native';
import { darkColors, lightColors } from '../../src/theme/colors';
import { useAppDataStore } from '../../src/store/appDataStore';
import { useComplianceStore } from '../../src/store/complianceStore';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SLIDE_WIDTH = SCREEN_WIDTH;

const INTRO_SLIDES = [
  {
    id: 'smart-community',
    title: 'Smart Community Savings',
    body: 'Save smarter with trusted groups, clear records, and a secure community-first experience.',
    image: require('../../assets/signup-intro/smart-community-savings.jpg'),
  },
  {
    id: 'save-circle',
    title: 'Save With Your Circle',
    body: 'Create or join savings circles with family, friends, and colleagues across Sierra Leone.',
    image: require('../../assets/signup-intro/save-with-your-circle.jpg'),
  },
  {
    id: 'grow-savings',
    title: 'Grow Your Savings',
    body: 'Track progress, build discipline, and move toward goals one contribution at a time.',
    image: require('../../assets/signup-intro/grow-your-savings.jpg'),
  },
  {
    id: 'secure-trusted',
    title: 'Secure and Trusted',
    body: 'Your account is protected with secure verification and careful handling of your data.',
    image: require('../../assets/signup-intro/secure-and-trusted.jpg'),
  },
  {
    id: 'financial-freedom',
    title: 'Financial Freedom',
    body: 'Plan for what matters: family, education, business, emergencies, and the future.',
    image: require('../../assets/signup-intro/financial-freedom.jpg'),
  },
] as const;

export default function SignupIntroScreen() {
  const router = useRouter();
  const isDark = useAppDataStore(s => s.preferences.darkMode);
  const colors = isDark ? darkColors : lightColors;
  const acceptTerms = useComplianceStore(s => s.acceptTerms);
  const acceptPrivacy = useComplianceStore(s => s.acceptPrivacy);

  const listRef = useRef<FlatList>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const imageFloat = useRef(new Animated.Value(0)).current;
  const [activeIndex, setActiveIndex] = useState(0);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const isLast = activeIndex === INTRO_SLIDES.length - 1;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduceMotion);
    return () => sub?.remove?.();
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(imageFloat, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(imageFloat, {
          toValue: 0,
          duration: 2600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [imageFloat, reduceMotion]);

  const imageMotion = useMemo(() => {
    if (reduceMotion) return undefined;
    return {
      transform: [
        { translateY: imageFloat.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) },
        { scale: imageFloat.interpolate({ inputRange: [0, 1], outputRange: [1, 1.015] }) },
      ],
    };
  }, [imageFloat, reduceMotion]);

  const goNext = useCallback(() => {
    if (!isLast) {
      const next = activeIndex + 1;
      setActiveIndex(next);
      listRef.current?.scrollToIndex({ index: next, animated: !reduceMotion });
      return;
    }
    if (!legalAccepted) return;
    acceptTerms();
    acceptPrivacy();
    const acceptedAt = encodeURIComponent(new Date().toISOString());
    router.replace({ pathname: '/(auth)/register', params: { legalAcceptedAt: acceptedAt } });
  }, [acceptPrivacy, acceptTerms, activeIndex, isLast, legalAccepted, reduceMotion, router]);

  const onMomentumEnd = useCallback((event: { nativeEvent: { contentOffset: { x: number } } }) => {
    setActiveIndex(Math.round(event.nativeEvent.contentOffset.x / SLIDE_WIDTH));
  }, []);

  const renderSlide = useCallback(({ item, index }: { item: typeof INTRO_SLIDES[number]; index: number }) => {
    const inputRange = [(index - 1) * SLIDE_WIDTH, index * SLIDE_WIDTH, (index + 1) * SLIDE_WIDTH];
    const opacity = reduceMotion
      ? 1
      : scrollX.interpolate({ inputRange, outputRange: [0.62, 1, 0.62], extrapolate: 'clamp' });
    const scale = reduceMotion
      ? 1
      : scrollX.interpolate({ inputRange, outputRange: [0.95, 1, 0.95], extrapolate: 'clamp' });

    return (
      <View style={styles.slide}>
        <Animated.View style={[styles.imageCard, { opacity, transform: [{ scale }] }]}>
          <Animated.View style={[styles.imageMotion, imageMotion as any]}>
            <Image
              source={item.image}
              style={styles.heroImage}
              resizeMode="cover"
              accessibilityIgnoresInvertColors
              accessibilityLabel={item.title}
            />
          </Animated.View>
        </Animated.View>

        <View style={styles.copyBlock}>
          <Text style={[styles.slideTitle, { color: colors.text }]}>{item.title}</Text>
          <Text style={[styles.slideBody, { color: colors.textSub }]}>{item.body}</Text>
        </View>
      </View>
    );
  }, [colors.text, colors.textSub, imageMotion, reduceMotion, scrollX]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={[styles.backBtn, { backgroundColor: isDark ? colors.iconBg : '#FFF7ED' }]}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={20} color="#F97316" />
        </TouchableOpacity>
        <Text style={[styles.wordmark, { color: colors.text }]}>Mi Osusu</Text>
        <View style={styles.headerSpacer} />
      </View>

      <Animated.FlatList
        ref={listRef}
        data={INTRO_SLIDES}
        renderItem={renderSlide}
        keyExtractor={item => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onMomentumScrollEnd={onMomentumEnd}
        getItemLayout={(_, index) => ({ length: SLIDE_WIDTH, offset: SLIDE_WIDTH * index, index })}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: true },
        )}
        scrollEventThrottle={16}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        windowSize={3}
      />

      <View style={styles.footer}>
        <View style={styles.dotsRow} accessibilityRole="adjustable" accessibilityLabel={`Slide ${activeIndex + 1} of ${INTRO_SLIDES.length}`}>
          {INTRO_SLIDES.map((slide, i) => (
            <View
              key={slide.id}
              style={[
                styles.dot,
                i === activeIndex ? styles.dotActive : styles.dotInactive,
                i === activeIndex && { backgroundColor: '#F97316' },
                i !== activeIndex && { backgroundColor: isDark ? '#334155' : '#D1D5DB' },
              ]}
            />
          ))}
        </View>

        {isLast ? (
          <TouchableOpacity
            style={[styles.legalRow, { borderColor: isDark ? colors.borderStrong : '#E5E7EB', backgroundColor: isDark ? colors.card : '#FFFFFF' }]}
            onPress={() => setLegalAccepted(v => !v)}
            activeOpacity={0.82}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: legalAccepted }}
          >
            <View style={[styles.checkBox, legalAccepted && styles.checkBoxActive]}>
              {legalAccepted ? <Check size={14} color="#FFFFFF" strokeWidth={3} /> : <Square size={18} color="#94A3B8" />}
            </View>
            <Text style={[styles.legalText, { color: colors.textSub }]}>
              I agree to the{' '}
              <Text style={styles.legalLink} onPress={() => router.push('/(settings)/terms')}>Terms of Service</Text>
              {' '}and{' '}
              <Text style={styles.legalLink} onPress={() => router.push('/(settings)/privacy')}>Privacy Policy</Text>
            </Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={[styles.nextBtn, isLast && !legalAccepted && styles.nextBtnDisabled]}
          onPress={goNext}
          disabled={isLast && !legalAccepted}
          activeOpacity={0.86}
          accessibilityRole="button"
          accessibilityLabel={isLast ? 'Agree and create account' : 'Next introduction screen'}
        >
          <Text style={styles.nextBtnText}>{isLast ? 'Agree & Create Account' : 'Next'}</Text>
          <ArrowRight size={20} color="#FFFFFF" strokeWidth={2.4} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 10,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1E2B5A',
  },
  headerSpacer: { width: 38 },
  slide: {
    width: SLIDE_WIDTH,
    paddingHorizontal: 24,
  },
  imageCard: {
    width: '100%',
    aspectRatio: 0.78,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#FFF7ED',
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
  },
  imageMotion: {
    width: '100%',
    height: '100%',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  copyBlock: {
    paddingTop: 20,
    alignItems: 'center',
  },
  slideTitle: {
    fontSize: 25,
    lineHeight: 31,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
    letterSpacing: -0.2,
    marginBottom: 8,
  },
  slideBody: {
    fontSize: 14,
    lineHeight: 21,
    color: '#6B7280',
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 28,
    paddingTop: 12,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  dotActive: { width: 28 },
  dotInactive: { width: 8 },
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    padding: 13,
    gap: 11,
    marginBottom: 14,
  },
  checkBox: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxActive: {
    backgroundColor: '#F97316',
  },
  legalText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: '#6B7280',
  },
  legalLink: {
    color: '#F97316',
    fontWeight: '800',
  },
  nextBtn: {
    height: 56,
    borderRadius: 16,
    backgroundColor: '#F97316',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  nextBtnDisabled: {
    opacity: 0.45,
    shadowOpacity: 0,
  },
  nextBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
});
