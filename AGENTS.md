# Test workspace hygiene

Every test workflow must remove the temporary files and directories it owns,
whether it passes or fails. Stop and await owned processes before cleanup.

- Run Playwright with `npm run test:playwright -- <arguments>` or the existing
  `test:*` npm scripts. The managed runner is required; do not bypass its guard.
- Keep databases, uploads, generated backups, caches and runtime files within
  that run's uniquely owned `tmp/playwright-runs/<run-id>` directory. Never point
  tests at development or production storage. Use isolated ports and servers.
- Put screenshots, traces, reports and logs under
  `diagnostics/playwright/<run-id>`. Use `testInfo.outputPath()` / attachments for
  test artifacts. Preserve failure evidence until a human has reviewed it;
  runtime cleanup must not delete diagnostics or recovery snapshots.
- For interrupted runs, use the explicit, dry-run-first procedure in
  `docs/playwright-cleanup.md`. Never infer ownership from a directory name or
  age alone. Refuse cleanup if any associated process is active or safety
  checks cannot be completed. Do not automatically sweep stale runs.
- Never use unrestricted `git clean -fdx`, recursively delete `tmp`, or clean
  live MCC data/backups, recovery snapshots, source, manually maintained
  fixtures, or unrelated temporary files. Reject links/junctions escaping the
  owned directory. Review tracked generated-file removals as Git diffs.
- Before finishing testing, verify owned runtime directories are gone, report
  any safely retained interrupted runs, and link retained diagnostics.
- Stay on the existing task branch. Do not deploy to the Raspberry Pi, push,
  or merge without explicit approval.
