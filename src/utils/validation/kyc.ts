import { z } from 'zod';
import { isValidSierraLeonePhone, normalizeToSierraLeone } from '../../services/auth/phone';

export const nationalIdTypes = [
  { value: 'national_id', label: 'National ID' },
  { value: 'passport', label: 'Passport' },
  { value: 'drivers_license', label: "Driver's license" },
  { value: 'voters_card', label: "Voter's card" },
] as const;

/**
 * Sierra Leone phone field. The UI renders a "+232" label, so the user types
 * only the local digits; we accept any local format (with/without leading 0 or
 * +232) and validate that it canonicalises to +232 followed by 8 digits — the
 * exact shape profiles.phone's DB CHECK constraint requires.
 */
const sierraLeonePhone = z
  .string()
  .trim()
  .min(1, 'Phone is required')
  .refine((v) => isValidSierraLeonePhone(normalizeToSierraLeone(v)), {
    message: 'Enter a valid Sierra Leone number — 8 digits after +232 (e.g. 088 123 456)',
  });

/**
 * Person-name field mirroring the profiles DB CHECK constraints
 * (first_name/last_name: 2–50 characters, no digits). Validating here means the
 * KYC form surfaces a clear error instead of the submission being rolled back by
 * the database after the documents have already uploaded.
 */
const personName = (label: string) =>
  z
    .string()
    .trim()
    .min(2, `${label} must be at least 2 characters`)
    .max(50, `${label} must be 50 characters or fewer`)
    .regex(/^[^0-9]*$/, `${label} cannot contain numbers`);

export const kycDetailsSchema = z.object({
  firstName: personName('First name'),
  lastName: personName('Last name'),
  phone: sierraLeonePhone,
  dateOfBirth: z
    .string()
    .trim()
    .min(1, 'Date of birth is required')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  gender: z.enum(['male', 'female', 'other'], {
    message: 'Select gender',
  }),
  addressLine1: z.string().trim().min(1, 'Address is required'),
  addressLine2: z.string().trim().optional(),
  city: z.string().trim().min(1, 'City is required'),
  stateProvince: z.string().trim().optional(),
  postalCode: z.string().trim().optional(),
  countryId: z.string().min(1, 'Select your country').uuid('Select your country'),
  nationalIdType: z.enum(['national_id', 'passport', 'drivers_license', 'voters_card']),
  nationalIdNumber: z.string().trim().min(3, 'ID number is required'),
});

export type KycDetailsForm = z.infer<typeof kycDetailsSchema>;

export const guarantorSchema = z.object({
  guarantorName: z.string().trim().min(1, 'Name is required'),
  guarantorPhone: sierraLeonePhone,
  guarantorEmail: z.union([z.literal(''), z.string().trim().email()]),
  guarantorAddress: z.string().trim().min(1, 'Address is required'),
  relationship: z.string().trim().min(1, 'Relationship is required'),
  nationalIdType: z.enum(['national_id', 'passport', 'drivers_license', 'voters_card']),
  nationalIdNumber: z.string().trim().min(3, 'ID number is required'),
});

export type GuarantorForm = z.infer<typeof guarantorSchema>;
