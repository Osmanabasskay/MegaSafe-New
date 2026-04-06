import { create } from 'zustand';
import { Session, User } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from '../lib/supabase';
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
    const { data: { session }, error } = await supabase.auth.getSession();
    if (session) {
      set({ session, user: session.user, isLoading: false });
    } else {
      set({ session: null, user: null, isLoading: false });
    }
  },
}));
