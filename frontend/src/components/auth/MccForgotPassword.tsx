import { type FormEvent, useState } from 'react';
import { MccAccessIcon } from './MccLogin';

type ResetPhase = 'idle' | 'submitting' | 'success' | 'error';

type MccForgotPasswordProps = {
  onBack: () => void;
  requestReset: (email: string) => Promise<string>;
};

export function MccForgotPassword({ onBack, requestReset }: MccForgotPasswordProps) {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [phase, setPhase] = useState<ResetPhase>('idle');
  const isSubmitting = phase === 'submitting';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (isSubmitting) return;

    setMessage('');
    setPhase('submitting');

    try {
      setMessage(await requestReset(email));
      setPhase('success');
    } catch (error) {
      setMessage((error as Error).message);
      setPhase('error');
    }
  }

  return (
    <main className="mcc-login mcc-reset" aria-labelledby="mcc-reset-title">
      <div className="mcc-login__atmosphere" aria-hidden="true">
        <span className="mcc-login__orb mcc-login__orb--cyan" />
        <span className="mcc-login__orb mcc-login__orb--teal" />
        <span className="mcc-login__scanline" />
      </div>

      <section className="mcc-login__frame mcc-reset__panel">
        <div className="mcc-login__panel-index mcc-reset__panel-index" aria-hidden="true">
          <span>RESET-01</span>
          <span>ACCOUNT RECOVERY</span>
        </div>

        <div className="mcc-reset__content">
          <div className="mcc-reset__brand" aria-label="Maintenance Command Center">
            <span className="mcc-reset__brand-rail" aria-hidden="true" />
            <p>
              <strong>MCC</strong>
              <span>Maintenance Command Center</span>
            </p>
          </div>

          <header className="mcc-login__heading mcc-reset__heading">
            <p>Secure reset</p>
            <h1 id="mcc-reset-title">Forgot Password</h1>
            <span>Enter your operator email to request secure account recovery instructions.</span>
          </header>

          <form className="mcc-login__form mcc-reset__form" onSubmit={submit} aria-busy={isSubmitting}>
            <label className="mcc-login__field" htmlFor="mcc-reset-email">
              <span>Email</span>
              <span className="mcc-login__input-wrap">
                <span className="mcc-login__field-icon">
                  <MccAccessIcon type="email" />
                </span>
                <input
                  id="mcc-reset-email"
                  type="email"
                  value={email}
                  autoComplete="email"
                  onChange={event => setEmail(event.target.value)}
                  disabled={isSubmitting}
                  required
                />
              </span>
            </label>

            <div className="mcc-reset__actions">
              <button
                className={`mcc-login__submit mcc-login__submit--${phase === 'submitting' ? 'authenticating' : 'idle'} mcc-reset__submit`}
                type="submit"
                disabled={isSubmitting}
                aria-busy={isSubmitting}
              >
                <span className="mcc-login__submit-label">
                  {isSubmitting ? 'REQUESTING RESET' : 'REQUEST RESET'}
                </span>
                <span className="mcc-login__submit-arrow" aria-hidden="true">→</span>
              </button>

              <button
                type="button"
                className="mcc-reset__back"
                onClick={onBack}
                disabled={isSubmitting}
              >
                <span aria-hidden="true">←</span>
                Back to Login
              </button>
            </div>

            {message && (
              <div
                className={`mcc-reset__notice mcc-reset__notice--${phase}`}
                role={phase === 'error' ? 'alert' : 'status'}
                aria-live="polite"
              >
                <span className="mcc-reset__notice-icon" aria-hidden="true">
                  {phase === 'error' ? '!' : 'i'}
                </span>
                <p>{message}</p>
              </div>
            )}

            <p className="mcc-login__assistive-status" role="status" aria-live="polite">
              {isSubmitting ? 'Requesting password reset instructions.' : ''}
            </p>
          </form>

          <footer className="mcc-login__footer mcc-reset__footer">
            <span aria-hidden="true">◇</span>
            Encrypted local recovery
          </footer>
        </div>
      </section>
    </main>
  );
}
