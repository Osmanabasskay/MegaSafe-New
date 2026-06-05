/**
 * Catch-all "unmatched route" screen.
 *
 * Why this exists
 * ───────────────
 * The app uses Expo Router route *groups* — folders wrapped in parentheses such
 * as `(auth)`, `(main)`, `(groups)`, `(kyc)`, `(settings)`, `(send)`. Per Expo
 * Router semantics these group segments are **stripped from the URL**, so the
 * screen at `app/(main)/vault.tsx` is served at `/vault`, not `/main/vault`.
 *
 * Automated tools (e.g. TestSprite) and humans frequently *derive* a URL from
 * the file tree and navigate to `/main/vault`, `/groups/discover`,
 * `/(auth)/login`, etc. Those paths do not match any route, so the user lands on
 * this not-found screen and the feature appears "missing".
 *
 * Rather than dead-end, we transparently rewrite the URL by dropping any leading
 * route-group segment (bare like `main` or parenthesized like `(main)`) and
 * redirect to the real path. `/main/vault` → `/vault`, `/groups/discover` →
 * `/discover`, `/(auth)/login` → `/login`. Genuine 404s (no group segment to
 * strip) fall through to a real, interactive not-found UI.
 */
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Redirect, useRouter, usePathname, type Href } from 'expo-router';

/** Route-group folder names whose segment never appears in the real URL. */
const GROUP_SEGMENTS = new Set([
  'auth',
  'main',
  'groups',
  'kyc',
  'settings',
  'send',
]);

/**
 * Strip leading/inner route-group segments from an attempted path.
 * Returns the resolved path, or the original if nothing could be stripped.
 */
export function resolveGroupPath(rawPath: string): string {
  const [pathOnly] = rawPath.split('?');
  const segments = pathOnly.split('/').filter(Boolean);

  const cleaned = segments.filter((seg) => {
    const isParenGroup = /^\(.*\)$/.test(seg); // "(auth)"
    const bare = seg.replace(/^\(|\)$/g, ''); // "(auth)" → "auth"
    return !(isParenGroup || GROUP_SEGMENTS.has(bare));
  });

  if (cleaned.length === 0) return '/';
  return '/' + cleaned.join('/');
}

export default function NotFoundScreen() {
  const router = useRouter();
  const routerPathname = usePathname();

  // On web, prefer the raw browser path: it preserves the exact (possibly
  // group-prefixed) URL the tool/user navigated to, including the query string.
  const rawPath =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location.pathname + window.location.search
      : routerPathname;

  const [pathOnly, query] = rawPath.split('?');
  const resolved = resolveGroupPath(pathOnly);

  // Only redirect when stripping group segments actually changed the path —
  // otherwise we'd loop forever on a genuine unmatched route.
  if (resolved !== pathOnly) {
    const target = (query ? `${resolved}?${query}` : resolved) as Href;
    return <Redirect href={target} />;
  }

  // Genuine 404 — render an interactive screen (never a blank page).
  return (
    <View style={styles.container}>
      <Text style={styles.code}>404</Text>
      <Text style={styles.title}>Page could not be found</Text>
      <Text style={styles.path} selectable>
        {pathOnly}
      </Text>
      <Text
        style={styles.link}
        accessibilityRole="link"
        onPress={() => router.replace('/' as Href)}
      >
        Go to home
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#FAF7F2',
    gap: 8,
  },
  code: { fontSize: 56, fontWeight: '800', color: '#F97316' },
  title: { fontSize: 18, fontWeight: '700', color: '#111827' },
  path: { fontSize: 13, color: '#6B7280', marginTop: 4 },
  link: {
    marginTop: 20,
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    backgroundColor: '#F97316',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 14,
    overflow: 'hidden',
  },
});
