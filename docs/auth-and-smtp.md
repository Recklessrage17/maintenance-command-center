# MCC Authentication and SMTP

MCC stores local authentication data in `backend/data/mcc.sqlite`. This database is for MCC only and must not be replaced with, copied from, or connected to MIT3 data.

## Environment variables

Copy `.env.example` to a local `.env` in the MCC repo root:

```text
F:\maintenance-command-center\.env
```

Do not put the MCC `.env` under `backend`, do not commit `.env`, and do not use MIT3's environment or data files. MCC loads the repo-root `.env` automatically before it checks authentication or SMTP settings. Environment variables already set by the system are preserved.

- `SESSION_SECRET`: required for production. Development uses a temporary secret if this is missing and reports `SESSION_SECRET configured: no` at startup.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`: optional SMTP values used for future forgot-password email delivery.

If SMTP is not configured, password reset requests return a generic browser message and the backend logs a safe notice. Temporary credentials are never returned to the browser, and `SMTP_PASS` must never be logged, returned by an API, or exposed in the frontend.

## Commands

```bash
npm run install:all
npm run build
npm start
```

MCC remains on port `4273`.
