'use client';

import {FormEvent, useState} from 'react';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({username, password})
    });
    await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(response.status === 503 ? 'Authentication is not bootstrapped yet.' : 'Invalid username or password.');
      setBusy(false);
      return;
    }
    const next = new URLSearchParams(window.location.search).get('next') || '/';
    window.location.assign(next.startsWith('/') ? next : '/');
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0d111b] px-4 text-white">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.045] p-8 shadow-2xl">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-300">Chameleon Operations</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">Use your Operations account to access the LAB workspace.</p>
        <form className="mt-8 space-y-4" onSubmit={submit}>
          <label className="block text-sm font-semibold text-slate-200">
            Username or email
            <input className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white outline-none focus:border-blue-300/60" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required />
          </label>
          <label className="block text-sm font-semibold text-slate-200">
            Password
            <input className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white outline-none focus:border-blue-300/60" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required />
          </label>
          {error ? <p className="rounded-xl border border-rose-300/20 bg-rose-300/[0.06] px-3 py-3 text-sm text-rose-100">{error}</p> : null}
          <button className="w-full rounded-xl bg-blue-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
