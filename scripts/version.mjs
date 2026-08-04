import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const semanticVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const metadataFiles = [
  { path: 'package.json', parentRecord: false },
  { path: 'package-lock.json', parentRecord: false },
  { path: 'frontend/package.json', parentRecord: false },
  { path: 'frontend/package-lock.json', parentRecord: true },
  { path: 'backend/package.json', parentRecord: false },
  { path: 'backend/package-lock.json', parentRecord: true },
];

function fail(message) {
  console.error(`Version update failed: ${message}`);
  process.exitCode = 1;
}

function parseVersion(value, label) {
  const match = semanticVersionPattern.exec(value);
  if (!match) throw new Error(`${label} must be a semantic version in x.y.z form.`);
  return match.slice(1).map(component => BigInt(component));
}

function nextVersion(operation, currentVersion, requestedVersion) {
  const [major, minor, patch] = parseVersion(currentVersion, 'Current root package version');
  if (operation === 'patch') return `${major}.${minor}.${patch + 1n}`;
  if (operation === 'minor') return `${major}.${minor + 1n}.0`;
  if (operation === 'major') return `${major + 1n}.0.0`;
  if (operation === 'set') {
    if (!requestedVersion) throw new Error('Provide a version, for example: npm run version:set -- 1.2.0');
    parseVersion(requestedVersion, 'Requested version');
    return requestedVersion;
  }
  throw new Error('Use patch, minor, major, or set.');
}

function updateMetadata(document, relativePath, targetVersion, parentRecord) {
  if (!document || typeof document !== 'object') throw new Error(`${relativePath} is not a JSON object.`);
  if (typeof document.name !== 'string') throw new Error(`${relativePath} is missing its package name.`);
  document.version = targetVersion;
  if (relativePath.endsWith('package-lock.json')) {
    if (!document.packages?.['']) throw new Error(`${relativePath} is missing its root lockfile package record.`);
    document.packages[''].version = targetVersion;
    if (parentRecord) {
      if (!document.packages['..']) throw new Error(`${relativePath} is missing its linked root package record.`);
      document.packages['..'].version = targetVersion;
    }
  }
}

function renderJson(document, original) {
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  return `${JSON.stringify(document, null, 2).replace(/\n/g, newline)}${newline}`;
}

function run() {
  const [operation, requestedVersion, ...extra] = process.argv.slice(2);
  if (!operation || extra.length || (operation !== 'set' && requestedVersion)) {
    throw new Error('Usage: version.mjs patch|minor|major or version.mjs set x.y.z');
  }

  const loaded = metadataFiles.map(file => {
    const absolutePath = path.join(repoRoot, file.path);
    const original = fs.readFileSync(absolutePath, 'utf8');
    return { ...file, absolutePath, original, document: JSON.parse(original) };
  });
  const rootManifest = loaded.find(file => file.path === 'package.json')?.document;
  if (!rootManifest || typeof rootManifest.version !== 'string') throw new Error('Root package.json is missing its version.');

  const oldVersion = rootManifest.version;
  const targetVersion = nextVersion(operation, oldVersion, requestedVersion);
  const updates = loaded.map(file => {
    updateMetadata(file.document, file.path, targetVersion, file.parentRecord);
    return {
      ...file,
      updated: renderJson(file.document, file.original),
      temporaryPath: `${file.absolutePath}.mcc-version-${process.pid}-${Date.now()}.tmp`,
    };
  });

  try {
    for (const file of updates) fs.writeFileSync(file.temporaryPath, file.updated, { encoding: 'utf8', flag: 'wx' });
    for (const file of updates) fs.renameSync(file.temporaryPath, file.absolutePath);
  } catch (error) {
    const rollbackErrors = [];
    for (const file of updates) {
      try {
        fs.writeFileSync(file.absolutePath, file.original, 'utf8');
      } catch (rollbackError) {
        rollbackErrors.push(`${file.path}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
      try {
        if (fs.existsSync(file.temporaryPath)) fs.rmSync(file.temporaryPath, { force: true });
      } catch {
        // A leftover same-directory temp file is harmless and identifies the interrupted operation.
      }
    }
    const detail = error instanceof Error ? error.message : String(error);
    if (rollbackErrors.length) throw new Error(`${detail}; rollback also failed for ${rollbackErrors.join(', ')}`);
    throw new Error(`${detail}; original metadata was restored.`);
  }

  console.log(`MCC version: ${oldVersion} -> ${targetVersion}`);
  console.log(`Synchronized: ${metadataFiles.map(file => file.path).join(', ')}`);
  console.log('No Git tag, commit, or push was created.');
}

try {
  run();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
