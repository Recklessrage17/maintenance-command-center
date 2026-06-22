# Maintenance Command Center Smoke Test Checklist

Use this checklist before starting larger MCC feature work.

## Automated smoke check

Run these from the repository root:

```bash
npm run install:all
npm run build
npm run smoke
```

The `npm run smoke` script starts the built backend on port `4273`, verifies `/api/health` returns OK, verifies the built app shell HTML is served, and checks that the main shell is wired to these tabs/pages:

- Inventory
- Preventive Maintenance
- Assets
- Building Prints

## Manual browser spot check

1. Start the app:

   ```bash
   npm start
   ```

2. Open <http://localhost:4273>.
3. Complete first-admin setup or log in with a local test account.
4. Confirm the sidebar shows:
   - Inventory
   - Preventive Maintenance
   - Assets
   - Building Prints
5. Open each tab and confirm a non-blank page renders.
6. Confirm Inventory still opens the existing inventory screen and does not require MIT3 to be running.

## Expected non-blocking warnings in local development

- `npm warn Unknown env config "http-proxy"` can appear from the local npm environment.
- `SESSION_SECRET configured: no` means a temporary session secret is being used for local startup.
- `SMTP configured: no` only affects password-reset email delivery.
