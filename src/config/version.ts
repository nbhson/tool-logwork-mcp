import { createRequire } from 'node:module';

/**
 * Reads the server version from package.json at runtime (single source of truth).
 *
 * Uses createRequire instead of `import ... with { type: 'json' }` and walks up
 * at most two directory levels, so it resolves whether this file runs from
 * src/ (vitest) or dist/ (compiled output). Falls back to a constant if the
 * file cannot be found (e.g. unusual install layouts), so the server never
 * fails to start over a cosmetic value.
 */
export const SERVER_VERSION = readPackageVersion();

function readPackageVersion(): string {
  const require = createRequire(import.meta.url);
  for (const candidate of ['../../package.json', '../package.json']) {
    try {
      const pkg = require(candidate) as { version?: unknown };
      if (typeof pkg.version === 'string' && pkg.version.length > 0) return pkg.version;
    } catch {
      // try the next candidate
    }
  }
  return '0.0.0';
}
