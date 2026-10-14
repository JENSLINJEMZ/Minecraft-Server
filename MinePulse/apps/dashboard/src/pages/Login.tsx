import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Cpu, Lock, Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../lib/api';
import { Spinner } from '../components/ui/primitives';

export function LoginPage(): JSX.Element {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/';

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Unable to sign in. Check the API is running.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/15 text-accent-hover shadow-glow">
            <Cpu className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-content">MinePulse</h1>
            <p className="mt-1 text-xs text-content-muted">Sign in to monitor your server</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="card space-y-4 p-5">
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-faint" />
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input pl-9"
                placeholder="you@example.com"
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-faint" />
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input pl-9"
                placeholder="••••••••••••"
              />
            </div>
          </div>

          {error ? (
            <div className="rounded-lg border border-status-offline/30 bg-status-offline/10 px-3 py-2 text-xs text-status-offline">
              {error}
            </div>
          ) : null}

          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting ? <Spinner /> : null}
            Sign in
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] text-content-faint">
          Private instance. No public registration.
        </p>
      </div>
    </div>
  );
}
