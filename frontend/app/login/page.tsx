'use client';

import { X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

const api = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [googleDialogOpen, setGoogleDialogOpen] = useState(false);
  const [googleEmail, setGoogleEmail] = useState('');
  const [googleName, setGoogleName] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    const googleSuccess = searchParams.get('google') === 'success';
    if (!googleSuccess || !token) return;

    const finishGoogleLogin = async () => {
      localStorage.setItem('token', token);
      try {
        const response = await fetch(`${api}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.user) {
          throw new Error(data?.error || 'Unable to load user profile');
        }
        localStorage.setItem('user', JSON.stringify(data.user));
        const nextUrl = new URL(window.location.href);
        nextUrl.search = '';
        window.history.replaceState({}, '', nextUrl.toString().replace(window.location.origin, ''));
        router.push('/dashboard');
      } catch {
        setError('Google sign-in is incomplete. Please try again.');
      }
    };

    void finishGoogleLogin();
  }, [router, searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const response = await fetch(`${api}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = response.ok ? await response.json() : null;
      if (!response.ok) {
        setError(data?.error || 'Login failed');
        return;
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      router.push('/dashboard');
    } catch {
      setError('Could not reach the backend server.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleLogin() {
    setError('');

    try {
      const response = await fetch(`${api}/api/auth/google/login-url`);
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setGoogleDialogOpen(true);
        return;
      }

      if (!data?.url) {
        throw new Error('Google auth is unavailable.');
      }

      window.location.href = data.url;
    } catch {
      setGoogleDialogOpen(true);
    }
  }

  async function handleGoogleFallbackSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const response = await fetch(`${api}/api/auth/google`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: googleEmail,
          name: googleName || googleEmail.split('@')[0],
          image: ''
        })
      });

      const data = response.ok ? await response.json() : null;
      if (!response.ok) {
        setError(data?.error || 'Google sign-in failed');
        return;
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setGoogleDialogOpen(false);
      router.push('/dashboard');
    } catch {
      setError('Google sign-in is unavailable right now.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#1a1a1a] p-6">
      <div className="w-full max-w-[420px] rounded-[18px] border border-[#e5e7eb] bg-[#f3f5f3] p-8 shadow-[0_18px_40px_rgba(0,0,0,0.12)]">
        <h1 className="mb-7 text-center text-3xl font-semibold text-[#1b1b1b]">Login</h1>

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={submitting}
          className="mb-5 flex w-full items-center justify-center gap-2 rounded-md border border-[#d5e8db] bg-[#eaf5ee] px-4 py-3 text-sm font-medium text-[#1d2b23] transition hover:bg-[#deefe4] disabled:cursor-not-allowed disabled:opacity-70"
        >
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#5bbd7d] text-[10px] text-white">G</span>
          Login with Google
        </button>

        <div className="mb-5 flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.2em] text-[#7f8a84]">
          <div className="h-px flex-1 bg-[#d9dfd8]" />
          or
          <div className="h-px flex-1 bg-[#d9dfd8]" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-2 block text-sm text-[#2d2d2d]">Email ID</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-md border border-[#dfe5df] bg-white px-3 py-2.5 text-sm outline-none ring-0 transition focus:border-[#5bbd7d]"
              placeholder="Enter email"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#2d2d2d]">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-md border border-[#dfe5df] bg-white px-3 py-2.5 text-sm outline-none ring-0 transition focus:border-[#5bbd7d]"
              placeholder="Password"
            />
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 w-full rounded-md bg-[#4fcf85] px-4 py-3 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(79,207,133,0.25)] transition hover:bg-[#43c57b] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitting ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <div className="mt-4 text-center text-sm text-[#627168]">
          <span>Don’t have an account? </span>
          <button
            type="button"
            onClick={() => {
              localStorage.setItem('user', JSON.stringify({ name: 'Guest', email: 'Guest' }));
              localStorage.setItem('token', 'guest');
              router.push('/dashboard');
            }}
            className="font-semibold text-[#1d2b23] underline decoration-[#7ecaa5] underline-offset-2"
          >
            Continue as guest
          </button>
        </div>
      </div>

      {googleDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#111827]">Google sign-in</h2>
              <button type="button" onClick={() => setGoogleDialogOpen(false)} className="text-[#5b6470]">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleGoogleFallbackSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm text-[#374151]">Google email</label>
                <input
                  type="email"
                  value={googleEmail}
                  onChange={(e) => setGoogleEmail(e.target.value)}
                  required
                  className="w-full rounded-md border border-[#e5e7eb] px-3 py-2.5 text-sm outline-none"
                  placeholder="you@gmail.com"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-[#374151]">Display name</label>
                <input
                  type="text"
                  value={googleName}
                  onChange={(e) => setGoogleName(e.target.value)}
                  placeholder="Your name"
                  className="w-full rounded-md border border-[#e5e7eb] px-3 py-2.5 text-sm outline-none"
                />
              </div>
              <button type="submit" className="w-full rounded-md bg-[#4fcf85] px-4 py-3 text-sm font-semibold text-white">
                Continue with Google account
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}
