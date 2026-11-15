import { describe, expect, it } from 'vitest';
import { selectDatabaseConnectionString } from '../../server/databaseConnection';

const productionUrl = 'postgresql://user:test@ep-purple-sea-a42guhf9.us-east-1.aws.neon.tech/neondb';
const previewUrl = 'postgresql://user:test@ep-red-tree-a46hwgra-pooler.us-east-1.aws.neon.tech/neondb';
const consolidatedUrl = 'postgresql://user:test@ep-divine-smoke-a4lyo8af-pooler.us-east-1.aws.neon.tech/neondb';
const sharedIntegrationUrl = 'postgresql://user:test@ep-purple-sea-a42guhf9.us-east-1.aws.neon.tech/neondb';

describe('Environment-isolated Neon database routing', () => {
  it('pins Schedule Preview to its isolated endpoint and rejects Production or other previews', () => {
    const environment = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'fix/schedule-import-league-provisioning' };
    for (const host of ['ep-bold-term-a4y8a4nu', 'ep-bold-term-a4y8a4nu-pooler']) {
      const url = `postgresql://user:test@${host}.us-east-1.aws.neon.tech/neondb`;
      expect(selectDatabaseConnectionString({ ...environment, Database_url: url, DATABASE_URL: productionUrl })).toBe(url);
    }
    for (const url of [productionUrl, previewUrl, consolidatedUrl, 'https://example.com']) {
      expect(() => selectDatabaseConnectionString({ ...environment, Database_url: url })).toThrow();
    }
    expect(() => selectDatabaseConnectionString({ ...environment, DATABASE_URL: productionUrl })).toThrow(/must be configured/);
  });

  it('uses the dedicated Preview URL and ignores the shared Production integration URL', () => {
    expect(selectDatabaseConnectionString({
      VERCEL_ENV: 'preview',
      VERCEL_GIT_COMMIT_REF: 'refactor/network-and-sync-foundation',
      Database_url: previewUrl,
      DATABASE_URL: sharedIntegrationUrl,
      POSTGRES_URL: sharedIntegrationUrl,
    })).toBe(previewUrl);
  });

  it('accepts only the isolated consolidated review database for its Preview branch', () => {
    expect(selectDatabaseConnectionString({
      VERCEL_ENV: 'preview',
      VERCEL_GIT_COMMIT_REF: 'review/consolidated-final-nov12',
      Database_url: consolidatedUrl,
      DATABASE_URL: productionUrl,
    })).toBe(consolidatedUrl);
    expect(() => selectDatabaseConnectionString({
      VERCEL_ENV: 'preview',
      VERCEL_GIT_COMMIT_REF: 'review/consolidated-final-nov12',
      Database_url: productionUrl,
    })).toThrow(/unexpected Neon endpoint/);
  });

  it('rejects shared Vercel database URLs when the scoped URL is missing', () => {
    expect(() => selectDatabaseConnectionString({
      VERCEL_ENV: 'preview',
      VERCEL_GIT_COMMIT_REF: 'refactor/network-and-sync-foundation',
      DATABASE_URL: sharedIntegrationUrl,
    })).toThrow(/Database_url must be configured/);
    expect(() => selectDatabaseConnectionString({
      VERCEL_ENV: 'production',
      POSTGRES_URL: sharedIntegrationUrl,
    })).toThrow(/Database_url must be configured/);
  });

  it('blocks Preview when its scoped URL points to Production', () => {
    expect(() => selectDatabaseConnectionString({
      VERCEL_ENV: 'preview',
      VERCEL_GIT_COMMIT_REF: 'refactor/network-and-sync-foundation',
      Database_url: productionUrl,
    })).toThrow(/unexpected Neon endpoint/);
  });

  it('blocks Production when its scoped URL points to the Preview database', () => {
    expect(() => selectDatabaseConnectionString({
      VERCEL_ENV: 'production',
      Database_url: previewUrl,
    })).toThrow(/unexpected Neon endpoint/);
  });

  it('rejects connecting Production to any non-Production preview endpoint', () => {
    for (const candidateUrl of [previewUrl, consolidatedUrl]) {
      expect(() => selectDatabaseConnectionString({
        VERCEL_ENV: 'production',
        Database_url: candidateUrl,
      })).toThrow(/unexpected Neon endpoint/);
    }
  });

  it('allows Production connection to its own Neon endpoint', () => {
    expect(selectDatabaseConnectionString({
      VERCEL_ENV: 'production',
      Database_url: productionUrl,
      DATABASE_URL: previewUrl,
    })).toBe(productionUrl);
  });

  it('allows an explicitly configured local development database URL', () => {
    expect(selectDatabaseConnectionString({
      DATABASE_URL: 'postgres://local:local@localhost:5432/dugout',
    })).toBe('postgres://local:local@localhost:5432/dugout');
  });

  it('rejects invalid protocols for deployed release targets', () => {
    expect(() => selectDatabaseConnectionString({
      VERCEL_ENV: 'production',
      Database_url: 'https://example.com',
    })).toThrow(/Invalid Production database connection URL/);
  });

  it('accepts surrounding quotes and whitespace without exposing the URL', () => {
    expect(selectDatabaseConnectionString({
      VERCEL_ENV: 'preview',
      VERCEL_GIT_COMMIT_REF: 'refactor/network-and-sync-foundation',
      Database_url: `  "${previewUrl}"  `,
    })).toBe(previewUrl);
  });
});
