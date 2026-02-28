/**
 * Schema Version — validates behavioral_engine.schema_version from card extensions.
 */

export const CURRENT_SCHEMA_VERSION = '1.0';

interface SemVer {
  major: number;
  minor: number;
}

function parseSemVer(version: string): SemVer {
  const parts = version.split('.');
  return {
    major: parseInt(parts[0], 10) || 0,
    minor: parseInt(parts[1], 10) || 0,
  };
}

/**
 * Validate the schema_version from a card's behavioral_engine extension.
 * - Missing → returns CURRENT_SCHEMA_VERSION (treat as 1.0)
 * - Incompatible major (>1) → throws
 * - Minor diff → returns the version as-is (caller fills defaults)
 */
export function validateSchemaVersion(schemaVersion: string | undefined): string {
  if (!schemaVersion) {
    return CURRENT_SCHEMA_VERSION;
  }

  const current = parseSemVer(CURRENT_SCHEMA_VERSION);
  const incoming = parseSemVer(schemaVersion);

  if (incoming.major > current.major) {
    throw new Error(
      `Incompatible card schema version: ${schemaVersion} (engine supports up to ${CURRENT_SCHEMA_VERSION}). ` +
      `Major version ${incoming.major} is not supported.`,
    );
  }

  return schemaVersion;
}
