/**
 * auth.test.ts — Comprehensive tests for all signup/login validation rules.
 *
 * Run: npx vitest run src/utils/validation/__tests__/auth.test.ts
 */

import { describe, it, expect } from 'vitest';
import { MSG_SIGNUP_FAILED, MSG_LOGIN_FAILED } from '../../auth/authErrors';
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
  validatePasswordContext,
  normalizeNameInput,
} from '../auth';
import {
  normalizeToSierraLeone as normalizeSL,
  isValidSierraLeonePhone as isValidSL,
} from '../../../services/auth/phone';

// ─────────────────────────────────────────────────────────────────────────────
// PHONE VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
describe('Phone — Sierra Leone validation', () => {
  // Valid
  it('accepts +23276123456 (standard SL mobile)', () => {
    expect(slPhoneSchema.safeParse('+23276123456').success).toBe(true);
  });
  it('accepts +23280123456 (Africell)', () => {
    expect(slPhoneSchema.safeParse('+23280123456').success).toBe(true);
  });
  it('accepts +23230123456 (any 8-digit SL number)', () => {
    expect(slPhoneSchema.safeParse('+23230123456').success).toBe(true);
  });

  // Invalid format
  it('rejects less than 8 local digits (+2327612345 = only 7)', () => {
    expect(slPhoneSchema.safeParse('+2327612345').success).toBe(false);
  });
  it('rejects more than 8 local digits (+232761234567 = 9 digits)', () => {
    expect(slPhoneSchema.safeParse('+232761234567').success).toBe(false);
  });
  it('rejects non-SL country code (+447911123456)', () => {
    expect(slPhoneSchema.safeParse('+447911123456').success).toBe(false);
  });
  it('rejects US number (+15555551234)', () => {
    expect(slPhoneSchema.safeParse('+15555551234').success).toBe(false);
  });
  it('rejects letters in phone number', () => {
    expect(slPhoneSchema.safeParse('+232abc12345').success).toBe(false);
  });
  it('rejects spaces in phone number', () => {
    expect(slPhoneSchema.safeParse('+232 76 123456').success).toBe(false);
  });
  it('rejects symbols in phone number', () => {
    expect(slPhoneSchema.safeParse('+232-76-123456').success).toBe(false);
  });
  it('rejects empty string', () => {
    expect(slPhoneSchema.safeParse('').success).toBe(false);
  });
  it('rejects plain 8 digits without +232 (user must provide normalised form)', () => {
    expect(slPhoneSchema.safeParse('76123456').success).toBe(false);
  });

  // Security additions
  it('rejects leading zero after country code (+23201234567)', () => {
    expect(slPhoneSchema.safeParse('+23201234567').success).toBe(false);
  });
  it('rejects all-same-digit number (+23211111111)', () => {
    expect(slPhoneSchema.safeParse('+23211111111').success).toBe(false);
  });
  it('rejects all-zeros local number (+23200000000)', () => {
    expect(slPhoneSchema.safeParse('+23200000000').success).toBe(false);
  });
  it('rejects all-nines local number (+23299999999)', () => {
    expect(slPhoneSchema.safeParse('+23299999999').success).toBe(false);
  });
});

describe('normalizeToSierraLeone', () => {
  it('normalises 8 local digits → +232XXXXXXXX', () => {
    expect(normalizeToSierraLeone('76123456')).toBe('+23276123456');
  });
  it('normalises local number with leading 0 → strips 0, prepends +232', () => {
    expect(normalizeToSierraLeone('076123456')).toBe('+23276123456');
  });
  it('passes through already-normalised +232 number', () => {
    expect(normalizeToSierraLeone('+23276123456')).toBe('+23276123456');
  });
  it('strips spaces before normalising', () => {
    expect(normalizeToSierraLeone('76 123 456')).toBe('+23276123456');
  });
  it('returns empty string for empty input', () => {
    expect(normalizeToSierraLeone('')).toBe('');
  });
});

describe('isValidSierraLeonePhone', () => {
  it('accepts +23276123456', () => expect(isValidSierraLeonePhone('+23276123456')).toBe(true));
  it('rejects +447911123456', () => expect(isValidSierraLeonePhone('+447911123456')).toBe(false));
  it('rejects 76123456 (missing +232)', () => expect(isValidSierraLeonePhone('76123456')).toBe(false));
  it('rejects leading zero after 232 (+23201234567)', () => {
    expect(isValidSierraLeonePhone('+23201234567')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
describe('Email validation', () => {
  // Valid
  it('accepts name@example.com', () => {
    expect(emailSchema.safeParse('name@example.com').success).toBe(true);
  });
  it('accepts user.name+tag@domain.org', () => {
    expect(emailSchema.safeParse('user.name+tag@domain.org').success).toBe(true);
  });
  it('accepts subdomains like user@mail.example.co.uk', () => {
    expect(emailSchema.safeParse('user@mail.example.co.uk').success).toBe(true);
  });
  it('normalises to lowercase', () => {
    const result = emailSchema.safeParse('NAME@EXAMPLE.COM');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('name@example.com');
  });
  it('trims surrounding whitespace', () => {
    const result = emailSchema.safeParse('  user@example.com  ');
    expect(result.success).toBe(true);
  });

  // Invalid format
  it('rejects "test" (no @)', () => {
    expect(emailSchema.safeParse('test').success).toBe(false);
  });
  it('rejects "test@" (no domain)', () => {
    expect(emailSchema.safeParse('test@').success).toBe(false);
  });
  it('rejects "test@gmail" (no TLD)', () => {
    expect(emailSchema.safeParse('test@gmail').success).toBe(false);
  });
  it('rejects "test@gmail." (empty TLD)', () => {
    expect(emailSchema.safeParse('test@gmail.').success).toBe(false);
  });
  it('rejects "test@@gmail.com" (double @)', () => {
    expect(emailSchema.safeParse('test@@gmail.com').success).toBe(false);
  });
  it('rejects email with spaces inside', () => {
    expect(emailSchema.safeParse('te st@gmail.com').success).toBe(false);
  });
  it('rejects email over 254 characters', () => {
    const long = 'a'.repeat(250) + '@example.com';
    expect(emailSchema.safeParse(long).success).toBe(false);
  });
  it('rejects script injection in email', () => {
    expect(emailSchema.safeParse('<script>@gmail.com').success).toBe(false);
  });
  it('rejects double-dot in local part (test..name@gmail.com)', () => {
    expect(emailSchema.safeParse('test..name@gmail.com').success).toBe(false);
  });

  // RFC-5321 local-part checks
  it('accepts + tag address user+savings@example.com', () => {
    expect(emailSchema.safeParse('user+savings@example.com').success).toBe(true);
  });
  it('accepts underscore in local part user_name@example.com', () => {
    expect(emailSchema.safeParse('user_name@example.com').success).toBe(true);
  });
  it('rejects semicolon in local part user;name@example.com', () => {
    expect(emailSchema.safeParse('user;name@example.com').success).toBe(false);
  });
  it('rejects backslash in local part user\\name@example.com', () => {
    expect(emailSchema.safeParse('user\\name@example.com').success).toBe(false);
  });
  it('rejects angle-bracket XSS in local part <img@example.com', () => {
    expect(emailSchema.safeParse('<img@example.com').success).toBe(false);
  });
  it('rejects parenthesis in local part user(1)@example.com', () => {
    expect(emailSchema.safeParse('user(1)@example.com').success).toBe(false);
  });

  // Disposable domain blocklist
  it('rejects mailinator.com address', () => {
    expect(emailSchema.safeParse('user@mailinator.com').success).toBe(false);
  });
  it('rejects guerrillamail.com address', () => {
    expect(emailSchema.safeParse('user@guerrillamail.com').success).toBe(false);
  });
  it('rejects tempmail.com address', () => {
    expect(emailSchema.safeParse('user@tempmail.com').success).toBe(false);
  });
  it('rejects yopmail.com address', () => {
    expect(emailSchema.safeParse('user@yopmail.com').success).toBe(false);
  });
  it('rejects trashmail.com address', () => {
    expect(emailSchema.safeParse('user@trashmail.com').success).toBe(false);
  });
  it('rejects maildrop.cc address', () => {
    expect(emailSchema.safeParse('user@maildrop.cc').success).toBe(false);
  });
  it('accepts legitimate gmail.com address', () => {
    expect(emailSchema.safeParse('user@gmail.com').success).toBe(true);
  });
  it('accepts legitimate yahoo.com address', () => {
    expect(emailSchema.safeParse('user@yahoo.com').success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NAME VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
describe('Name validation', () => {
  // Valid
  it('accepts "Osman"', () => expect(nameSchema.safeParse('Osman').success).toBe(true));
  it('accepts "Amina"', () => expect(nameSchema.safeParse('Amina').success).toBe(true));
  it('accepts hyphenated name "Abu-Bakarr"', () => {
    expect(nameSchema.safeParse('Abu-Bakarr').success).toBe(true);
  });
  it('accepts apostrophe name "O\'Connor"', () => {
    expect(nameSchema.safeParse("O'Connor").success).toBe(true);
  });
  it('accepts accented name "Fàtimà"', () => {
    expect(nameSchema.safeParse('Fàtimà').success).toBe(true);
  });
  it('accepts two-part name "Mary Jane"', () => {
    expect(nameSchema.safeParse('Mary Jane').success).toBe(true);
  });
  // Min is now 1 char per spec
  it('accepts single-char name "A" (min is 1 per spec)', () => {
    expect(nameSchema.safeParse('A').success).toBe(true);
  });

  // Invalid format
  it('rejects "Osman123" (contains number)', () => {
    expect(nameSchema.safeParse('Osman123').success).toBe(false);
  });
  it('rejects "12345" (all numbers)', () => {
    expect(nameSchema.safeParse('12345').success).toBe(false);
  });
  it('rejects "@Osman" (symbol)', () => {
    expect(nameSchema.safeParse('@Osman').success).toBe(false);
  });
  it('rejects "<script>alert(1)</script>" (XSS payload)', () => {
    expect(nameSchema.safeParse('<script>alert(1)</script>').success).toBe(false);
  });
  it('rejects blank / whitespace only', () => {
    expect(nameSchema.safeParse('   ').success).toBe(false);
  });
  it('rejects name longer than 50 chars', () => {
    expect(nameSchema.safeParse('A'.repeat(51)).success).toBe(false);
  });
  it('rejects emoji in name', () => {
    expect(nameSchema.safeParse('Osman😀').success).toBe(false);
  });
  it('rejects # $ % in name', () => {
    expect(nameSchema.safeParse('Omar#1').success).toBe(false);
  });

  // Security additions — same-char rejection
  it('rejects all-same-char name "aaaaaaa"', () => {
    expect(nameSchema.safeParse('aaaaaaa').success).toBe(false);
  });
  it('rejects all-same-char name "NNNNNNN"', () => {
    expect(nameSchema.safeParse('NNNNNNN').success).toBe(false);
  });
  it('accepts mixed-char name "Anna" (not all same)', () => {
    expect(nameSchema.safeParse('Anna').success).toBe(true);
  });

  // Security additions — injection keyword rejection
  it('rejects injection keyword "admin"', () => {
    expect(nameSchema.safeParse('admin').success).toBe(false);
  });
  it('rejects injection keyword "null"', () => {
    expect(nameSchema.safeParse('null').success).toBe(false);
  });
  it('rejects injection keyword "undefined"', () => {
    expect(nameSchema.safeParse('undefined').success).toBe(false);
  });
  it('accepts legitimate name "Adam" (not in blocklist)', () => {
    expect(nameSchema.safeParse('Adam').success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NAME NORMALIZATION
// ─────────────────────────────────────────────────────────────────────────────
describe('normalizeNameInput', () => {
  it('trims leading and trailing whitespace', () => {
    expect(normalizeNameInput('  Osman  ')).toBe('Osman');
  });
  it('collapses multiple internal spaces to one', () => {
    expect(normalizeNameInput('Mary   Jane')).toBe('Mary Jane');
  });
  it('handles already-clean input without change', () => {
    expect(normalizeNameInput('Amina Kamara')).toBe('Amina Kamara');
  });
  it('handles single word', () => {
    expect(normalizeNameInput('Osman')).toBe('Osman');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DATE OF BIRTH VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
describe('Date of Birth validation', () => {
  const today = new Date();

  it('is required — rejects null', () => {
    expect(validateDateOfBirth(null)).not.toBeNull();
  });
  it('is required — rejects undefined', () => {
    expect(validateDateOfBirth(undefined)).not.toBeNull();
  });

  it('rejects a future date', () => {
    const future = new Date(today);
    future.setFullYear(today.getFullYear() + 1);
    expect(validateDateOfBirth(future)).not.toBeNull();
  });

  it('rejects today (must be in the past)', () => {
    expect(validateDateOfBirth(today)).not.toBeNull();
  });

  it('rejects someone under 18 (born 10 years ago)', () => {
    const minor = new Date(today);
    minor.setFullYear(today.getFullYear() - 10);
    expect(validateDateOfBirth(minor)).not.toBeNull();
  });

  it('rejects someone exactly 17 years old', () => {
    const d = new Date(today);
    d.setFullYear(today.getFullYear() - 17);
    d.setDate(d.getDate() + 1); // still 17
    expect(validateDateOfBirth(d)).not.toBeNull();
  });

  it('accepts someone exactly 18 years old', () => {
    const d = new Date(today);
    d.setFullYear(today.getFullYear() - 18);
    d.setDate(d.getDate() - 1); // just turned 18
    expect(validateDateOfBirth(d)).toBeNull();
  });

  it('accepts a valid adult DOB (born 1990)', () => {
    const dob = new Date('1990-06-15');
    expect(validateDateOfBirth(dob)).toBeNull();
  });

  it('accepts DOB for someone 65 years old', () => {
    const d = new Date(today);
    d.setFullYear(today.getFullYear() - 65);
    expect(validateDateOfBirth(d)).toBeNull();
  });

  it('rejects DOB over 120 years ago', () => {
    const old = new Date(today);
    old.setFullYear(today.getFullYear() - 125);
    expect(validateDateOfBirth(old)).not.toBeNull();
  });

  it('stores ISO date as YYYY-MM-DD', () => {
    const d = new Date(1990, 5, 15); // June 15, 1990
    expect(dobToISODate(d)).toBe('1990-06-15');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADDRESS VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
describe('Address validation', () => {
  // Valid
  it('accepts "12 Bai Bureh Road, Waterloo"', () => {
    expect(addressSchema.safeParse('12 Bai Bureh Road, Waterloo').success).toBe(true);
  });
  it('accepts "5 Old Road, Freetown"', () => {
    expect(addressSchema.safeParse('5 Old Road, Freetown').success).toBe(true);
  });
  it('accepts "Kono District"', () => {
    expect(addressSchema.safeParse('Kono District').success).toBe(true);
  });
  it('accepts "17 Main Street, Bo"', () => {
    expect(addressSchema.safeParse('17 Main Street, Bo').success).toBe(true);
  });
  it('accepts address with apostrophe and slash', () => {
    expect(addressSchema.safeParse("O'Brien's Lane / Block 3").success).toBe(true);
  });
  it('accepts address of exactly 200 chars', () => {
    // 200 letters — valid per new max
    const addr = 'A'.repeat(194) + ' Road.'; // 200 chars, has letters
    expect(addressSchema.safeParse(addr).success).toBe(true);
  });

  // Invalid
  it('rejects "12345" (numbers only, no letter)', () => {
    expect(addressSchema.safeParse('12345').success).toBe(false);
  });
  it('rejects "@@@@@" (symbols only)', () => {
    expect(addressSchema.safeParse('@@@@@').success).toBe(false);
  });
  it('rejects "<script>alert(1)</script>" (XSS)', () => {
    expect(addressSchema.safeParse('<script>alert(1)</script>').success).toBe(false);
  });
  it('rejects blank / whitespace only', () => {
    expect(addressSchema.safeParse('   ').success).toBe(false);
  });
  it('rejects address under 5 chars', () => {
    expect(addressSchema.safeParse('Road').success).toBe(false);
  });
  it('rejects address over 200 chars', () => {
    // 204 chars (68 × "Aa "), after trim still 203 — exceeds 200
    expect(addressSchema.safeParse('Aa '.repeat(68)).success).toBe(false);
  });
  it('rejects emoji in address', () => {
    expect(addressSchema.safeParse('12 Road 🏠 Freetown').success).toBe(false);
  });
  it('rejects SQL injection attempt', () => {
    expect(addressSchema.safeParse("'; DROP TABLE profiles; --").success).toBe(false);
  });

  // URL injection vector
  it('rejects address containing http:// URL', () => {
    expect(addressSchema.safeParse('12 Road http://malicious.com Freetown').success).toBe(false);
  });
  it('rejects address containing https:// URL', () => {
    expect(addressSchema.safeParse('https://evil.com').success).toBe(false);
  });
  it('rejects address containing www. pattern', () => {
    expect(addressSchema.safeParse('12 www.example.com Road').success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PASSWORD VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
describe('Password validation', () => {
  // Valid
  it('accepts "Freetown@2024"', () => {
    expect(passwordSchema.safeParse('Freetown@2024').success).toBe(true);
  });
  it('accepts "S!erra1Leone"', () => {
    expect(passwordSchema.safeParse('S!erra1Leone').success).toBe(true);
  });
  it('accepts max-length password (72 chars)', () => {
    const pw = 'Aa1!' + 'x'.repeat(68);
    expect(passwordSchema.safeParse(pw).success).toBe(true);
  });

  // Length
  it('rejects password under 8 chars', () => {
    expect(passwordSchema.safeParse('Aa1!x').success).toBe(false);
  });
  it('rejects password over 72 chars', () => {
    const pw = 'Aa1!' + 'x'.repeat(69);
    expect(passwordSchema.safeParse(pw).success).toBe(false);
  });

  // Missing character class
  it('rejects no uppercase "freetown@2024"', () => {
    expect(passwordSchema.safeParse('freetown@2024').success).toBe(false);
  });
  it('rejects no lowercase "FREETOWN@2024"', () => {
    expect(passwordSchema.safeParse('FREETOWN@2024').success).toBe(false);
  });
  it('rejects no number "Freetown@abcd"', () => {
    expect(passwordSchema.safeParse('Freetown@abcd').success).toBe(false);
  });
  it('rejects no special char "Freetown2024"', () => {
    expect(passwordSchema.safeParse('Freetown2024').success).toBe(false);
  });

  // Common passwords
  it('rejects "password123!"', () => {
    expect(passwordSchema.safeParse('password123!').success).toBe(false);
  });
  it('rejects "12345678" (all digits)', () => {
    expect(passwordSchema.safeParse('12345678').success).toBe(false);
  });
  it('rejects "welcome123!"', () => {
    expect(passwordSchema.safeParse('welcome123!').success).toBe(false);
  });

  // Repeated-character pattern (new rule)
  it('rejects password where all letters are the same (Aaaaaaaa1!)', () => {
    expect(passwordSchema.safeParse('Aaaaaaaa1!').success).toBe(false);
  });
  it('rejects all-uppercase-same-letter pattern (AAAAAAAA1@)', () => {
    expect(passwordSchema.safeParse('AAAAAAAA1@').success).toBe(false);
  });
  it('accepts password with varied letters (Aa1!Strong)', () => {
    expect(passwordSchema.safeParse('Aa1!Strong').success).toBe(true);
  });

  // getPasswordError helper
  it('getPasswordError returns null for valid password', () => {
    expect(getPasswordError('S!erra1Leone')).toBeNull();
  });
  it('getPasswordError returns message for weak password', () => {
    expect(getPasswordError('weak')).not.toBeNull();
  });
});

describe('Password strength indicator', () => {
  it('score 0 for empty string', () => {
    expect(getPasswordStrength('').score).toBe(0);
  });
  it('score 1 for only length met', () => {
    expect(getPasswordStrength('abcdefgh').score).toBe(1);
  });
  it('score 4 for "Aa1!strong"', () => {
    expect(getPasswordStrength('Aa1!strong').score).toBe(4);
    expect(getPasswordStrength('Aa1!strong').label).toBe('Strong');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PASSWORD CONTEXT VALIDATION (personal info matching)
// ─────────────────────────────────────────────────────────────────────────────
describe('validatePasswordContext', () => {
  it('rejects password containing first name', () => {
    expect(
      validatePasswordContext('Osman@2024!', { firstName: 'Osman' })
    ).not.toBeNull();
  });
  it('rejects password containing last name (case-insensitive)', () => {
    expect(
      validatePasswordContext('kamara@2024!', { lastName: 'Kamara' })
    ).not.toBeNull();
  });
  it('rejects password containing email local part', () => {
    expect(
      validatePasswordContext('myuser@2024!', { email: 'myuser@example.com' })
    ).not.toBeNull();
  });
  it('rejects password containing phone digits', () => {
    expect(
      validatePasswordContext('76123456Abc!', { phone: '+23276123456' })
    ).not.toBeNull();
  });
  it('accepts password with no personal info match', () => {
    expect(
      validatePasswordContext('Freetown@2024', {
        firstName: 'Osman',
        lastName: 'Kamara',
        email: 'osman@example.com',
        phone: '+23276123456',
      })
    ).toBeNull();
  });
  it('ignores fields shorter than 3 chars to avoid false positives', () => {
    // "Jo" is 2 chars — should not trigger
    expect(
      validatePasswordContext('Jo@2024Abc!', { firstName: 'Jo' })
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN IDENTIFIER VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
describe('Login identifier validation', () => {
  it('identifies email@domain.com as email type', () => {
    const r = validateLoginIdentifier('user@example.com');
    expect(r.type).toBe('email');
    expect(r.error).toBeNull();
  });
  it('normalises email to lowercase', () => {
    const r = validateLoginIdentifier('USER@EXAMPLE.COM');
    expect(r.normalized).toBe('user@example.com');
  });
  it('rejects invalid email', () => {
    const r = validateLoginIdentifier('notanemail@');
    expect(r.error).not.toBeNull();
  });
  it('identifies 76123456 as phone type', () => {
    const r = validateLoginIdentifier('76123456');
    expect(r.type).toBe('phone');
    expect(r.normalized).toBe('+23276123456');
    expect(r.error).toBeNull();
  });
  it('accepts +23276123456 as valid SL phone login', () => {
    const r = validateLoginIdentifier('+23276123456');
    expect(r.type).toBe('phone');
    expect(r.error).toBeNull();
  });
  it('rejects +447911123456 as phone (non-SL)', () => {
    const r = validateLoginIdentifier('+447911123456');
    expect(r.type).toBe('phone');
    expect(r.error).not.toBeNull();
  });
  it('rejects phone with wrong digit count (7 digits)', () => {
    const r = validateLoginIdentifier('7612345');
    expect(r.error).not.toBeNull();
  });
  it('rejects phone with 9 local digits', () => {
    const r = validateLoginIdentifier('761234567');
    expect(r.error).not.toBeNull();
  });

  // Security — enumeration resistance
  it('does not distinguish unknown email from valid email (no error on format)', () => {
    const r = validateLoginIdentifier('unknown@example.com');
    expect(r.error).toBeNull(); // format valid; existence checked server-side only
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SIGNUP SECURITY CHECKS
// ─────────────────────────────────────────────────────────────────────────────
describe('Signup security checks', () => {
  it('name rejects XSS payload', () => {
    expect(nameSchema.safeParse('<script>alert(1)</script>').success).toBe(false);
  });
  it('name rejects SQL injection attempt', () => {
    expect(nameSchema.safeParse("'; DROP TABLE profiles;--").success).toBe(false);
  });
  it('email rejects XSS in local part', () => {
    expect(emailSchema.safeParse('<img src=x onerror=alert(1)>@x.com').success).toBe(false);
  });
  it('address rejects SELECT keyword (SQL injection pattern)', () => {
    expect(addressSchema.safeParse('SELECT * FROM profiles').success).toBe(false);
  });
  it('address rejects DROP TABLE (SQL injection pattern)', () => {
    expect(addressSchema.safeParse('12 DROP TABLE Road').success).toBe(false);
  });
  it('address rejects script tag', () => {
    expect(addressSchema.safeParse('<script>alert(1)</script>').success).toBe(false);
  });
  it('email rejects disposable domain (guerrillamail)', () => {
    expect(emailSchema.safeParse('attacker@guerrillamail.com').success).toBe(false);
  });
  it('phone rejects all-same-digit', () => {
    expect(slPhoneSchema.safeParse('+23222222222').success).toBe(false);
  });
  it('phone rejects leading-zero-after-232', () => {
    expect(slPhoneSchema.safeParse('+23209999999').success).toBe(false);
  });
  it('address rejects URL injection', () => {
    expect(addressSchema.safeParse('12 Road http://evil.com').success).toBe(false);
  });
  it('password rejects repeated-letter pattern', () => {
    expect(passwordSchema.safeParse('Bbbbbbbb2@').success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ERROR MESSAGE — ACCOUNT ENUMERATION RESISTANCE
// ─────────────────────────────────────────────────────────────────────────────
describe('Error messages — account enumeration resistance', () => {
  it('MSG_SIGNUP_FAILED contains no hint about existing accounts', () => {
    const lower = MSG_SIGNUP_FAILED.toLowerCase();
    expect(lower).not.toContain('already have');
    expect(lower).not.toContain('account recovery');
    expect(lower).not.toContain('already exists');
    expect(lower).not.toContain('registered');
  });

  it('MSG_LOGIN_FAILED contains no hints about email or phone existence', () => {
    const lower = MSG_LOGIN_FAILED.toLowerCase();
    expect(lower).not.toContain('not found');
    expect(lower).not.toContain('does not exist');
    expect(lower).not.toContain('no account');
  });
});
