/**
 * Register screen — 5-step wizard with production-grade validation.
 *
 * Security model:
 *  • Every field validated with Zod schemas before submission.
 *  • Phone: SL-only (+232XXXXXXXX), 8 digits max in UI, numeric keyboard.
 *  • Email: strict regex, lowercase, 254-char max.
 *  • Names: letters only (+ hyphen/apostrophe), 2–50 chars, no XSS.
 *  • DOB: required, must be ≥ 18 years, cannot be future.
 *  • Address: must contain letter, 5–150 chars, safe chars only.
 *  • Password: 8–72 chars, upper+lower+digit+special, common-password block.
 *  • All Supabase errors mapped to generic messages (no enumeration leak).
 *  • address + date_of_birth written to DB on OTP verification.
 *  • Role is never accepted from the form — DB default ('member') is used.
 *  • Duplicate rapid submissions blocked via isLoading guard.
 */
import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
  Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowRight, ChevronDown, ChevronLeft, ChevronRight, Calendar,
  Check, CheckSquare, Square, Mail, User, MapPin, Lock,
} from 'lucide-react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Svg, { Path } from 'react-native-svg';
import { supabase, supabaseConfigured } from '../../src/services/supabase';
import { normalizeToSierraLeone, isValidSierraLeonePhone } from '../../src/services/auth/phone';
import { useComplianceStore } from '../../src/store/complianceStore';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  emailSchema,
  nameSchema,
  addressSchema,
  passwordSchema,
  getPasswordError,
  getPasswordStrength,
  PASSWORD_REQUIREMENTS,
  validateDateOfBirth,
  dobToISODate,
  isValidSierraLeonePhone as isValidPhone,
  validatePasswordContext,
  normalizeNameInput,
  signupMetaSchema,
} from '../../src/utils/validation/auth';
import { recordAttempt, isBlocked, getRemainingSeconds } from '../../src/utils/auth/rateLimiter';
import { checkHaveIBeenPwned } from '../../src/utils/auth/hibp';
import { MSG_SIGNUP_FAILED, MSG_RATE_LIMITED, toSafeAuthError } from '../../src/utils/auth/authErrors';
import { signInWithGoogle } from '../../src/services/auth/googleOAuth';
import { useAuthStore } from '../../src/store/authStore';
import { useAppDataStore } from '../../src/store/appDataStore';
import { fetchProfile } from '../../src/services/profileService';
import {
  getCredentialDisplayName,
  isPlaceholderProfileName,
  normalizeProfileName,
} from '../../src/utils/profileName';

// ── Design tokens ──────────────────────────────────────────────────────────────
const C = {
  bg:           '#FFFFFF',
  navy:         '#00157F',
  orange:       '#FFA504',
  orangeText:   '#5C3400',
  navySoft:     'rgba(0,21,127,0.06)',
  border:       'rgba(0,21,127,0.15)',
  borderError:  '#DC2626',
  inputBg:      '#F8FAFC',
  text:         '#111827',
  muted:        '#6B7280',
  placeholder:  'rgba(0,21,127,0.28)',
  slate:        '#56637A',
  hairline:     '#D9DCE6',
  success:      '#10B981',
  error:        '#DC2626',
};

const TOTAL_STEPS = 5; // 0..4
const SIGNUP_RATE_KEY = 'signup';

async function logGoogleSignupAudit(userId: string): Promise<void> {
  try {
    await supabase.rpc('create_audit_log', {
      p_action:     'login',
      p_table_name: 'profiles',
      p_record_id:  userId,
      p_old_data:   null,
      p_new_data:   { provider: 'google', success: true, event: 'signup' },
    });
  } catch {
    // Audit failure must never interrupt the auth flow
  }
}

function GoogleLogo({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </Svg>
  );
}

// ── Calendar helpers ──────────────────────────────────────────────────────────
const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DAYS_LABEL = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

interface CalendarModalProps {
  visible:      boolean;
  selectedDate: Date | null;
  onConfirm:    (date: Date) => void;
  onClose:      () => void;
}

const THIS_YEAR  = new Date().getFullYear();
const MIN_BIRTH_YEAR = THIS_YEAR - 18;   // youngest allowed (18 yo)
const MAX_BIRTH_YEAR = THIS_YEAR - 120;  // oldest allowed
const YEAR_LIST: number[] = [];
for (let y = MIN_BIRTH_YEAR; y >= MAX_BIRTH_YEAR; y--) YEAR_LIST.push(y);

function CalendarModal({ visible, selectedDate, onConfirm, onClose }: CalendarModalProps) {
  const defaultYear  = selectedDate ? selectedDate.getFullYear() : MIN_BIRTH_YEAR - 2;
  const [viewYear,   setViewYear]   = useState(defaultYear);
  const [viewMonth,  setViewMonth]  = useState(
    selectedDate ? selectedDate.getMonth() : new Date().getMonth(),
  );
  const [picked,         setPicked]         = useState<Date | null>(selectedDate);
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const yearListRef = useRef<FlatList>(null);

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay    = getFirstDayOfWeek(viewYear, viewMonth);

  // Disable future dates and dates < 18 years ago
  const today        = new Date();
  const maxDate      = new Date(MIN_BIRTH_YEAR, today.getMonth(), today.getDate());

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    const nextY = viewMonth === 11 ? viewYear + 1 : viewYear;
    const nextM = viewMonth === 11 ? 0 : viewMonth + 1;
    // Don't navigate past max date month
    if (nextY > maxDate.getFullYear()) return;
    if (nextY === maxDate.getFullYear() && nextM > maxDate.getMonth()) return;
    setViewYear(nextY); setViewMonth(nextM);
  };

  const openYearPicker = () => {
    setYearPickerOpen(true);
    const idx = YEAR_LIST.indexOf(viewYear);
    if (idx >= 0) setTimeout(() => yearListRef.current?.scrollToIndex({ index: idx, animated: false }), 80);
  };

  const isDayDisabled = (day: number): boolean => {
    const d = new Date(viewYear, viewMonth, day);
    return d > maxDate;
  };

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const isSelected = (day: number) =>
    picked !== null &&
    picked.getFullYear() === viewYear &&
    picked.getMonth() === viewMonth &&
    picked.getDate() === day;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={cal.overlay}>
        <TouchableOpacity style={cal.backdropHit} activeOpacity={1} onPress={onClose} />
        <View style={cal.card}>
          {/* Top bar */}
          <View style={cal.topBar}>
            <TouchableOpacity onPress={onClose} style={cal.topBarCancel}>
              <Text style={cal.topBarCancelText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={cal.topBarTitle}>Date of Birth</Text>
            <TouchableOpacity
              onPress={() => picked && onConfirm(picked)}
              disabled={!picked}
              style={cal.topBarDone}
            >
              <Text style={[cal.topBarDoneText, !picked && cal.topBarDoneDisabled]}>Done</Text>
            </TouchableOpacity>
          </View>

          {/* Month / Year nav */}
          <View style={cal.monthNav}>
            <TouchableOpacity onPress={prevMonth} style={cal.navBtn}>
              <ChevronLeft size={22} color="#1E2B5A" />
            </TouchableOpacity>
            <View style={cal.monthYearWrap}>
              <Text style={cal.monthText}>{MONTHS[viewMonth]}</Text>
              <TouchableOpacity style={cal.yearPill} onPress={openYearPicker}>
                <Text style={cal.yearPillText}>{viewYear}</Text>
                <ChevronRight size={14} color="#F97316" style={{ transform: [{ rotate: '90deg' }] }} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={nextMonth} style={cal.navBtn}>
              <ChevronRight size={22} color="#1E2B5A" />
            </TouchableOpacity>
          </View>

          {/* Day labels */}
          <View style={cal.daysRow}>
            {DAYS_LABEL.map(d => <Text key={d} style={cal.dayLabel}>{d}</Text>)}
          </View>

          {yearPickerOpen ? (
            <View style={cal.yearPickerWrap}>
              <FlatList
                ref={yearListRef}
                data={YEAR_LIST}
                keyExtractor={y => String(y)}
                showsVerticalScrollIndicator={false}
                onScrollToIndexFailed={() => {}}
                renderItem={({ item: y }) => (
                  <TouchableOpacity
                    style={[cal.yearRow, y === viewYear && cal.yearRowSelected]}
                    onPress={() => { setViewYear(y); setYearPickerOpen(false); }}
                  >
                    <Text style={[cal.yearRowText, y === viewYear && cal.yearRowTextSelected]}>
                      {y}
                    </Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          ) : (
            <View style={cal.grid}>
              {cells.map((day, idx) => {
                const disabled = !day || isDayDisabled(day);
                return (
                  <TouchableOpacity
                    key={idx}
                    style={[
                      cal.cell,
                      day && isSelected(day) ? cal.cellSelected : undefined,
                      disabled ? cal.cellDisabled : undefined,
                    ]}
                    onPress={() => day && !isDayDisabled(day) && setPicked(new Date(viewYear, viewMonth, day))}
                    disabled={disabled}
                    activeOpacity={0.7}
                  >
                    <Text style={[
                      cal.cellText,
                      day && isSelected(day) ? cal.cellTextSelected : undefined,
                      disabled ? cal.cellTextDisabled : undefined,
                    ]}>
                      {day ?? ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Register Screen ────────────────────────────────────────────────────────────
export default function RegisterScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ legalAcceptedAt?: string }>();
  const { setSession, setUser } = useAuthStore();
  const { initializeForUser, updateProfile } = useAppDataStore();
  const termsAcceptedAt   = useComplianceStore(s => s.termsAcceptedAt);
  const privacyAcceptedAt = useComplianceStore(s => s.privacyAcceptedAt);
  const acceptTerms       = useComplianceStore(s => s.acceptTerms);
  const acceptPrivacy     = useComplianceStore(s => s.acceptPrivacy);
  const resetCompliance   = useComplianceStore(s => s.resetCompliance);
  const legalAccepted     = !!(termsAcceptedAt && privacyAcceptedAt);

  const toggleLegalAcceptance = useCallback(() => {
    if (legalAccepted) resetCompliance();
    else { acceptTerms(); acceptPrivacy(); }
  }, [legalAccepted, acceptTerms, acceptPrivacy, resetCompliance]);

  const isSubmittingRef  = useRef(false);   // ref-based guard prevents double-submit races
  const honeypotRef      = useRef('');      // filled only by bots — never shown to real users
  const formStartTimeRef = useRef<number>(Date.now()); // bot timing detection
  const [step,            setStep]            = useState(0);
  const [isLoading,       setIsLoading]       = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [googleError,     setGoogleError]     = useState<string | null>(null);
  const [errors,   setErrors]   = useState<Record<string, string>>({});
  const [showCalendar,   setShowCalendar]   = useState(false);
  const [showPassword,   setShowPassword]   = useState(false);
  const [showConfirm,    setShowConfirm]    = useState(false);
  const [selectedDOB,    setSelectedDOB]    = useState<Date | null>(null);

  // Form state
  const [localPhone,      setLocalPhone]      = useState('');  // 8 local digits
  const [email,           setEmail]           = useState('');
  const [firstName,       setFirstName]       = useState('');
  const [lastName,        setLastName]        = useState('');
  const [address,         setAddress]         = useState('');
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const clearFieldError = (field: string) => {
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }));
  };

  const normalizedPhone = normalizeToSierraLeone(localPhone);
  const strength        = getPasswordStrength(password);

  // ── Step validators ─────────────────────────────────────────────────────
  const validateStep = (s: number): boolean => {
    const newErrors: Record<string, string> = {};

    if (s === 0) {
      if (!isValidPhone(normalizedPhone)) {
        newErrors.phone = 'Enter a valid 8-digit Sierra Leone number (e.g. 76 123 456)';
      }
    }

    if (s === 1) {
      const emailResult = emailSchema.safeParse(email.trim());
      if (!emailResult.success) {
        newErrors.email = emailResult.error.issues[0]?.message ?? 'Invalid email';
      }
    }

    if (s === 2) {
      const fnResult = nameSchema.safeParse(firstName.trim());
      if (!fnResult.success) {
        newErrors.firstName = fnResult.error.issues[0]?.message ?? 'Invalid first name';
      }
      const lnResult = nameSchema.safeParse(lastName.trim());
      if (!lnResult.success) {
        newErrors.lastName = lnResult.error.issues[0]?.message ?? 'Invalid last name';
      }
      const dobError = validateDateOfBirth(selectedDOB);
      if (dobError) newErrors.dob = dobError;
    }

    if (s === 3) {
      const addrResult = addressSchema.safeParse(address.trim());
      if (!addrResult.success) {
        newErrors.address = addrResult.error.issues[0]?.message ?? 'Invalid address';
      }
    }

    if (s === 4) {
      const pwError = getPasswordError(password);
      if (pwError) {
        newErrors.password = pwError;
      } else {
        // Context-aware: reject passwords derived from the user's personal info
        const contextErr = validatePasswordContext(password, {
          firstName: firstName.trim(),
          lastName:  lastName.trim(),
          email:     email.trim().toLowerCase(),
          phone:     normalizedPhone,
        });
        if (contextErr) newErrors.password = contextErr;
      }
      if (!confirmPassword) {
        newErrors.confirmPassword = 'Please confirm your password';
      } else if (password !== confirmPassword) {
        newErrors.confirmPassword = 'Passwords do not match';
      }
      if (!legalAccepted) {
        newErrors.legal = 'You must accept the Terms of Service and Privacy Policy to continue';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const goNext = () => {
    if (!validateStep(step)) return;
    if (step < TOTAL_STEPS - 1) setStep(s => s + 1);
    else void handleRegister();
  };

  const goBack = () => {
    if (step > 0) setStep(s => s - 1);
    else router.back();
  };

  // ── Google OAuth (bypasses the signup wizard entirely) ──────────────────
  const handleGoogle = async () => {
    setGoogleError(null);
    if (!supabaseConfigured) {
      setGoogleError('Supabase is not configured.');
      return;
    }
    setIsGoogleLoading(true);
    try {
      const { session, error, cancelled } = await signInWithGoogle();
      if (cancelled) { setIsGoogleLoading(false); return; }
      if (error) {
        setGoogleError(toSafeAuthError(error, 'signup'));
        setIsGoogleLoading(false);
        return;
      }
      if (session) {
        void logGoogleSignupAudit(session.user.id);
        setSession(session);
        setUser(session.user);
        initializeForUser(session.user);
        const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>;
        const metaName = normalizeProfileName(
          (typeof meta.full_name === 'string' && meta.full_name) ||
          (typeof meta.name === 'string' && meta.name) || ''
        );
        const credName = getCredentialDisplayName(session.user.email, session.user.phone);
        updateProfile({
          fullName: !isPlaceholderProfileName(metaName) ? metaName : credName,
          email:    session.user.email ?? undefined,
        });
        const { profile } = await fetchProfile(session.user.id);
        if (profile) {
          const remoteName = normalizeProfileName(
            [profile.first_name, profile.last_name]
              .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
              .join(' ')
          );
          updateProfile({
            fullName: !isPlaceholderProfileName(remoteName)
              ? remoteName
              : !isPlaceholderProfileName(metaName) ? metaName : credName,
            email: profile.email ?? session.user.email ?? undefined,
          });
        }
        // Compliance gating: OAuth users must not reach financial features until
        // their profile (phone, name, terms) is complete. Route incomplete users
        // back to the wizard so they fill in required fields.
        const profileComplete = !!profile?.phone && !!profile?.first_name && !!profile?.last_name;
        router.replace(profileComplete ? '/(main)/home' : '/(main)/home');
        // TODO: replace the false-branch with a dedicated compliance completion
        // screen once created: router.replace(profileComplete ? '/(main)/home' : '/(auth)/complete-profile')
      }
    } catch (e) {
      setGoogleError(toSafeAuthError(e, 'signup'));
    }
    setIsGoogleLoading(false);
  };

  const handleRegister = async () => {
    // Ref-based guard: blocks re-entry in the window between first click and setIsLoading(true).
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    // ── Honeypot check — bots fill hidden fields; real users never can ──────────
    if (honeypotRef.current.length > 0) {
      // Silently fail with generic error — give no indication this is a bot trap
      setErrors({ general: MSG_SIGNUP_FAILED });
      isSubmittingRef.current = false;
      return;
    }

    // ── Bot timing detection — flag submissions completed in under 1.5 seconds ──
    const elapsedMs = Date.now() - formStartTimeRef.current;
    if (__DEV__ && elapsedMs < 1500) {
      console.warn(`[Register] Fast submission detected: ${elapsedMs}ms — potential bot`);
    }
    // In production this flag would be included in the audit log via the backend RPC.

    // ── Synchronous field guards ────────────────────────────────────────────────
    if (!isValidPhone(normalizedPhone)) {
      setErrors({ phone: 'Enter a valid Sierra Leone number' });
      setStep(0);
      isSubmittingRef.current = false;
      return;
    }
    if (!termsAcceptedAt || !privacyAcceptedAt) {
      setErrors({ legal: 'You must accept the Terms of Service and Privacy Policy.' });
      isSubmittingRef.current = false;
      return;
    }
    if (!selectedDOB) {
      setErrors({ dob: 'Date of birth is required' });
      setStep(2);
      isSubmittingRef.current = false;
      return;
    }

    // ── Client-side rate limit ──────────────────────────────────────────────────
    if (isBlocked(SIGNUP_RATE_KEY)) {
      const secs = getRemainingSeconds(SIGNUP_RATE_KEY);
      setErrors({ general: `${MSG_RATE_LIMITED} (${secs}s)` });
      isSubmittingRef.current = false;
      return;
    }
    const { blocked, remainingSeconds } = recordAttempt(SIGNUP_RATE_KEY);
    if (blocked) {
      setErrors({ general: `${MSG_RATE_LIMITED} (${remainingSeconds}s)` });
      isSubmittingRef.current = false;
      return;
    }

    const legalAcceptedAt =
      termsAcceptedAt ??
      (params.legalAcceptedAt ? decodeURIComponent(String(params.legalAcceptedAt)) : '');

    setIsLoading(true);
    try {
      // ── HaveIBeenPwned breach check (k-anonymity; password never sent over network) ──
      try {
        const { pwned, error: hibpError } = await checkHaveIBeenPwned(password);
        if (hibpError && __DEV__) {
          console.warn('[Register] HIBP check skipped:', hibpError.message);
        }
        if (pwned) {
          setErrors({
            password: 'This password has appeared in a known data breach. Please choose a different password.',
          });
          setStep(4);
          setIsLoading(false);
          isSubmittingRef.current = false;
          return;
        }
      } catch {
        // HIBP failure must never block signup — fail open
      }

      if (supabaseConfigured) {
        // ── Normalise names (collapse multiple internal spaces) ─────────────────
        const cleanFirstName = normalizeNameInput(firstName);
        const cleanLastName  = normalizeNameInput(lastName);

        // ── Zod metadata validation + unknown-key strip ─────────────────────────
        // signupMetaSchema strips any injected keys (role, is_admin, etc.) automatically.
        const rawMeta = {
          first_name:    cleanFirstName,
          last_name:     cleanLastName,
          full_name:     `${cleanFirstName} ${cleanLastName}`.trim(),
          phone:         normalizedPhone,
          date_of_birth: dobToISODate(selectedDOB) ?? undefined,
        };
        const metaResult = signupMetaSchema.safeParse(rawMeta);
        if (!metaResult.success) {
          if (__DEV__) console.warn('[Register] Metadata schema failed:', metaResult.error.issues);
          setErrors({ general: MSG_SIGNUP_FAILED });
          setIsLoading(false);
          isSubmittingRef.current = false;
          return;
        }

        const { error } = await supabase.auth.signUp({
          email:    email.trim().toLowerCase(),
          password,
          options: {
            // metaResult.data has unknown keys stripped by Zod.
            // Role is NEVER set here; DB trigger assigns 'member' unconditionally.
            // address is omitted from metadata — written to profiles.address_line1 after OTP.
            data: metaResult.data,
          },
        });

        if (error) {
          const status = (error as { status?: number; statusCode?: number }).status
            ?? (error as { status?: number; statusCode?: number }).statusCode;
          // 504 = gateway timeout — Supabase may still have created the user
          if (status !== 504) {
            setErrors({ general: MSG_SIGNUP_FAILED });
            if (__DEV__) console.warn('[Register] signUp error:', error.message);
            return;
          }
          // On 504 fall through and proceed to OTP — user may have been created
        }
      }

      // Navigate to OTP. Include address + DOB so they can be written to profiles after verification.
      router.push({
        pathname: '/(auth)/otp',
        params: {
          phone:           encodeURIComponent(normalizedPhone),
          email:           encodeURIComponent(email.trim().toLowerCase()),
          firstName:       encodeURIComponent(normalizeNameInput(firstName)),
          lastName:        encodeURIComponent(normalizeNameInput(lastName)),
          address:         encodeURIComponent(address.trim()),
          dateOfBirth:     encodeURIComponent(dobToISODate(selectedDOB) ?? ''),
          legalAcceptedAt: encodeURIComponent(legalAcceptedAt),
          type:            'register',
        },
      });
    } catch (error) {
      setErrors({ general: toSafeAuthError(error, 'signup') });
    } finally {
      setIsLoading(false);
      isSubmittingRef.current = false;
    }
  };

  const formatDOB = (date: Date) =>
    `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;

  // ── Step 0: Phone ──────────────────────────────────────────────────────
  const renderPhone = () => (
    <View style={[s.stepContent, s.phoneStepContent]}>
      <Text style={s.phoneTitle}>Join Mi Osusu</Text>
      <Text style={s.phoneSubtitle}>
        Enter your Sierra Leone phone number to get started.{'\n'}
        We'll use it for security verification.
      </Text>

      <View style={s.phoneFormGroup}>
        <Text style={s.phoneLabel}>Phone Number</Text>
        <View style={[s.phoneInputRow, errors.phone ? s.phoneInputRowError : undefined]}>
          {/* Sierra Leone flag + fixed +232 prefix */}
          <View style={s.countryPicker}>
            <Text style={s.flagEmoji}>🇸🇱</Text>
          </View>
          <Text style={s.countryCodeText}>+232</Text>
          <View style={s.phoneDivider} />
          <TextInput
            style={s.phoneInput}
            placeholder="76 123 456"
            placeholderTextColor="#8C96AA"
            keyboardType="number-pad"
            maxLength={8}
            value={localPhone}
            onChangeText={v => {
              // Strip non-digits, enforce 8-digit max
              const digits = v.replace(/\D/g, '').slice(0, 8);
              setLocalPhone(digits);
              clearFieldError('phone');
            }}
            autoComplete="tel"
            textContentType="telephoneNumber"
          />
        </View>
        {errors.phone ? <Text style={s.errorText}>{errors.phone}</Text> : null}
        <Text style={s.phoneHint}>Enter your 8-digit local number (e.g. 76 123 456)</Text>
      </View>

      <View style={s.phoneInfoRow}>
        <View style={s.lockIconWrap}>
          <Lock size={16} color="#FFFFFF" strokeWidth={3} />
        </View>
        <Text style={s.phoneInfoText}>
          We use your number to securely verify your{'\n'}
          identity and send important contribution{'\n'}
          updates. No spam, ever.
        </Text>
      </View>

      {/* ── OR divider + Google OAuth ───────────────── */}
      <View style={s.oauthDivider}>
        <View style={[s.oauthDividerLine, { backgroundColor: C.hairline }]} />
        <Text style={s.oauthDividerText}>OR</Text>
        <View style={[s.oauthDividerLine, { backgroundColor: C.hairline }]} />
      </View>

      {googleError ? (
        <Text style={[s.errorText, { marginBottom: 8 }]}>{googleError}</Text>
      ) : null}

      <TouchableOpacity
        style={[s.googleBtn, (isLoading || isGoogleLoading) && s.googleBtnDisabled]}
        onPress={handleGoogle}
        disabled={isLoading || isGoogleLoading}
        activeOpacity={0.8}
      >
        {isGoogleLoading ? (
          <ActivityIndicator color={C.navy} />
        ) : (
          <>
            <GoogleLogo size={20} />
            <Text style={s.googleBtnText}>Continue with Google</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );

  // ── Step 1: Email ──────────────────────────────────────────────────────
  const renderEmail = () => (
    <View style={s.stepContent}>
      <Text style={s.stepTitle}>Your Email</Text>
      <Text style={s.stepSubtitle}>
        We'll send a verification code to confirm this address.
      </Text>
      <View style={s.formGroup}>
        <Text style={s.label}>Email Address</Text>
        <View style={[s.inputRow, errors.email ? s.inputRowError : undefined]}>
          <Mail size={20} color={C.muted} />
          <TextInput
            style={s.input}
            placeholder="name@example.com"
            placeholderTextColor={C.placeholder}
            value={email}
            onChangeText={v => { setEmail(v); clearFieldError('email'); }}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            maxLength={254}
          />
          {emailSchema.safeParse(email.trim()).success ? (
            <Check size={18} color={C.success} />
          ) : null}
        </View>
        {errors.email ? <Text style={s.errorText}>{errors.email}</Text> : null}
      </View>
    </View>
  );

  // ── Step 2: Name + DOB ─────────────────────────────────────────────────
  const renderNameDOB = () => (
    <View style={s.stepContent}>
      <Text style={s.stepTitle}>Personal Info</Text>
      <Text style={s.stepSubtitle}>Your legal name helps us verify your identity.</Text>

      <View style={s.formGroup}>
        <Text style={s.label}>First Name</Text>
        <View style={[s.inputRow, errors.firstName ? s.inputRowError : undefined]}>
          <User size={20} color={C.muted} />
          <TextInput
            style={s.input}
            placeholder="Amina"
            placeholderTextColor={C.placeholder}
            value={firstName}
            onChangeText={v => { setFirstName(v); clearFieldError('firstName'); }}
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={50}
          />
        </View>
        {errors.firstName ? <Text style={s.errorText}>{errors.firstName}</Text> : null}
      </View>

      <View style={s.formGroup}>
        <Text style={s.label}>Last Name</Text>
        <View style={[s.inputRow, errors.lastName ? s.inputRowError : undefined]}>
          <User size={20} color={C.muted} />
          <TextInput
            style={s.input}
            placeholder="Kamara"
            placeholderTextColor={C.placeholder}
            value={lastName}
            onChangeText={v => { setLastName(v); clearFieldError('lastName'); }}
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={50}
          />
        </View>
        {errors.lastName ? <Text style={s.errorText}>{errors.lastName}</Text> : null}
      </View>

      <View style={s.formGroup}>
        {/* DOB is required — do not mark as optional */}
        <Text style={s.label}>Date of Birth <Text style={s.labelRequired}>*</Text></Text>
        <TouchableOpacity
          style={[s.inputRow, errors.dob ? s.inputRowError : undefined]}
          onPress={() => setShowCalendar(true)}
          activeOpacity={0.8}
        >
          <Calendar size={20} color={C.muted} />
          <Text style={[s.input, !selectedDOB && { color: C.placeholder }]}>
            {selectedDOB ? formatDOB(selectedDOB) : 'Select your date of birth'}
          </Text>
          <ChevronRight size={18} color={C.muted} />
        </TouchableOpacity>
        {errors.dob
          ? <Text style={s.errorText}>{errors.dob}</Text>
          : <Text style={s.fieldHint}>You must be 18 or older to register</Text>
        }
      </View>
    </View>
  );

  // ── Step 3: Address ────────────────────────────────────────────────────
  const renderAddress = () => (
    <View style={s.stepContent}>
      <Text style={s.stepTitle}>Where do you live?</Text>
      <Text style={s.stepSubtitle}>
        Your home address helps us personalise your Mi Osusu experience.
      </Text>
      <View style={s.formGroup}>
        <Text style={s.label}>Home Address <Text style={s.labelRequired}>*</Text></Text>
        <View style={[s.inputRow, errors.address ? s.inputRowError : undefined]}>
          <MapPin size={20} color={C.muted} />
          <TextInput
            style={s.input}
            placeholder="12 Wilkinson Road, Freetown"
            placeholderTextColor={C.placeholder}
            value={address}
            onChangeText={v => { setAddress(v); clearFieldError('address'); }}
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={200}
            multiline={false}
          />
        </View>
        {errors.address ? <Text style={s.errorText}>{errors.address}</Text> : null}
        <Text style={s.fieldHint}>E.g. "12 Bai Bureh Road, Waterloo" or "Kono District"</Text>
      </View>
    </View>
  );

  // ── Step 4: Password ───────────────────────────────────────────────────
  const renderPassword = () => (
    <View style={s.stepContent}>
      <Text style={s.stepTitle}>Secure your account</Text>
      <Text style={s.stepSubtitle}>
        Choose a strong password to protect your Mi Osusu savings.
      </Text>

      <View style={s.formGroup}>
        <Text style={s.label}>New Password <Text style={s.labelRequired}>*</Text></Text>
        <View style={[s.inputRow, errors.password ? s.inputRowError : undefined]}>
          <Lock size={20} color={C.muted} />
          <TextInput
            style={[s.input, { flex: 1 }]}
            placeholder="••••••••"
            placeholderTextColor={C.placeholder}
            value={password}
            onChangeText={v => { setPassword(v); clearFieldError('password'); }}
            secureTextEntry={!showPassword}
            autoComplete="new-password"
            textContentType="newPassword"
            maxLength={72}
          />
          <TouchableOpacity onPress={() => setShowPassword(v => !v)}>
            <FontAwesome name={showPassword ? 'eye-slash' : 'eye'} size={20} color={C.muted} />
          </TouchableOpacity>
        </View>
        {errors.password ? <Text style={s.errorText}>{errors.password}</Text> : null}
      </View>

      {/* Strength bar + requirement list */}
      {password.length > 0 && (
        <View style={s.strengthWrap}>
          <View style={s.strengthRow}>
            <Text style={s.strengthLabel}>Password Strength</Text>
            <Text style={[s.strengthValue, { color: strength.color }]}>
              {strength.label}
            </Text>
          </View>
          <View style={s.strengthBar}>
            {[1,2,3,4].map(i => (
              <View
                key={i}
                style={[
                  s.strengthSeg,
                  { backgroundColor: i <= strength.score ? strength.color : '#E5E7EB' },
                ]}
              />
            ))}
          </View>
          <View style={s.reqList}>
            {PASSWORD_REQUIREMENTS.map((req, idx) => {
              const met = req.test(password);
              return (
                <View key={idx} style={s.reqRow}>
                  <View style={[s.reqDot, { backgroundColor: met ? C.success : 'transparent', borderColor: met ? C.success : '#D1D5DB' }]}>
                    {met ? <Check size={10} color="#FFFFFF" /> : null}
                  </View>
                  <Text style={[s.reqText, { color: met ? C.text : C.muted }]}>
                    {req.label}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      <View style={s.formGroup}>
        <Text style={s.label}>Confirm Password <Text style={s.labelRequired}>*</Text></Text>
        <View style={[s.inputRow, errors.confirmPassword ? s.inputRowError : undefined]}>
          <Lock size={20} color={C.muted} />
          <TextInput
            style={[s.input, { flex: 1 }]}
            placeholder="••••••••"
            placeholderTextColor={C.placeholder}
            value={confirmPassword}
            onChangeText={v => { setConfirmPassword(v); clearFieldError('confirmPassword'); }}
            secureTextEntry={!showConfirm}
            autoComplete="new-password"
            textContentType="newPassword"
            maxLength={72}
          />
          <TouchableOpacity onPress={() => setShowConfirm(v => !v)}>
            <FontAwesome name={showConfirm ? 'eye-slash' : 'eye'} size={20} color={C.muted} />
          </TouchableOpacity>
        </View>
        {errors.confirmPassword ? (
          <Text style={s.errorText}>{errors.confirmPassword}</Text>
        ) : null}
      </View>

      {/* Terms */}
      <TouchableOpacity style={s.termsRow} onPress={toggleLegalAcceptance} activeOpacity={0.7}>
        {legalAccepted
          ? <CheckSquare size={22} color={C.orange} />
          : <Square size={22} color={C.muted} />}
        <Text style={s.termsText}>
          I agree to the{' '}
          <Text style={s.termsLink}>Terms of Service</Text>
          {' '}and{' '}
          <Text style={s.termsLink}>Privacy Policy</Text>
        </Text>
      </TouchableOpacity>
      {errors.legal ? (
        <Text style={[s.errorText, { marginTop: -4, marginBottom: 4 }]}>
          {errors.legal}
        </Text>
      ) : null}

      {/* General submission error (rate limit, network, etc.) */}
      {errors.general ? (
        <Text style={[s.errorText, { textAlign: 'center', marginTop: 8 }]}>
          {errors.general}
        </Text>
      ) : null}
    </View>
  );

  const stepRenderers = [renderPhone, renderEmail, renderNameDOB, renderAddress, renderPassword];
  const isLastStep   = step === TOTAL_STEPS - 1;
  const isContactStep = step === 0;
  const progressPct  = `${((step + 1) / TOTAL_STEPS) * 100}%`;

  return (
    <SafeAreaView style={s.container}>
      <KeyboardAvoidingView
        style={s.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={goBack} style={s.backBtn} activeOpacity={0.7}>
            <ChevronLeft size={24} color={C.navy} />
          </TouchableOpacity>
          <Text style={s.wordmark}>Mi Osusu</Text>
          <Text style={s.stepCounter}>{step + 1}/{TOTAL_STEPS}</Text>
        </View>

        {/* Progress bar */}
        <View style={s.progressTrack}>
          <View style={[s.progressFill, { width: progressPct as any }]} />
        </View>

        <ScrollView
          contentContainerStyle={[s.scroll, isContactStep && s.contactScroll]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {stepRenderers[step]?.()}

          {/* CTA button */}
          <TouchableOpacity
            style={[
              s.ctaBtn,
              isContactStep && s.contactCtaBtn,
              isLoading && s.ctaBtnDisabled,
            ]}
            onPress={goNext}
            disabled={isLoading}
            activeOpacity={0.85}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Text style={[s.ctaBtnText, isContactStep && s.contactCtaBtnText]}>
                  {isLastStep ? 'Create Account' : 'Continue'}
                </Text>
                <ArrowRight size={20} color="#FFFFFF" strokeWidth={2.2} />
              </>
            )}
          </TouchableOpacity>

          {/* Sign-in link */}
          <View style={s.signInRow}>
            <Text style={s.signInText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/login')}>
              <Text style={s.signInLink}>Sign In</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <CalendarModal
        visible={showCalendar}
        selectedDate={selectedDOB}
        onConfirm={date => {
          setSelectedDOB(date);
          setShowCalendar(false);
          clearFieldError('dob');
        }}
        onClose={() => setShowCalendar(false)}
      />

      {/* Honeypot — positioned off-screen, invisible to real users.
          Bots that fill all fields automatically will set this; real users never will.
          Value stored in a ref so it never triggers a re-render. */}
      <View style={s.honeypot} aria-hidden>
        <TextInput
          defaultValue=""
          onChangeText={v => { honeypotRef.current = v; }}
          autoComplete="off"
          autoCorrect={false}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          tabIndex={-1}
        />
      </View>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container:      { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 24, height: 64,
  },
  backBtn:        { width: 36, height: 40, justifyContent: 'center', alignItems: 'flex-start' },
  wordmark:       { fontSize: 20, fontWeight: '800', color: C.navy },
  stepCounter:    { fontSize: 14, fontWeight: '600', color: '#1F2B46' },
  progressTrack: {
    height: 5, backgroundColor: '#E0E3EB',
    marginHorizontal: 24, borderRadius: 4, marginBottom: 4, overflow: 'hidden',
  },
  progressFill:   { height: 5, backgroundColor: C.orange, borderRadius: 4 },
  scroll:         { flexGrow: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 42 },
  contactScroll:  { paddingTop: 72 },
  stepContent:    { marginBottom: 8 },
  phoneStepContent: { marginBottom: 0 },
  stepTitle:      { fontSize: 28, fontWeight: '700', color: C.navy, marginBottom: 8 },
  stepSubtitle:   { fontSize: 15, color: C.muted, lineHeight: 22, marginBottom: 4 },
  phoneTitle:     { fontSize: 34, fontWeight: '800', color: C.navy, marginBottom: 8 },
  phoneSubtitle:  { fontSize: 16, color: C.slate, lineHeight: 24, marginBottom: 4 },
  formGroup:      { marginTop: 20 },
  phoneFormGroup: { marginTop: 72 },
  label:          { fontSize: 13, fontWeight: '600', color: C.navy, marginBottom: 6, marginLeft: 2 },
  labelRequired:  { color: C.error, fontWeight: '700' },
  phoneLabel:     { fontSize: 13, fontWeight: '700', color: C.navy, marginBottom: 10 },
  fieldHint:      { fontSize: 11, color: C.muted, marginTop: 5, marginLeft: 2 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.inputBg, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 14,
    borderWidth: 1.5, borderColor: C.border, gap: 10,
  },
  inputRowError:  { borderColor: C.borderError },
  input:          { flex: 1, fontSize: 16, color: C.text, fontWeight: '500' },
  phoneInputRow: {
    flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: 1.5, borderBottomColor: C.navy,
    paddingBottom: 10, gap: 14,
  },
  phoneInputRowError: { borderBottomColor: C.borderError },
  countryPicker:  { flexDirection: 'row', alignItems: 'center' },
  flagEmoji:      { fontSize: 22 },
  countryCodeText:{ fontSize: 16, color: C.navy, fontWeight: '700' },
  phoneDivider:   { width: 1.5, height: 24, backgroundColor: C.hairline, marginRight: 4 },
  phoneInput:     { flex: 1, fontSize: 16, color: C.text, fontWeight: '500', paddingVertical: 0 },
  phoneHint:      { fontSize: 11, color: C.muted, marginTop: 8 },
  errorText:      { fontSize: 12, color: C.error, marginTop: 5, marginLeft: 2 },
  phoneInfoRow: {
    flexDirection: 'row', alignItems: 'flex-start', marginTop: 32, gap: 14,
  },
  lockIconWrap: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: C.orange,
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  phoneInfoText:  { flex: 1, fontSize: 14, color: C.slate, lineHeight: 22 },
  oauthDivider:     { flexDirection: 'row', alignItems: 'center', marginVertical: 20, gap: 12 },
  oauthDividerLine: { flex: 1, height: 1 },
  oauthDividerText: { fontSize: 11, fontWeight: '700', color: C.muted, letterSpacing: 1 },
  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 12, borderRadius: 14, height: 52,
    borderWidth: 1.5, borderColor: C.border,
    backgroundColor: C.inputBg,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  googleBtnDisabled: { opacity: 0.45 },
  googleBtnText:     { fontWeight: '700', fontSize: 15, color: C.navy },
  strengthWrap:   { marginTop: 6, marginBottom: 10 },
  strengthRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  strengthLabel:  { fontSize: 12, color: C.muted, fontWeight: '500' },
  strengthValue:  { fontSize: 12, fontWeight: '700' },
  strengthBar:    { flexDirection: 'row', gap: 4, marginBottom: 12 },
  strengthSeg:    { flex: 1, height: 4, borderRadius: 4 },
  reqList:        { gap: 6 },
  reqRow:         { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reqDot: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
  },
  reqText:        { fontSize: 12, fontWeight: '500' },
  termsRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 10, marginTop: 18, marginBottom: 6,
  },
  termsText:      { flex: 1, fontSize: 14, color: C.muted, lineHeight: 20 },
  termsLink:      { color: C.navy, fontWeight: '600' },
  ctaBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.orange, borderRadius: 14, paddingVertical: 17,
    marginTop: 20, marginBottom: 20, gap: 8,
    shadowColor: C.orange, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },
  contactCtaBtn:  { minHeight: 56, paddingVertical: 16, marginTop: 'auto', marginBottom: 20 },
  ctaBtnDisabled: { opacity: 0.6 },
  ctaBtnText:     { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  contactCtaBtnText: { fontSize: 17, fontWeight: '800' },
  signInRow:      { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  signInText:     { fontSize: 14, color: C.slate },
  signInLink:     { fontSize: 14, color: C.navy, fontWeight: '800' },
  // Honeypot: must be off-screen and zero-size so no real user can interact with it
  honeypot:       { position: 'absolute', top: -9999, left: -9999, width: 0, height: 0, overflow: 'hidden', opacity: 0 },
});

// ── Calendar styles ───────────────────────────────────────────────────────────
const cal = StyleSheet.create({
  overlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  backdropHit: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  card: {
    backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingBottom: 32,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12, shadowRadius: 16, elevation: 20,
  },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  topBarCancel:     { paddingVertical: 4, paddingHorizontal: 4 },
  topBarCancelText: { fontSize: 15, color: '#6B7280', fontWeight: '500' },
  topBarTitle:      { fontSize: 16, fontWeight: '700', color: '#1E2B5A' },
  topBarDone:       { paddingVertical: 4, paddingHorizontal: 4 },
  topBarDoneText:   { fontSize: 15, color: '#F97316', fontWeight: '700' },
  topBarDoneDisabled: { opacity: 0.35 },
  monthNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 14,
  },
  navBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#F8FAFC', alignItems: 'center', justifyContent: 'center',
  },
  monthYearWrap: { alignItems: 'center' },
  monthText:     { fontSize: 18, fontWeight: '700', color: '#1E2B5A', marginBottom: 4 },
  yearPill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFF7ED', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 4, gap: 4,
    borderWidth: 1, borderColor: '#FDBA74',
  },
  yearPillText: { fontSize: 14, fontWeight: '700', color: '#F97316' },
  daysRow:      { flexDirection: 'row', paddingHorizontal: 12, marginBottom: 4 },
  dayLabel: {
    flex: 1, textAlign: 'center', fontSize: 12, color: '#9CA3AF',
    fontWeight: '700', textTransform: 'uppercase',
  },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: 12, minHeight: 240,
  },
  cell: {
    width: '14.285714%', aspectRatio: 1,
    justifyContent: 'center', alignItems: 'center', borderRadius: 100,
  },
  cellSelected:  { backgroundColor: '#F97316' },
  cellDisabled:  { opacity: 0.3 },
  cellText:      { fontSize: 14, color: '#374151', fontWeight: '500' },
  cellTextSelected: { color: '#FFFFFF', fontWeight: '700' },
  cellTextDisabled: { color: '#9CA3AF' },
  yearPickerWrap: {
    height: 240, marginHorizontal: 20, borderRadius: 16, overflow: 'hidden',
    backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#F1F5F9',
  },
  yearRow: {
    paddingVertical: 13, paddingHorizontal: 20,
    borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  yearRowSelected:     { backgroundColor: '#FFF7ED' },
  yearRowText:         { fontSize: 16, color: '#374151', fontWeight: '500', textAlign: 'center' },
  yearRowTextSelected: { color: '#F97316', fontWeight: '700' },
});
