import { useState, type FormEvent } from 'react';
import { usernameSchema, passwordSchema } from '@parley/shared';
import { useAuth } from '../state/auth';

type Mode = 'login' | 'register';

interface FieldErrors {
  username?: string;
  password?: string;
  displayName?: string;
}

function validateField(name: keyof FieldErrors, value: string): string | undefined {
  if (name === 'username') {
    const result = usernameSchema.safeParse(value);
    return result.success ? undefined : result.error.issues[0]?.message;
  }
  if (name === 'password') {
    const result = passwordSchema.safeParse(value);
    return result.success ? undefined : result.error.issues[0]?.message;
  }
  if (value.trim().length === 0) return 'Display name is required';
  if (value.trim().length > 48) return 'Display name must be at most 48 characters';
  return undefined;
}

export function AuthScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function switchMode(next: Mode): void {
    setMode(next);
    setFieldErrors({});
    setServerError(null);
  }

  function handleBlur(name: keyof FieldErrors, value: string): void {
    setFieldErrors((prev) => ({ ...prev, [name]: validateField(name, value) }));
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const errors: FieldErrors = {
      username: validateField('username', username),
      password: validateField('password', password),
      ...(mode === 'register' ? { displayName: validateField('displayName', displayName) } : {}),
    };
    setFieldErrors(errors);
    if (Object.values(errors).some(Boolean)) return;

    setSubmitting(true);
    setServerError(null);
    const error =
      mode === 'login'
        ? await login(username, password)
        : await register(username, password, displayName.trim());
    setSubmitting(false);
    if (error) setServerError(error);
  }

  const inputClass =
    'w-full rounded-md border border-hairline bg-ground px-3 py-2 text-[14px] ' +
    'text-text-primary placeholder:text-text-secondary ' +
    'focus:border-accent-ink focus:outline-none';

  return (
    <main className="flex min-h-screen items-center justify-center bg-ground px-4">
      <div className="w-full max-w-sm">
        <header className="mb-8 text-center">
          <h1 className="font-display text-[32px] font-medium tracking-tight text-text-primary">
            Parley
          </h1>
          <p className="mt-1 text-[13px] text-text-secondary">
            Chat apps store messages. Parley remembers them.
          </p>
        </header>

        <div className="rounded-md border border-hairline bg-panel p-6">
          <div
            role="tablist"
            aria-label="Sign in or create account"
            className="mb-6 flex gap-4 border-b border-hairline"
          >
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => switchMode(m)}
                className={`-mb-px border-b-2 pb-2 text-[13px] transition-colors duration-120 ${
                  mode === m
                    ? 'border-accent-ink font-semibold text-text-primary'
                    : 'border-transparent text-text-secondary hover:text-text-primary'
                }`}
              >
                {m === 'login' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <form onSubmit={(e) => void handleSubmit(e)} noValidate>
            <div className="space-y-4">
              <div>
                <label htmlFor="username" className="mb-1 block text-[13px] text-text-secondary">
                  Username
                </label>
                <input
                  id="username"
                  className={inputClass}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onBlur={() => handleBlur('username', username)}
                  autoComplete="username"
                  aria-invalid={Boolean(fieldErrors.username)}
                  aria-describedby={fieldErrors.username ? 'username-error' : undefined}
                />
                {fieldErrors.username && (
                  <p id="username-error" className="mt-1 text-[12px] text-danger">
                    {fieldErrors.username}
                  </p>
                )}
              </div>

              {mode === 'register' && (
                <div>
                  <label
                    htmlFor="displayName"
                    className="mb-1 block text-[13px] text-text-secondary"
                  >
                    Display name
                  </label>
                  <input
                    id="displayName"
                    className={inputClass}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    onBlur={() => handleBlur('displayName', displayName)}
                    autoComplete="name"
                    aria-invalid={Boolean(fieldErrors.displayName)}
                    aria-describedby={fieldErrors.displayName ? 'displayName-error' : undefined}
                  />
                  {fieldErrors.displayName && (
                    <p id="displayName-error" className="mt-1 text-[12px] text-danger">
                      {fieldErrors.displayName}
                    </p>
                  )}
                </div>
              )}

              <div>
                <label htmlFor="password" className="mb-1 block text-[13px] text-text-secondary">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  className={inputClass}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() => handleBlur('password', password)}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                />
                {fieldErrors.password && (
                  <p id="password-error" className="mt-1 text-[12px] text-danger">
                    {fieldErrors.password}
                  </p>
                )}
              </div>
            </div>

            {serverError && (
              <p role="alert" className="mt-4 text-[13px] text-danger">
                {serverError}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-6 flex w-full items-center justify-center rounded-md bg-text-primary px-3 py-2 text-[13px] font-semibold text-ground transition-opacity duration-120 hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ground/40 border-t-ground"
                  />
                  {mode === 'login' ? 'Signing in' : 'Creating account'}
                </span>
              ) : mode === 'login' ? (
                'Sign in'
              ) : (
                'Create account'
              )}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-[12px] text-text-secondary">
          {mode === 'login' ? (
            <>
              New here?{' '}
              <button
                onClick={() => switchMode('register')}
                className="text-accent-ink hover:underline"
              >
                Create an account
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                onClick={() => switchMode('login')}
                className="text-accent-ink hover:underline"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </main>
  );
}
