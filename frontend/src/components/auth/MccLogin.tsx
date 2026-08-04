import { type FormEvent, useState } from 'react';

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
        : 'ENTER COMMAND CENTER';

  return (
    <main className="mcc-login" aria-labelledby="mcc-login-title">
      <div className="mcc-login__atmosphere" aria-hidden="true">
        <span className="mcc-login__orb mcc-login__orb--cyan" />
        <span className="mcc-login__orb mcc-login__orb--teal" />
        <span className="mcc-login__scanline" />
      </div>

      <section className="mcc-login__frame">
        <aside className="mcc-login__identity" aria-label="Maintenance Command Center">
          <div className="mcc-login__brand">
            <span className="mcc-login__brand-rail" aria-hidden="true" />
            <div>
              <p className="mcc-login__brand-mark">
                <strong>MCC</strong>
                <span>Maintenance Command Center</span>
              </p>
              <p className="mcc-login__brand-caption">Industrial operations interface</p>
            </div>
          </div>

          <div className="mcc-login__identity-copy">
            <p className="mcc-login__kicker">Command access / node 01</p>
            <h2>Maintenance intelligence, under control.</h2>
            <p>
              Secure access to asset readiness, work control, inventory, and facility operations.
            </p>
          </div>

          <div className="mcc-login__system-readout">
            <div className="mcc-login__online">
              <span aria-hidden="true" />
              <strong>System Online</strong>
            </div>
            <dl>
              <div>
                <dt>Link</dt>
                <dd>Local secure</dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>Operator</dd>
              </div>
            </dl>
          </div>
        </aside>

        <div className="mcc-login__access">
          <div className="mcc-login__panel-index" aria-hidden="true">
            <span>AUTH-01</span>
            <span>SECURE GATEWAY</span>
          </div>

          <header className="mcc-login__heading">
            <p>Secure operator access</p>
            <h1 id="mcc-login-title">Enter command center</h1>
            <span>Authenticate with your MCC operator credentials.</span>
          </header>

          <form className="mcc-login__form" onSubmit={submit} aria-busy={isSubmitting}>
            <label className="mcc-login__field" htmlFor="mcc-login-email">
              <span>Email address</span>
              <span className="mcc-login__input-wrap">
                <span className="mcc-login__field-icon">
                  <MccAccessIcon type="email" />
                </span>
                <input
                  id="mcc-login-email"
                  type="email"
                  value={email}
                  autoComplete="email"
                  onChange={event => setEmail(event.target.value)}
                  disabled={isSubmitting}
                />
              </span>
            </label>

            <label className="mcc-login__field" htmlFor="mcc-login-password">
              <span>Password</span>
              <span className="mcc-login__input-wrap">
                <span className="mcc-login__field-icon">
                  <MccAccessIcon type="password" />
                </span>
                <input
                  id="mcc-login-password"
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  onChange={event => setPassword(event.target.value)}
                  disabled={isSubmitting}
                />
              </span>
            </label>

            <button
              className={`mcc-login__submit mcc-login__submit--${phase}`}
              type="submit"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
            >
              <span className="mcc-login__submit-label">{buttonLabel}</span>
              <span className="mcc-login__submit-arrow" aria-hidden="true">→</span>
            </button>

            <button
              type="button"
              className="mcc-login__forgot"
              onClick={onForgot}
              disabled={isSubmitting}
            >
              Forgot Password
            </button>

            {message && <p className="mcc-login__error" role="alert">{message}</p>}

            <p className="mcc-login__assistive-status" role="status" aria-live="polite">
              {phase === 'authenticating'
                ? 'Authenticating credentials.'
                : phase === 'success'
                  ? 'Access granted. Opening Maintenance Command Center.'
                  : ''}
            </p>
          </form>

          <footer className="mcc-login__footer">
            <span aria-hidden="true">◇</span>
            Encrypted local session
          </footer>
        </div>
      </section>
    </main>
  );
}
