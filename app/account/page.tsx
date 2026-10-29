'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createBrowserClient } from '@/lib/supabase-browser';

type Order = { id: string; status: string; order_reference: string | null; total_amount: number; created_at: string };
type Ticket = { id: string; subject: string; status: string; created_at: string };
export default function Account() {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [message, setMessage] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const supabase = createBrowserClient();
    setClient(supabase);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null); setOrders([]); setTickets([]); setInitializing(false);
    });
    return () => { subscription.unsubscribe(); supabase.auth.stopAutoRefresh(); };
  }, []);
  useEffect(() => {
    if (!client || !user) return;
    let active = true;
    Promise.all([
      client.from('orders').select('id,status,order_reference,total_amount,created_at').order('created_at', { ascending: false }).limit(50),
      client.from('support_tickets').select('id,subject,status,created_at').order('created_at', { ascending: false }).limit(50),
    ]).then(([orderResult, ticketResult]) => {
      if (!active) return;
      if (orderResult.error || ticketResult.error) { setMessage('Your account could not be loaded. Please try again.'); return; }
      setOrders(orderResult.data ?? []); setTickets(ticketResult.data ?? []);
    }).catch(() => { if (active) setMessage('Connection interrupted. Please try again.'); });
    return () => { active = false; };
  }, [client, user, refresh]);
  async function authenticate(event: FormEvent) {
    event.preventDefault(); if (!client || busy) return;
    setBusy(true); setMessage('');
    try {
      const result = mode === 'login'
        ? await client.auth.signInWithPassword({ email: email.trim(), password })
        : await client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin + '/account' } });
      if (result.error) setMessage(mode === 'login' ? 'Could not sign in. Check your email, password and email confirmation.' : 'Could not create your account. Please try again or contact support.');
      else { setPassword(''); if (mode === 'signup' && !result.data.session) setMessage('Check your email to confirm your account, then return here to sign in.'); }
    } catch { setMessage('Connection interrupted. Please try again.'); }
    finally { setBusy(false); }
  }
  async function submitTicket(event: FormEvent) {
    event.preventDefault(); if (!client || !user || busy) return;
    setBusy(true); setMessage('');
    try {
      const { data, error } = await client.from('support_tickets').insert({ user_id: user.id, subject: subject.trim(), description: description.trim() }).select('id').single();
      if (error) setMessage('Your request could not be saved. Please try again or call support.');
      else { setMessage('Request saved. Reference: ' + data.id); setSubject(''); setDescription(''); setRefresh(n => n + 1); }
    } catch { setMessage('Connection interrupted. Please try again.'); }
    finally { setBusy(false); }
  }
  async function signOut() {
    if (!client || busy) return; setBusy(true);
    try { const { error } = await client.auth.signOut(); if (error) setMessage('Sign out failed. Please try again.'); else setMessage('Signed out.'); }
    catch { setMessage('Connection interrupted. Please try again.'); }
    finally { setBusy(false); }
  }
  return <main className="account-page">
    <header className="site-header"><a className="wordmark" href="/"><span className="mark">ZM</span><span>Zero Margin<br />Food Systems Foundation</span></a><a href="/support">Contact support</a></header>
    <section className="account-intro"><p className="eyebrow">Your account</p><h1>A place for<br /><em>your updates.</em></h1><p>This is our pre-production pilot. Shopping and payments are not open yet.</p></section>
    {message ? <p className="account-notice" role="status" aria-live="polite">{message}</p> : null}
    {initializing ? <p className="account-card" role="status">Loading your account…</p> : user ? <>
      <section className="account-card account-session"><p>Signed in as <strong>{user.email}</strong></p><button type="button" disabled={busy} onClick={signOut}>Sign out</button></section>
      <section className="account-card"><h2>Your orders</h2>{orders.length ? <ul className="account-list">{orders.map(order => <li key={order.id}><strong>{order.order_reference ?? order.id}</strong><span>{order.status.replaceAll('_',' ')} · {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(order.total_amount)}</span></li>)}</ul> : <p>No orders yet. Orders will appear here when the supervised pilot begins.</p>}</section>
      <section className="account-card"><h2>Ask for help</h2><form onSubmit={submitTicket}><label htmlFor="ticket-subject">Subject</label><input id="ticket-subject" value={subject} onChange={e=>setSubject(e.target.value)} required maxLength={160}/><label htmlFor="ticket-description">What can we help with?</label><textarea id="ticket-description" value={description} onChange={e=>setDescription(e.target.value)} required maxLength={10000} rows={5}/><button disabled={busy || !subject.trim() || !description.trim()}>{busy ? 'Saving…' : 'Save support request'}</button></form></section>
      <section className="account-card"><h2>Your support requests</h2>{tickets.length ? <ul className="account-list">{tickets.map(ticket=><li key={ticket.id}><strong>{ticket.subject}</strong><span>{ticket.status.replaceAll('_',' ')} · Reference: {ticket.id}</span></li>)}</ul> : <p>You have no support requests.</p>}</section>
    </> : <section className="account-card"><h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2><form onSubmit={authenticate}><label htmlFor="account-email">Email</label><input id="account-email" type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required maxLength={254}/><label htmlFor="account-password">Password</label><input id="account-password" type="password" autoComplete={mode==='login'?'current-password':'new-password'} minLength={mode==='signup'?10:1} value={password} onChange={e=>setPassword(e.target.value)} required/>{mode==='signup'?<p className="account-hint">Use at least 10 characters. We will ask you to confirm your email.</p>:null}<button disabled={!client || busy}>{busy?'Please wait…':mode==='login'?'Sign in':'Create account'}</button></form><button className="account-switch" type="button" disabled={busy} onClick={()=>{setMode(mode==='login'?'signup':'login');setMessage('');setPassword('');}}>{mode==='login'?'New here? Create an account':'Already registered? Sign in'}</button></section>}
    <footer className="account-footer"><a href="/terms">Terms</a> · <a href="/disclosures">Disclosures</a> · <a href="/">Foundation home</a></footer>
  </main>;
}
