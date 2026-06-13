import { create } from 'zustand';
import { Session, User } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from '../services/supabase';
import { useKycDraftStore } from './kycDraftStore';
import { useAppDataStore } from './appDataStore';

interface AuthState {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  /** True when the session is AAL1 and the user has a TOTP factor that needs challenging. */
  needsMfaChallenge: boolean;
  setUser: (user: User | null) => void;
  setSession: (session: Session | null) => void;
  setLoading: (isLoading: boolean) => void;
  setNeedsMfaChallenge: (v: boolean) => void;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  session: null,
  isLoading: true,
  needsMfaChallenge: false,
  setUser: (user) => set({ user }),
  setSession: (session) => set({ session }),
  setLoading: (isLoading) => set({ isLoading }),
  setNeedsMfaChallenge: (v) => set({ needsMfaChallenge: v }),
  logout: async () => {
    set({ isLoading: true });
    // Capture user_id before clearing state, for audit log
    const userId = get().user?.id ?? null;
    try {
      if (supabaseConfigured) {
        // Section G: server-side refresh token invalidation (not just local clear)
        await supabase.auth.signOut();
      }
    } catch (error) {
      if (__DEV__) {
        console.warn('[Auth] Sign out warning:', error);
      }
    } finally {
      // Section G: clear all in-memory user data
      useKycDraftStore.getState().reset();
      useAppDataStore.getState().clearForLogout();
      set({ user: null, session: null, isLoading: false });

      // Section I: log logout event (fire-and-forget, must not block navigation)
      if (userId && supabaseConfigured) {
        void supabase.rpc('create_audit_log', {
          p_action:     'logout',
          p_table_name: 'profiles',
          p_record_id:  userId,
          p_old_data:   null,
          p_new_data:   { reason: 'user_initiated' },
        }).then(undefined, () => {}); // fire-and-forget; swallow errors
      }
    }
  },
  refreshSession: async () => {
    set({ isLoading: true });
    if (!supabaseConfigured) {
      set({ session: null, user: null, isLoading: false });
      return;
    }
    try {
      // getUser() always makes a network request to verify the token against
      // Supabase's servers — unlike getSession() which reads from local storage
      // and would return a revoked/suspended user as still "authenticated".
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) {
        set({ session: null, user: null, isLoading: false });
        return;
      }
      // getSession() is safe here as a follow-up — we've already verified the
      // token is valid via getUser(); we just need the session object for the store.
      const { data: { session } } = await supabase.auth.getSession();

      // MFA: check if this restored session needs an AAL2 challenge.
      // If so, the app layout will redirect to /(auth)/mfa-challenge.
      let needsMfa = false;
      try {
        const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        needsMfa =
          aalData?.nextLevel === 'aal2' && aalData.currentLevel !== 'aal2';
      } catch {
        // Non-fatal — err on the side of allowing access if the AAL check fails
      }

      set({ session, user, isLoading: false, needsMfaChallenge: needsMfa });
    } catch (err) {
      if (__DEV__) console.warn('[Auth] Session refresh failed:', err);
      set({ session: null, user: null, isLoading: false });
    }
  },
}));
