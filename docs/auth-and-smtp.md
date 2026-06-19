# MCC Authentication and SMTP

MCC stores local authentication data in `backend/data/mcc.sqlite`. This database is for MCC only and must not be replaced with, copied from, or connected to MIT3 data.

## Environment variables

Copy `.env.example` to a local `.env` or set environment variables in your shell before starting MCC. Do not commit `.env`.

- `SESSION_SECRET`: required for production. Development starts with a warning and a temporary secret if this is missing.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`: optional SMTP values used for future forgot-password email delivery.

If SMTP is not configured, password reset requests return a generic browser message and the backend logs a safe development notice. Temporary credentials are never returned to the browser.

## Commands

```bash
npm run install:all
npm run build
npm start
```

MCC remains on port `4273`.
