/**
 * authValidation.test.ts — Comprehensive tests for all signup/login validators.
 *
 * Run:  npx vitest run __tests__/unit/authValidation.test.ts
 * All:  npx vitest run
 */

import { describe, it, expect } from 'vitest';
import {
  slPhoneSchema,
  emailSchema,
  nameSchema,
  addressSchema,
  passwordSchema,
  validateDateOfBirth,
  dobToISODate,
  validateLoginIdentifier,
  isValidSierraLeonePhone,
  normalizeToSierraLeone,
  getPasswordError,
  getPasswordStrength,
} from '../../src/utils/validation/auth';

// ─────────────────────────────────────────────────────────────────────────────
// PHONE — Sierra Leone validation
// ─────────────────────────────────────────────────────────────────────────────
describe('Phone — Sierra Leone validation', () => {
  describe('Valid numbers', () => {
    it('accepts +23276123456 (standard SL mobile)', () =>
      expect(slPhoneSchema.safeParse('+23276123456').success).toBe(true));
    it('accepts +23280123456 (Africell prefix)', () =>
      expect(slPhoneSchema.safeParse('+23280123456').success).toBe(true));
    it('accepts +23230123456 (another SL prefix)', () =>
      expect(slPhoneSchema.safeParse('+23230123456').success).toBe(true));
    it('accepts +23299000000 (all nines)', () =>
      expect(slPhoneSchema.safeParse('+23299000000').success).toBe(true));
  });

  describe('Invalid numbers', () => {
    it('rejects fewer than 8 local digits (+2327612345 = 7)', () =>
      expect(slPhoneSchema.safeParse('+2327612345').success).toBe(false));
    it('rejects more than 8 local digits (+232761234567 = 9)', () =>
      expect(slPhoneSchema.safeParse('+232761234567').success).toBe(false));
    it('rejects non-SL country code (+447911123456 UK)', () =>
      expect(slPhoneSchema.safeParse('+447911123456').success).toBe(false));
    it('rejects US number (+15555551234)', () =>
      expect(slPhoneSchema.safeParse('+15555551234').success).toBe(false));
    it('rejects letters in number (+232abc12345)', () =>
      expect(slPhoneSchema.safeParse('+232abc12345').success).toBe(false));
    it('rejects spaces (+232 76 123456)', () =>
      expect(slPhoneSchema.safeParse('+232 76 123456').success).toBe(false));
    it('rejects dashes (+232-76-123456)', () =>
      expect(slPhoneSchema.safeParse('+232-76-123456').success).toBe(false));
    it('rejects empty string', () =>
      expect(slPhoneSchema.safeParse('').success).toBe(false));
    it('rejects bare 8 digits without country code', () =>
      expect(slPhoneSchema.safeParse('76123456').success).toBe(false));
  });
});

describe('normalizeToSierraLeone', () => {
  it('8 local digits → +232XXXXXXXX', () =>
    expect(normalizeToSierraLeone('76123456')).toBe('+23276123456'));
  it('local number with leading 0 → strips 0, prepends +232', () =>
    expect(normalizeToSierraLeone('076123456')).toBe('+23276123456'));
  it('full +232 already → passes through unchanged', () =>
    expect(normalizeToSierraLeone('+23276123456')).toBe('+23276123456'));
  it('full 232 without + → prepends +', () =>
    expect(normalizeToSierraLeone('23276123456')).toBe('+23276123456'));
  it('strips spaces before normalising', () =>
    expect(normalizeToSierraLeone('76 123 456')).toBe('+23276123456'));
  it('returns empty string for empty input', () =>
    expect(normalizeToSierraLeone('')).toBe(''));
});

describe('isValidSierraLeonePhone', () => {
  it('accepts +23276123456', () =>
    expect(isValidSierraLeonePhone('+23276123456')).toBe(true));
  it('rejects UK number', () =>
    expect(isValidSierraLeonePhone('+447911123456')).toBe(false));
  it('rejects bare 8 digits', () =>
    expect(isValidSierraLeonePhone('76123456')).toBe(false));
  it('rejects 7 local digits', () =>
    expect(isValidSierraLeonePhone('+2327612345')).toBe(false));
});

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL
// ─────────────────────────────────────────────────────────────────────────────
describe('Email validation', () => {
  describe('Valid addresses', () => {
    it('accepts name@example.com', () =>
      expect(emailSchema.safeParse('name@example.com').success).toBe(true));
    it('accepts user.name+tag@domain.org', () =>
      expect(emailSchema.safeParse('user.name+tag@domain.org').success).toBe(true));
    it('accepts subdomain user@mail.example.co.uk', () =>
      expect(emailSchema.safeParse('user@mail.example.co.uk').success).toBe(true));
    it('normalises to lowercase', () => {
      const r = emailSchema.safeParse('NAME@EXAMPLE.COM');
      expect(r.success).toBe(true);
      if (r.success) expect(r.data).toBe('name@example.com');
    });
    it('trims surrounding whitespace', () =>
      expect(emailSchema.safeParse('  user@example.com  ').success).toBe(true));
  });

  describe('Invalid addresses', () => {
    it('rejects "test" (no @)', () =>
      expect(emailSchema.safeParse('test').success).toBe(false));
    it('rejects "test@" (no domain)', () =>
      expect(emailSchema.safeParse('test@').success).toBe(false));
    it('rejects "test@gmail" (no TLD)', () =>
      expect(emailSchema.safeParse('test@gmail').success).toBe(false));
    it('rejects "test@gmail." (empty TLD)', () =>
      expect(emailSchema.safeParse('test@gmail.').success).toBe(false));
    it('rejects "test@@gmail.com" (double @)', () =>
      expect(emailSchema.safeParse('test@@gmail.com').success).toBe(false));
    it('rejects email with internal space', () =>
      expect(emailSchema.safeParse('te st@gmail.com').success).toBe(false));
    it('rejects email over 254 chars', () => {
      // 249 + '@' + 'b.com' (5) = 255 chars — over the 254 limit
      const long = 'a'.repeat(249) + '@b.com';
      expect(long.length).toBeGreaterThan(254);
      expect(emailSchema.safeParse(long).success).toBe(false);
    });
    it('rejects script injection', () =>
      expect(emailSchema.safeParse('<script>@gmail.com').success).toBe(false));
    it('rejects double-dot in local part', () =>
      expect(emailSchema.safeParse('test..name@gmail.com').success).toBe(false));
    it('rejects emoji in email', () =>
      expect(emailSchema.safeParse('user😀@gmail.com').success).toBe(false));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NAME
// ─────────────────────────────────────────────────────────────────────────────
describe('Name validation', () => {
  describe('Valid names', () => {
    it('accepts "Osman"',   () => expect(nameSchema.safeParse('Osman').success).toBe(true));
    it('accepts "Amina"',   () => expect(nameSchema.safeParse('Amina').success).toBe(true));
    it('accepts "Kamara"',  () => expect(nameSchema.safeParse('Kamara').success).toBe(true));
    it('accepts "Abu-Bakarr" (hyphenated)', () =>
      expect(nameSchema.safeParse('Abu-Bakarr').success).toBe(true));
    it("accepts \"O'Connor\" (apostrophe)", () =>
      expect(nameSchema.safeParse("O'Connor").success).toBe(true));
    it('accepts accented "Fàtimà"', () =>
      expect(nameSchema.safeParse('Fàtimà').success).toBe(true));
    it('accepts two-part "Mary Jane"', () =>
      expect(nameSchema.safeParse('Mary Jane').success).toBe(true));
  });

  describe('Invalid names', () => {
    it('rejects "Osman123" (contains number)', () =>
      expect(nameSchema.safeParse('Osman123').success).toBe(false));
    it('rejects "12345" (all numbers)', () =>
      expect(nameSchema.safeParse('12345').success).toBe(false));
    it('rejects "@Osman" (symbol)', () =>
      expect(nameSchema.safeParse('@Osman').success).toBe(false));
    it('rejects XSS payload "<script>alert(1)</script>"', () =>
      expect(nameSchema.safeParse('<script>alert(1)</script>').success).toBe(false));
    it('accepts "A" (1 char — min is now 1 per spec)', () =>
      expect(nameSchema.safeParse('A').success).toBe(true));
    it('rejects blank / whitespace only', () =>
      expect(nameSchema.safeParse('   ').success).toBe(false));
    it('rejects name over 50 chars', () =>
      expect(nameSchema.safeParse('A'.repeat(51)).success).toBe(false));
    it('rejects emoji', () =>
      expect(nameSchema.safeParse('Osman😀').success).toBe(false));
    it('rejects # symbol', () =>
      expect(nameSchema.safeParse('Omar#1').success).toBe(false));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DATE OF BIRTH
// ─────────────────────────────────────────────────────────────────────────────
describe('Date of Birth validation', () => {
  const today = new Date();

  it('is required — rejects null', () =>
    expect(validateDateOfBirth(null)).not.toBeNull());
  it('is required — rejects undefined', () =>
    expect(validateDateOfBirth(undefined)).not.toBeNull());
  it('rejects a future date', () => {
    const future = new Date(today);
    future.setFullYear(today.getFullYear() + 1);
    expect(validateDateOfBirth(future)).not.toBeNull();
  });
  it('rejects today (must be strictly in the past)', () =>
    expect(validateDateOfBirth(today)).not.toBeNull());
  it('rejects minor born 10 years ago', () => {
    const minor = new Date(today);
    minor.setFullYear(today.getFullYear() - 10);
    expect(validateDateOfBirth(minor)).not.toBeNull();
  });
  it('rejects user exactly 17 years, 364 days old', () => {
    const d = new Date(today);
    d.setFullYear(today.getFullYear() - 18);
    d.setDate(d.getDate() + 2); // 2 days short of 18
    expect(validateDateOfBirth(d)).not.toBeNull();
  });
  it('accepts user exactly 18 years old (yesterday was birthday)', () => {
    const d = new Date(today);
    d.setFullYear(today.getFullYear() - 18);
    d.setDate(d.getDate() - 1);
    expect(validateDateOfBirth(d)).toBeNull();
  });
  it('accepts valid adult DOB (1990-06-15)', () =>
    expect(validateDateOfBirth(new Date('1990-06-15'))).toBeNull());
  it('accepts user 65 years old', () => {
    const d = new Date(today);
    d.setFullYear(today.getFullYear() - 65);
    expect(validateDateOfBirth(d)).toBeNull();
  });
  it('rejects DOB older than 120 years', () => {
    const old = new Date(today);
    old.setFullYear(today.getFullYear() - 125);
    expect(validateDateOfBirth(old)).not.toBeNull();
  });
  it('dobToISODate formats as YYYY-MM-DD', () =>
    expect(dobToISODate(new Date(1990, 5, 15))).toBe('1990-06-15'));
});

// ─────────────────────────────────────────────────────────────────────────────
// ADDRESS
// ─────────────────────────────────────────────────────────────────────────────
describe('Address validation', () => {
  describe('Valid addresses', () => {
    it('accepts "12 Bai Bureh Road, Waterloo"', () =>
      expect(addressSchema.safeParse('12 Bai Bureh Road, Waterloo').success).toBe(true));
    it('accepts "5 Old Road, Freetown"', () =>
      expect(addressSchema.safeParse('5 Old Road, Freetown').success).toBe(true));
    it('accepts "Kono District"', () =>
      expect(addressSchema.safeParse('Kono District').success).toBe(true));
    it('accepts "17 Main Street, Bo"', () =>
      expect(addressSchema.safeParse('17 Main Street, Bo').success).toBe(true));
    it("accepts address with apostrophe \"O'Brien's Lane\"", () =>
      expect(addressSchema.safeParse("O'Brien's Lane, Freetown").success).toBe(true));
    it('accepts address with hyphen and slash', () =>
      expect(addressSchema.safeParse('Block 3 / Phase 2, Uptown').success).toBe(true));
  });

  describe('Invalid addresses', () => {
    it('rejects "12345" (numbers only — no letter)', () =>
      expect(addressSchema.safeParse('12345').success).toBe(false));
    it('rejects "@@@@@" (symbols only)', () =>
      expect(addressSchema.safeParse('@@@@@').success).toBe(false));
    it('rejects XSS "<script>alert(1)</script>"', () =>
      expect(addressSchema.safeParse('<script>alert(1)</script>').success).toBe(false));
    it('rejects blank / whitespace only', () =>
      expect(addressSchema.safeParse('   ').success).toBe(false));
    it('rejects under 5 chars', () =>
      expect(addressSchema.safeParse('Road').success).toBe(false));
    it('rejects over 200 chars', () =>
      expect(addressSchema.safeParse('Aa '.repeat(68)).success).toBe(false));
    it('rejects emoji', () =>
      expect(addressSchema.safeParse('12 Road 🏠 Freetown').success).toBe(false));
    it('rejects SQL DROP TABLE pattern', () =>
      expect(addressSchema.safeParse('12 DROP TABLE Road').success).toBe(false));
    it('rejects SQL SELECT pattern', () =>
      expect(addressSchema.safeParse('SELECT * FROM profiles').success).toBe(false));
    it('rejects SQL comment -- pattern', () =>
      expect(addressSchema.safeParse("'; DROP TABLE profiles; --").success).toBe(false));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PASSWORD
// ─────────────────────────────────────────────────────────────────────────────
describe('Password validation', () => {
  describe('Valid passwords', () => {
    it('accepts "Freetown@2024"', () =>
      expect(passwordSchema.safeParse('Freetown@2024').success).toBe(true));
    it('accepts "S!erra1Leone"', () =>
      expect(passwordSchema.safeParse('S!erra1Leone').success).toBe(true));
    it('accepts maximum 72-char password', () => {
      const pw = 'Aa1!' + 'x'.repeat(68);
      expect(passwordSchema.safeParse(pw).success).toBe(true);
    });
  });

  describe('Length limits', () => {
    it('rejects under 8 chars', () =>
      expect(passwordSchema.safeParse('Aa1!x').success).toBe(false));
    it('rejects over 72 chars', () => {
      const pw = 'Aa1!' + 'x'.repeat(69);
      expect(passwordSchema.safeParse(pw).success).toBe(false);
    });
  });

  describe('Missing character class', () => {
    it('rejects no uppercase "freetown@2024"', () =>
      expect(passwordSchema.safeParse('freetown@2024').success).toBe(false));
    it('rejects no lowercase "FREETOWN@2024"', () =>
      expect(passwordSchema.safeParse('FREETOWN@2024').success).toBe(false));
    it('rejects no number "Freetown@abcd"', () =>
      expect(passwordSchema.safeParse('Freetown@abcd').success).toBe(false));
    it('rejects no special char "Freetown2024x"', () =>
      expect(passwordSchema.safeParse('Freetown2024x').success).toBe(false));
  });

  describe('Common password blocklist', () => {
    it('rejects "Password123!"', () =>
      expect(passwordSchema.safeParse('Password123!').success).toBe(false));
    it('rejects "password123!"', () =>
      expect(passwordSchema.safeParse('password123!').success).toBe(false));
    it('rejects "Welcome123!"', () =>
      expect(passwordSchema.safeParse('Welcome123!').success).toBe(false));
    it('rejects "welcome123!"', () =>
      expect(passwordSchema.safeParse('welcome123!').success).toBe(false));
  });

  describe('getPasswordError helper', () => {
    it('returns null for a valid password', () =>
      expect(getPasswordError('S!erra1Leone')).toBeNull());
    it('returns a message for "weak"', () =>
      expect(getPasswordError('weak')).not.toBeNull());
    it('returns a message for missing special char', () =>
      expect(getPasswordError('Freetown2024')).not.toBeNull());
  });

  describe('getPasswordStrength', () => {
    it('score 0 for empty string', () =>
      expect(getPasswordStrength('').score).toBe(0));
    it('score 1 — only length met', () =>
      expect(getPasswordStrength('abcdefgh').score).toBe(1));
    it('score 4 — all requirements met', () => {
      const s = getPasswordStrength('Aa1!strong');
      expect(s.score).toBe(4);
      expect(s.label).toBe('Strong');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN IDENTIFIER
// ─────────────────────────────────────────────────────────────────────────────
describe('Login identifier validation', () => {
  it('identifies email type when @ is present', () => {
    const r = validateLoginIdentifier('user@example.com');
    expect(r.type).toBe('email');
    expect(r.error).toBeNull();
  });
  it('normalises email to lowercase', () => {
    const r = validateLoginIdentifier('USER@EXAMPLE.COM');
    expect(r.normalized).toBe('user@example.com');
  });
  it('rejects invalid email format', () => {
    const r = validateLoginIdentifier('notanemail@');
    expect(r.error).not.toBeNull();
  });
  it('identifies 8 local digits as SL phone', () => {
    const r = validateLoginIdentifier('76123456');
    expect(r.type).toBe('phone');
    expect(r.normalized).toBe('+23276123456');
    expect(r.error).toBeNull();
  });
  it('accepts full E.164 SL phone at login', () => {
    const r = validateLoginIdentifier('+23276123456');
    expect(r.type).toBe('phone');
    expect(r.error).toBeNull();
  });
  it('rejects non-SL country code as phone', () => {
    const r = validateLoginIdentifier('+447911123456');
    expect(r.error).not.toBeNull();
  });
  it('rejects 7 local digits (too short)', () => {
    const r = validateLoginIdentifier('7612345');
    expect(r.error).not.toBeNull();
  });
  it('rejects 9 local digits (too long)', () => {
    const r = validateLoginIdentifier('761234567');
    expect(r.error).not.toBeNull();
  });
  it('does not produce format error for unknown-but-valid email (existence not checked client-side)', () => {
    const r = validateLoginIdentifier('unknown@example.com');
    expect(r.error).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SIGNUP SECURITY — injection and admin role rejection
// ─────────────────────────────────────────────────────────────────────────────
describe('Signup security checks', () => {
  it('name rejects XSS payload', () =>
    expect(nameSchema.safeParse('<script>alert(1)</script>').success).toBe(false));
  it('name rejects SQL injection', () =>
    expect(nameSchema.safeParse("'; DROP TABLE profiles;--").success).toBe(false));
  it('email rejects <img onerror> XSS', () =>
    expect(emailSchema.safeParse('<img src=x onerror=alert(1)>@x.com').success).toBe(false));
  it('address rejects SELECT * FROM pattern', () =>
    expect(addressSchema.safeParse('SELECT * FROM profiles').success).toBe(false));
  it('address rejects <script> tag', () =>
    expect(addressSchema.safeParse('<script>alert(1)</script>').success).toBe(false));
  it('password rejects common weak password "password123!"', () =>
    expect(passwordSchema.safeParse('password123!').success).toBe(false));
});
