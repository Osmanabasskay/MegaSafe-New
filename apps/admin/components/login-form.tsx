'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export const LoginForm = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    let data: { ok?: boolean; error?: string };
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      data = (await res.json()) as { ok?: boolean; error?: string };
    } catch {
      setError('Network error. Check your connection and try again.');
      setLoading(false);
      return;
    }

    if (data.error) {
      const friendlyMessages: Record<string, string> = {
        rate_limited: 'Too many sign-in attempts. Please wait a minute and try again.',
        ip_not_allowed: 'Access from your network is not permitted.',
      };
      setError(friendlyMessages[data.error] ?? data.error);
      setLoading(false);
      return;
    }

    router.push('/admin');
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-400">Email address</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="username"
          className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:border-orange-500 focus:outline-none"
          placeholder="admin@miosusu.sl"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-400">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:border-orange-500 focus:outline-none"
          placeholder="••••••••"
        />
      </div>
      {error ? (
        <div className="rounded-xl border border-rose-800 bg-rose-950 p-3 text-xs text-rose-300">
          {error}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-orange-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-orange-600 disabled:opacity-50"
      >
        {loading ? 'Signing in…' : 'Sign In as Super Admin'}
      </button>
    </form>
  );
};
