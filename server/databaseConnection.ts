/**
 * Select a database URL without allowing a deployed Preview to silently use
 * a Production/Neon-integration URL that is shared across Vercel targets.
 *
 * The Vercel project provides a case-sensitive, environment-scoped
 * `Database_url` for Production and this Preview branch. This is distinct
 * from the shared `DATABASE_URL` and `POSTGRES_URL` integration variables.
 *
 * Validate the Neon endpoint of each known release target so incorrectly
 * assigned credentials fail closed before any score can be saved.
 */

export type DatabaseEnvironment = {
  VERCEL_ENV?: string;
  VERCEL_GIT_COMMIT_REF?: string;
  Database_url?: string;
  DATABASE_URL?: string;
  POSTGRES_URL?: string;
};

const PRODUCTION_HOST = 'ep-purple-sea-a42guhf9.us-east-1.aws.neon.tech';
const SCORING_PREVIEW_HOST = 'ep-red-tree-a46hwgra.us-east-1.aws.neon.tech';
const SCORING_PREVIEW_BRANCH = 'refactor/network-and-sync-foundation';
const CONSOLIDATED_REVIEW_BRANCH = 'review/consolidated-final-nov12';
const CONSOLIDATED_REVIEW_HOST = 'ep-divine-smoke-a4lyo8af.us-east-1.aws.neon.tech';
const FORENSIC_QC_BRANCH = 'review/forensic-qc-nov13';
const FORENSIC_QC_HOST = 'ep-quiet-bird-a4je1a5z.us-east-1.aws.neon.tech';

const normalizeUrl = (value: string): string =>
  value.trim().replace(/^(['"])(.*)\1$/, '$2').trim();

const assertExpectedHost = (connectionString: string, expectedHost: string, name: string): void => {
  let hostname: string;
  try {
    const parsed = new URL(connectionString);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
      throw new Error('Unsupported protocol');
    }
    hostname = parsed.hostname.toLowerCase();
  } catch {
    throw new Error(`Invalid ${name} database connection URL`);
  }

  const hostnameWithoutPooler = hostname.replace(/-pooler(?=\.)/, '');
  if (hostnameWithoutPooler !== expectedHost) {
    throw new Error(`Database safety check failed: ${name} connection points to an unexpected Neon endpoint`);
  }
};

export const selectDatabaseConnectionString = (environment: DatabaseEnvironment): string => {
  const vercelEnvironment = environment.VERCEL_ENV;
  const isVercelDeployment = vercelEnvironment === 'production' ||
    vercelEnvironment === 'preview' || vercelEnvironment === 'development';

  // Vercel Preview and Production must never use the shared DATABASE_URL
  // fallback, even when an integration injects it automatically.
  const scopedUrl = normalizeUrl(environment.Database_url || '');
  if (isVercelDeployment) {
    if (!scopedUrl) {
      throw new Error('Database_url must be configured separately for this Vercel environment');
    }
    if (vercelEnvironment === 'production') {
      assertExpectedHost(scopedUrl, PRODUCTION_HOST, 'Production');
    } else if (vercelEnvironment === 'preview' &&
        (!environment.VERCEL_GIT_COMMIT_REF ||
          environment.VERCEL_GIT_COMMIT_REF === SCORING_PREVIEW_BRANCH)) {
      assertExpectedHost(scopedUrl, SCORING_PREVIEW_HOST, 'Scoring Preview');
    } else if (vercelEnvironment === 'preview' &&
        environment.VERCEL_GIT_COMMIT_REF === CONSOLIDATED_REVIEW_BRANCH) {
      assertExpectedHost(scopedUrl, CONSOLIDATED_REVIEW_HOST, 'Consolidated Review Preview');
    } else if (vercelEnvironment === 'preview' &&
        environment.VERCEL_GIT_COMMIT_REF === FORENSIC_QC_BRANCH) {
      assertExpectedHost(scopedUrl, FORENSIC_QC_HOST, 'Forensic QC Preview');
    } else if (vercelEnvironment === 'preview') {
      // Unknown Preview branches must never inherit the Production endpoint.
      assertExpectedHost(scopedUrl, '__no_unregistered_preview_endpoint__', 'Unregistered Preview');
    }
    return scopedUrl;
  }

  // Local development may use explicitly supplied local configuration.
  const localUrl = scopedUrl || normalizeUrl(environment.DATABASE_URL || '') ||
    normalizeUrl(environment.POSTGRES_URL || '');
  if (!localUrl) {
    throw new Error('A database connection URL is required');
  }
  return localUrl;
};
