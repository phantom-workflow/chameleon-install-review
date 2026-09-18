'use client';

import {FormEvent, useEffect, useState} from 'react';
import Link from 'next/link';

type Role = 'ADMIN' | 'MANAGER' | 'STAFF' | 'READ_ONLY';
type User = {id: string; name: string; username: string; email?: string | null; role: Role; user_type: 'HUMAN' | 'AGENT'; active: boolean; last_login_at?: string | null};
const roles: Role[] = ['ADMIN', 'MANAGER', 'STAFF', 'READ_ONLY'];

export default function UsersClient() {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({name: '', username: '', email: '', role: 'STAFF' as Role, password: ''});

  async function load() {
    const response = await fetch('/api/users', {cache: 'no-store'});
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(response.status === 403 ? 'Only administrators can manage users.' : 'User management is unavailable.');
      setLoading(false);
      return;
    }
    setUsers(payload.items || []);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    const response = await fetch('/api/users', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(form)});
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { setError(payload?.error?.message || 'Could not create user.'); return; }
    setForm({name: '', username: '', email: '', role: 'STAFF', password: ''});
    setMessage('User created.');
    await load();
  }

  async function update(user: User, password: string) {
    setError('');
    setMessage('');
    const response = await fetch('/api/users/' + encodeURIComponent(user.id), {method: 'PATCH', headers: {'content-type': 'application/json'}, body: JSON.stringify({role: user.role, active: user.active, password: password || undefined})});
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { setError(payload?.error?.message || 'Could not update user.'); return; }
    setMessage('User updated.');
    await load();
  }

  return (
    <main className="min-h-screen bg-[#0d111b] px-4 py-8 text-white sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-6">
          <div><p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-300">Settings</p><h1 className="mt-2 text-3xl font-bold">Users</h1><p className="mt-2 text-sm text-slate-400">Manage authenticated human access to Chameleon Operations.</p></div>
          <Link className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10" href="/">Back to Operations</Link>
        </div>
        {error ? <p className="mt-5 rounded-xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 text-sm text-rose-100">{error}</p> : null}
        {message ? <p className="mt-5 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.06] px-4 py-3 text-sm text-emerald-100">{message}</p> : null}
        <section className="mt-8 rounded-2xl border border-white/10 bg-white/[0.035] p-5">
          <h2 className="text-lg font-bold">Create user</h2>
          <form className="mt-4 grid gap-3 md:grid-cols-6" onSubmit={create}>
            <input className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm" placeholder="Name" value={form.name} onChange={event => setForm({...form, name: event.target.value})} required />
            <input className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm" placeholder="Username" autoComplete="off" value={form.username} onChange={event => setForm({...form, username: event.target.value})} required />
            <input className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm" placeholder="Email (optional)" type="email" autoComplete="off" value={form.email} onChange={event => setForm({...form, email: event.target.value})} />
            <select className="rounded-xl border border-white/10 bg-[#151a27] px-3 py-3 text-sm" value={form.role} onChange={event => setForm({...form, role: event.target.value as Role})}>{roles.map(role => <option key={role}>{role}</option>)}</select>
            <input className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm" placeholder="Temporary password" type="password" autoComplete="new-password" value={form.password} onChange={event => setForm({...form, password: event.target.value})} required />
            <button className="rounded-xl bg-blue-500 px-4 py-3 text-sm font-bold hover:bg-blue-400">Create</button>
          </form>
        </section>
        <section className="mt-8 overflow-hidden rounded-2xl border border-white/10">
          <div className="border-b border-white/10 bg-white/[0.035] px-5 py-4"><h2 className="text-lg font-bold">Users</h2></div>
          {loading ? <p className="p-5 text-sm text-slate-400">Loading users…</p> : users.length === 0 ? <p className="p-5 text-sm text-slate-400">No users found.</p> : <div className="divide-y divide-white/10">{users.map(user => <UserRow key={user.id} user={user} onSave={update} />)}</div>}
        </section>
      </div>
    </main>
  );
}

function UserRow({user, onSave}: {user: User; onSave: (user: User, password: string) => Promise<void>}) {
  const [draft, setDraft] = useState(user);
  const [password, setPassword] = useState('');
  useEffect(() => setDraft(user), [user]);
  return <div className="grid gap-4 px-5 py-4 lg:grid-cols-[1.4fr_1.2fr_1fr_0.8fr_auto] lg:items-center">
    <div><p className="font-semibold">{draft.name}</p><p className="text-xs text-slate-500">{draft.username}{draft.email ? ' · ' + draft.email : ''}</p></div>
    <div className="text-xs text-slate-400">{draft.user_type} · last login {draft.last_login_at ? new Date(draft.last_login_at).toLocaleString() : 'never'}</div>
    <select className="rounded-xl border border-white/10 bg-[#151a27] px-3 py-2 text-sm" value={draft.role} onChange={event => setDraft({...draft, role: event.target.value as Role})}>{roles.map(role => <option key={role}>{role}</option>)}</select>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.active} onChange={event => setDraft({...draft, active: event.target.checked})} /> Active</label>
    <div className="flex gap-2"><input className="w-40 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs" placeholder="New password" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /><button className="rounded-xl border border-white/10 px-3 py-2 text-xs font-bold hover:bg-white/10" onClick={() => { void onSave(draft, password); setPassword(''); }}>Save</button></div>
  </div>;
}
