import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { selectDatabaseConnectionString } from '../../server/databaseConnection';

describe('No deployed maintenance bypass', () => {
  it.each(['release/scoring-safety-nov16', 'fix/game-day-reliability'])('pins %s to the isolated scoring testing database endpoint', branch => {
    const config = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: branch };
    const url = 'postgres://synthetic:synthetic@ep-holy-scene-a40t91vm-pooler.us-east-1.aws.neon.tech/neondb';
    expect(selectDatabaseConnectionString({ ...config, Database_url: url })).toBe(url);
    expect(() => selectDatabaseConnectionString({ ...config, Database_url: url.replace('holy-scene-a40t91vm', 'bold-term-a4y8a4nu') })).toThrow(/unexpected Neon endpoint/);
  });
  it('removes both obsolete repair HTTP routes', () => {
    expect(existsSync('api/fix-crushers.ts')).toBe(false);
    expect(readFileSync('vite.config.ts', 'utf8')).not.toContain("pathname === '/api/fix-crushers'");
    expect(readFileSync('vite.config.ts', 'utf8')).not.toContain("pathname === '/api/admin/fix-crushers'");
  });
  it('has no HTTP handler importing a maintenance script or constructing another database pool', () => {
    for (const file of readdirSync('api').filter(f => f.endsWith('.ts') && f !== 'db.ts')) {
      const source = readFileSync(`api/${file}`, 'utf8');
      expect(source, file).not.toMatch(/from\s+['"].*scripts\//);
      expect(source, file).not.toMatch(/new\s+(?:pg\.)?(?:Pool|Client)\s*\(/);
    }
  });
  it('rejects a Production URL for every Preview branch, including future repair branches', () => {
    for (const ref of ['fix/critical-scoring-safety', 'some-future-branch']) {
      expect(() => selectDatabaseConnectionString({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: ref,
        Database_url: 'postgres://synthetic:synthetic@ep-purple-sea-a42guhf9-pooler.us-east-1.aws.neon.tech/neondb' })).toThrow(/Preview cannot connect to Production/);
    }
  });
  it.each(['host', 'hostaddr', 'service', 'options'])('rejects a driver routing override through %s', key => {
    expect(() => selectDatabaseConnectionString({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'fix/critical-scoring-safety',
      Database_url: `postgres://synthetic:synthetic@preview.invalid/neondb?${key}=production.invalid` })).toThrow(/cannot override/);
  });
});
