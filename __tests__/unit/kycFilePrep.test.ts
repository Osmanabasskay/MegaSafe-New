/**
 * kycFilePrep.test.ts
 *
 * Unit tests for prepareKycFileForUpload() — a pure function with no external
 * dependencies (no mocks needed for this file).
 *
 * Covers: MIME detection (explicit, extension, magic bytes, camera fallback),
 * size validation, error type guards, extension derivation.
 */

import { describe, it, expect } from 'vitest';
import {
  prepareKycFileForUpload,
  isPrepareError,
  MAX_FILE_SIZE_BYTES,
  type PreparedKycFile,
  type PrepareKycFileError,
} from '../../src/utils/kyc/prepareKycFileForUpload';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal base64 string of the requested approximate byte size. */
function makeBase64OfSize(bytes: number): string {
  // 4 chars of base64 ≈ 3 bytes
  return 'A'.repeat(Math.ceil((bytes * 4) / 3));
}

/** Smallest valid JPEG magic bytes in base64. */
const JPEG_PREFIX = '/9j/4AAQSkZJRgAB'; // starts with /9j/

/** Smallest valid PNG magic bytes in base64. */
const PNG_PREFIX = 'iVBORw0KGgoAAAANSUhEUgAAAAE='; // starts with iVBOR

/** PDF magic bytes in base64. */
const PDF_PREFIX = 'JVBERi0xLjQ='; // starts with JVBER

// ── URI required ─────────────────────────────────────────────────────────────

describe('prepareKycFileForUpload — URI validation', () => {
  it('returns error when uri is empty string', () => {
    const result = prepareKycFileForUpload({ uri: '', base64: 'abc', mimeType: 'image/jpeg' });
    expect(isPrepareError(result)).toBe(true);
    expect((result as PrepareKycFileError).userMessage).toMatch(/No file selected/i);
  });

  it('returns error when uri is whitespace only', () => {
    const result = prepareKycFileForUpload({ uri: '   ', base64: 'abc', mimeType: 'image/jpeg' });
    expect(isPrepareError(result)).toBe(true);
  });
});

// ── base64 required ───────────────────────────────────────────────────────────

describe('prepareKycFileForUpload — base64 validation', () => {
  it('returns error when base64 is null', () => {
    const result = prepareKycFileForUpload({ uri: 'file://photo.jpg', base64: null });
    expect(isPrepareError(result)).toBe(true);
    expect((result as PrepareKycFileError).userMessage).toMatch(/Could not read file data/i);
  });

  it('returns error when base64 is empty string', () => {
    const result = prepareKycFileForUpload({ uri: 'file://photo.jpg', base64: '' });
    expect(isPrepareError(result)).toBe(true);
  });

  it('returns error when base64 is whitespace only', () => {
    const result = prepareKycFileForUpload({ uri: 'file://photo.jpg', base64: '   ' });
    expect(isPrepareError(result)).toBe(true);
  });
});

// ── MIME detection ────────────────────────────────────────────────────────────

describe('prepareKycFileForUpload — MIME type detection', () => {
  it('uses explicit mimeType from picker when present (JPEG)', () => {
    const result = prepareKycFileForUpload({
      uri: 'content://image',
      base64: JPEG_PREFIX,
      mimeType: 'image/jpeg',
    });
    expect(isPrepareError(result)).toBe(false);
    expect((result as PreparedKycFile).mimeType).toBe('image/jpeg');
    expect((result as PreparedKycFile).extension).toBe('jpg');
  });

  it('uses explicit mimeType from picker when present (PNG)', () => {
    const result = prepareKycFileForUpload({
      uri: 'content://image',
      base64: PNG_PREFIX,
      mimeType: 'image/png',
    });
    expect(isPrepareError(result)).toBe(false);
    expect((result as PreparedKycFile).mimeType).toBe('image/png');
    expect((result as PreparedKycFile).extension).toBe('png');
  });

  it('uses explicit mimeType for PDF', () => {
    const result = prepareKycFileForUpload({
      uri: 'content://document.pdf',
      base64: PDF_PREFIX,
      mimeType: 'application/pdf',
    });
    expect(isPrepareError(result)).toBe(false);
    expect((result as PreparedKycFile).mimeType).toBe('application/pdf');
    expect((result as PreparedKycFile).extension).toBe('pdf');
  });

  it('falls back to file extension when mimeType is absent (.jpg)', () => {
    const result = prepareKycFileForUpload({
      uri: 'file:///storage/id_photo.jpg',
      base64: 'AAABBB',
      mimeType: null,
    });
    expect(isPrepareError(result)).toBe(false);
    expect((result as PreparedKycFile).mimeType).toBe('image/jpeg');
  });

  it('falls back to file extension when mimeType is absent (.jpeg)', () => {
    const result = prepareKycFileForUpload({
      uri: 'file:///storage/id_photo.jpeg',
      base64: 'AAABBB',
      mimeType: null,
    });
    expect(isPrepareError(result)).toBe(false);
    expect((result as PreparedKycFile).mimeType).toBe('image/jpeg');
  });

  it('falls back to file extension (.png)', () => {
    const result = prepareKycFileForUpload({
      uri: 'file:///storage/id_photo.png',
      base64: 'AAABBB',
      mimeType: null,
    });
    expect(isPrepareError(result)).toBe(false);
    expect((result as PreparedKycFile).mimeType).toBe('image/png');
  });

  it('falls back to magic bytes — JPEG prefix /9j/', () => {
    const result = prepareKycFileForUpload({
      uri: 'content://cache/photo',   // no extension, no explicit MIME
      base64: JPEG_PREFIX,
      mimeType: null,
      fileName: null,
    });
    expect(isPrepareError(result)).toBe(false);
    expect((result as PreparedKycFile).mimeType).toBe('image/jpeg');
  });

  it('falls back to magic bytes — PNG prefix iVBOR', () => {
    const result = prepareKycFileForUpload({
      uri: 'content://cache/photo',
      base64: PNG_PREFIX,
      mimeType: null,
      fileName: null,
    });
    expect(isPrepareError(result)).toBe(false);
    expect((result as PreparedKycFile).mimeType).toBe('image/png');
  });

  it('falls back to magic bytes — PDF prefix JVBER', () => {
    const result = prepareKycFileForUpload({
      uri: 'content://cache/document',
      base64: PDF_PREFIX,
      mimeType: null,
      fileName: null,
    });
    expect(isPrepareError(result)).toBe(false);
    expect((result as PreparedKycFile).mimeType).toBe('application/pdf');
  });

  it('falls back to JPEG for camera file:// URI with no extension or MIME', () => {
    const result = prepareKycFileForUpload({
      uri: 'file:///data/user/0/com.app/cache/ExponentCamera',
      base64: makeBase64OfSize(100),
      mimeType: null,
      fileName: null,
    });
    // camera always produces JPEG as per the fallback rule
    expect(isPrepareError(result)).toBe(false);
    expect((result as PreparedKycFile).mimeType).toBe('image/jpeg');
  });

  it('returns error for unsupported type (webp)', () => {
    const result = prepareKycFileForUpload({
      uri: 'file:///photo.webp',
      base64: 'AAABBB',
      mimeType: 'image/webp',
    });
    expect(isPrepareError(result)).toBe(true);
    expect((result as PrepareKycFileError).userMessage).toMatch(/not supported/i);
  });

  it('returns error when MIME cannot be detected at all', () => {
    // no mimeType, no recognisable extension, no magic bytes, not a file:// URI
    const result = prepareKycFileForUpload({
      uri: 'blob:unknown',
      base64: 'AAAAAA',
      mimeType: null,
      fileName: null,
    });
    expect(isPrepareError(result)).toBe(true);
    expect((result as PrepareKycFileError).userMessage).toMatch(/detect file type/i);
  });
});

// ── File size validation ──────────────────────────────────────────────────────

describe('prepareKycFileForUpload — size validation', () => {
  it('accepts a file exactly at the 5 MB limit', () => {
    const result = prepareKycFileForUpload({
      uri: 'file://photo.jpg',
      base64: makeBase64OfSize(MAX_FILE_SIZE_BYTES),
      mimeType: 'image/jpeg',
      fileSize: MAX_FILE_SIZE_BYTES,   // explicit fileSize used in preference
    });
    expect(isPrepareError(result)).toBe(false);
  });

  it('rejects a file 1 byte over the 5 MB limit via explicit fileSize', () => {
    const result = prepareKycFileForUpload({
      uri: 'file://photo.jpg',
      base64: 'AAABBB',
      mimeType: 'image/jpeg',
      fileSize: MAX_FILE_SIZE_BYTES + 1,
    });
    expect(isPrepareError(result)).toBe(true);
    expect((result as PrepareKycFileError).userMessage).toMatch(/too large/i);
    expect((result as PrepareKycFileError).userMessage).toMatch(/5 MB/i);
  });

  it('rejects a file over the limit inferred from base64 length', () => {
    // ~6 MB of data
    const bigBase64 = makeBase64OfSize(6 * 1024 * 1024);
    const result = prepareKycFileForUpload({
      uri: 'file://photo.jpg',
      base64: bigBase64,
      mimeType: 'image/jpeg',
      fileSize: null,   // force estimation from base64
    });
    expect(isPrepareError(result)).toBe(true);
    expect((result as PrepareKycFileError).userMessage).toMatch(/too large/i);
  });

  it('strips data-URI prefix before estimating size', () => {
    const raw = 'AAABBBCCC'; // tiny payload
    const withPrefix = `data:image/jpeg;base64,${raw}`;
    const result = prepareKycFileForUpload({
      uri: 'file://photo.jpg',
      base64: withPrefix,
      mimeType: 'image/jpeg',
    });
    // Should succeed (tiny payload)
    expect(isPrepareError(result)).toBe(false);
    // base64 in result should have the prefix stripped
    expect((result as PreparedKycFile).base64).not.toContain('data:');
  });
});

// ── Return shape ─────────────────────────────────────────────────────────────

describe('prepareKycFileForUpload — return shape', () => {
  it('returns uri, base64, mimeType, extension, sizeBytes for valid input', () => {
    const result = prepareKycFileForUpload({
      uri: 'file://id_front.png',
      base64: PNG_PREFIX,
      mimeType: 'image/png',
      fileSize: 1024,
    });

    expect(isPrepareError(result)).toBe(false);
    const prepared = result as PreparedKycFile;
    expect(prepared.uri).toBe('file://id_front.png');
    expect(prepared.mimeType).toBe('image/png');
    expect(prepared.extension).toBe('png');
    expect(prepared.sizeBytes).toBe(1024);
    expect(prepared.base64).toBeTruthy();
  });
});

// ── isPrepareError type guard ─────────────────────────────────────────────────

describe('isPrepareError', () => {
  it('returns true for PrepareKycFileError objects', () => {
    const err: PrepareKycFileError = { userMessage: 'Something went wrong.' };
    expect(isPrepareError(err)).toBe(true);
  });

  it('returns false for PreparedKycFile objects', () => {
    const ok: PreparedKycFile = {
      uri: 'file://photo.jpg',
      base64: 'AAABBB',
      mimeType: 'image/jpeg',
      extension: 'jpg',
      sizeBytes: 100,
    };
    expect(isPrepareError(ok)).toBe(false);
  });
});
