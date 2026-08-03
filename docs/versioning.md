# MCC versioning

The authoritative application version is the `version` field in the repository's root `package.json`. The frontend and backend package manifests and all three npm lockfiles carry synchronized copies for package-manager consistency; do not edit those copies independently.

## Version commands

Run one command from the repository root:

```powershell
npm run version:patch
npm run version:minor
npm run version:major
npm run version:set -- 1.2.0
```

The checked-in `scripts/version.mjs` script validates strict `x.y.z` semantic versions and updates the root, frontend, and backend manifests and lockfiles as one guarded operation. It reports the old and new versions. It does not create Git tags, commits, or pushes.

Normal `npm run build` and `npm start` commands never change the application version.

## Release policy

- Patch (`v1.2.0` to `v1.2.1`): bug fixes, small UI changes, normal deployed patches, and refinements.
- Minor (`v1.2.x` to `v1.3.0`): backward-compatible feature sets and larger new functionality.
- Major (`v1.x.x` to `v2.0.0`): breaking or incompatible releases only.

For a deployable issue, bump the version once near the end, after implementation and testing and before the final commit or pull request. Do not bump for each internal commit.

## Deployment check

After pulling the approved revision on Windows or Raspberry Pi, install dependencies as required and build normally. An authenticated Admin or Owner Admin can confirm the installed release and short Git commit in the compact System Version panel at the beginning of Settings. Non-admin roles cannot render the panel or access its API metadata.

If the installation does not include readable Git metadata, Settings safely reports `Build unavailable`; application startup is unaffected.
