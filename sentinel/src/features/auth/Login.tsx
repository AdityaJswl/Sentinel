import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowUpRight } from 'lucide-react';
import type { SessionUser } from '../../lib/types';
import { sessionUser, supabase } from '../../lib/supabase';
import { ErrorNotice } from '../../components/Primitives';

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(8, 'Use at least 8 characters.'),
});

export function Login({ onLogin }: { onLogin: (user: SessionUser) => void }) {
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });

  async function submit(values: z.infer<typeof loginSchema>) {
    setError('');
    setNotice('');
    try {
      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          ...values,
          options: { emailRedirectTo: window.location.origin },
        });
        if (signUpError) throw signUpError;
        if (data.session && data.user) onLogin(sessionUser(data.user));
        else setNotice('Check your email to confirm your account, then sign in.');
        return;
      }
      const { data, error: signInError } = await supabase.auth.signInWithPassword(values);
      if (signInError) throw signInError;
      onLogin(sessionUser(data.user));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed. Please try again.');
    }
  }

  return (
    <main className="login-page">
      <section className="login-story">
        <a className="wordmark" href="#">
          Sentinel<span> / </span>
        </a>
        <div>
          <p className="eyebrow">The authorization layer</p>
          <h1>
            Every decision.
            <br />
            Accounted for.
          </h1>
          <p className="login-intro">
            A clear line of sight from an agent’s request to the authority behind it.
          </p>
        </div>
        <p className="login-footer">Part of the RazorCart product suite</p>
      </section>
      <section className="login-form-panel">
        <form onSubmit={handleSubmit(submit)} className="login-form" noValidate>
          <p className="eyebrow">Operations console</p>
          <h2>{mode === 'login' ? 'Welcome back.' : 'Create your account.'}</h2>
          <p className="muted">
            {mode === 'login'
              ? 'Sign in to review authorizations and agent delegations.'
              : 'Register with your work email to request console access.'}
          </p>
          <label className="field">
            Email
            <input
              type="email"
              autoComplete="email"
              {...register('email')}
              aria-invalid={Boolean(errors.email)}
            />
            {errors.email && <span className="field-error">{errors.email.message}</span>}
          </label>
          <label className="field">
            Password
            <input
              type="password"
              autoComplete="current-password"
              {...register('password')}
              aria-invalid={Boolean(errors.password)}
            />
            {errors.password && <span className="field-error">{errors.password.message}</span>}
          </label>
          {error && <ErrorNotice message={error} />}
          {notice && <p className="login-hint">{notice}</p>}
          <button className="button button--primary" type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? mode === 'login'
                ? 'Signing in…'
                : 'Creating account…'
              : mode === 'login'
                ? 'Enter console'
                : 'Create account'}
            <ArrowUpRight size={17} />
          </button>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login');
              setError('');
              setNotice('');
            }}
          >
            {mode === 'login' ? 'Create an account' : 'Back to sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
