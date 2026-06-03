'use client';

import { useState } from 'react';

export const LogoutButton = () => {
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    setLoading(true);
    // POST to server route so it can call supabase.auth.signOut() server-side
    // and clear the httpOnly cookies (role cache + session) that client JS cannot touch.
    await fetch('/api/logout', { method: 'POST' });
    // The server route redirects to /login via 303; follow it.
    window.location.href = '/login';
  };

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50"
    >
      {loading ? 'Signing out…' : 'Sign Out'}
    </button>
  );
};
