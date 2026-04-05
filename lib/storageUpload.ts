import { supabase } from './supabase';

function guessContentType(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.includes('.png')) return 'image/png';
  if (lower.includes('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/** Upload a local file URI to a Supabase Storage bucket. */
export async function uploadFromUri(
  bucket: string,
  objectPath: string,
  uri: string
): Promise<{ error: Error | null }> {
  try {
    const response = await fetch(uri);
    const blob = await response.blob();
    const contentType =
      blob.type && blob.type !== 'application/octet-stream'
        ? blob.type
        : guessContentType(uri);

    const { error } = await supabase.storage.from(bucket).upload(objectPath, blob, {
      contentType,
      upsert: true,
    });

    if (error) return { error: new Error(error.message) };
    return { error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Upload failed';
    return { error: new Error(message) };
  }
}
