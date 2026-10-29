import { type FormEvent, useEffect, useState } from 'react';
import jbtLogo from '../../assets/jbt-usa-login.webp';

const LOGIN_SUCCESS_WARP_MS = 280;

type LoginPhase = 'idle' | 'authenticating' | 'success';

type MccLoginProps<TUser> = {
  authenticate: (email: string, password: string) => Promise<TUser>;
  onForgot: () => void;
  onLogin: (user: TUser) => void;
};

export function MccAccessIcon({ type }: { type: 'email' | 'password' }) {
  if (type === 'email') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4.5 6.75h15v10.5h-15z" />
        <path d="m5.25 7.5 6.75 5 6.75-5" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5.5" y="10.25" width="13" height="9" rx="1.5" />
      <path d="M8.5 10.25V7.5a3.5 3.5 0 0 1 7 0v2.75M12 14v2" />
    </svg>
  );
}

export function MccLogin<TUser>({ authenticate, onForgot, onLogin }: MccLoginProps<TUser>) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [phase, setPhase] = useState<LoginPhase>('idle');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const isSubmitting = phase !== 'idle';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (isSubmitting) return;

    const startedAt = Date.now();
    setMessage('');
    setPhase('authenticating');

    try {
      const user = await authenticate(email, password);
      setPhase('success');
      window.setTimeout(() => onLogin(user), LOGIN_SUCCESS_WARP_MS);
    } catch (error) {
      const remainingWarpMs = Math.max(0, LOGIN_SUCCESS_WARP_MS - (Date.now() - startedAt));
      if (remainingWarpMs) {
        await new Promise(resolve => window.setTimeout(resolve, remainingWarpMs));
      }
      setPhase('idle');
      setMessage((error as Error).message);
    }
  }

  const buttonLabel =
    phase === 'success'
      ? 'ACCESS GRANTED'
      : phase === 'authenticating'
        ? 'AUTHENTICATING'
        : 'SIGN IN TO MCC';

  return (
    <main className="mcc-login mcc-login--concept" aria-labelledby="mcc-login-title">
      <MccLoginClock />
      <section className="mcc-login__concept-card">
          <header className="mcc-login__concept-heading">
            <div className="mcc-login__logo-plate"><img src={jbtLogo} alt="JBT USA" width="564" height="188" /></div>
            <p className="mcc-login__subtitle">Maintenance Command Center</p>
            <span className="mcc-login__accent-line" aria-hidden="true" />
            <h1 id="mcc-login-title" className="mcc-login__visually-hidden">Enter command center</h1>
            <p className="mcc-login__welcome">Secure access to asset readiness, work control,<br className="mcc-login__desktop-break" /> inventory, and facility operations.</p>
          </header>

          <form className="mcc-login__form" onSubmit={submit} aria-busy={isSubmitting}>
            <label className="mcc-login__field" htmlFor="mcc-login-email">
              <span className="mcc-login__visually-hidden">Email address</span>
              <span className="mcc-login__input-wrap">
                <span className="mcc-login__field-icon">
                  <MccAccessIcon type="email" />
                </span>
                <input
                  id="mcc-login-email"
                  type="email"
                  value={email}
                  autoComplete="email"
                  name="email"
                  placeholder="Email address"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={message ? true : undefined}
                  aria-describedby={message ? 'mcc-login-error' : undefined}
                  onChange={event => setEmail(event.target.value)}
                  disabled={isSubmitting}
                />
              </span>
            </label>

            <div className="mcc-login__field">
              <label className="mcc-login__visually-hidden" htmlFor="mcc-login-password">Password</label>
              <span className="mcc-login__input-wrap">
                <span className="mcc-login__field-icon">
                  <MccAccessIcon type="password" />
                </span>
                <input
                  id="mcc-login-password"
                  type={passwordVisible ? 'text' : 'password'}
                  value={password}
                  autoComplete="current-password"
                  name="password"
                  placeholder="Password"
                  aria-invalid={message ? true : undefined}
                  aria-describedby={message ? 'mcc-login-error' : undefined}
                  onChange={event => setPassword(event.target.value)}
                  disabled={isSubmitting}
                />
                <button type="button" className="mcc-login__password-toggle"
                  aria-label={passwordVisible ? 'Hide password' : 'Show password'}
                  aria-controls="mcc-login-password" aria-pressed={passwordVisible}
                  disabled={isSubmitting} onClick={() => setPasswordVisible(visible => !visible)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                    <circle cx="12" cy="12" r="3" />
                    {!passwordVisible && <path d="m3 3 18 18" />}
                  </svg>
                </button>
              </span>
            </div>

            <div className="mcc-login__utility">
              <span>Operator sign-in</span>
              <button type="button" className="mcc-login__forgot" onClick={onForgot} disabled={isSubmitting}>
                Forgot Password?
              </button>
            </div>

            <button
              className={`mcc-login__submit mcc-login__submit--${phase}`}
              type="submit"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
            >
              <span className="mcc-login__submit-label">{buttonLabel}</span>
              <span className="mcc-login__submit-arrow" aria-hidden="true">→</span>
            </button>

            {message && <p id="mcc-login-error" className="mcc-login__error" role="alert">{message}</p>}

            <p className="mcc-login__assistive-status" role="status" aria-live="polite">
              {phase === 'authenticating'
                ? 'Authenticating credentials.'
                : phase === 'success'
                  ? 'Access granted. Opening Maintenance Command Center.'
                  : ''}
            </p>
          </form>

          <footer className="mcc-login__footer">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Z" /><path d="m8 12 3 3 5-6" /></svg>
            MCC operator access
          </footer>
      </section>
      <aside className="mcc-login__product-bar" aria-label="Product information">
        <span className="mcc-login__product-mark" aria-hidden="true" />
        <strong>Maintenance Command Center</strong><span>Operator portal</span>
      </aside>
    </main>
  );
}

function MccLoginClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return <time className="mcc-login__clock" dateTime={now.toISOString()}>
    <span>{now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}</span>
    <strong>{now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</strong>
  </time>;
}
