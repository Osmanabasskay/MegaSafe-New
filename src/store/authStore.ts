import { create } from 'zustand';
import { Session, User } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from '../services/supabase';
import { useKycDraftStore } from './kycDraftStore';

interface AuthState {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setSession: (session: Session | null) => void;
  setLoading: (isLoading: boolean) => void;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  session: null,
  isLoading: true,
  setUser: (user) => set({ user }),
  setSession: (session) => set({ session }),
  setLoading: (isLoading) => set({ isLoading }),
  logout: async () => {
    set({ isLoading: true });
    try {
      if (supabaseConfigured) {
        await supabase.auth.signOut();
      }
    } catch (error) {
      if (__DEV__) {
        console.warn('[Auth] Sign out warning:', error);
      }
    } finally {
      useKycDraftStore.getState().reset();
      set({ user: null, session: null, isLoading: false });
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
      set({ session, user, isLoading: false });
    } catch (err) {
      if (__DEV__) console.warn('[Auth] Session refresh failed:', err);
      set({ session: null, user: null, isLoading: false });
    }
  },
}));
