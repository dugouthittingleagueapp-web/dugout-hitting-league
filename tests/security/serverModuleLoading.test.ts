import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

describe('Deployed server module loading', () => {
  it('loads emitted API modules in native Node ESM without a bundler or database credentials', () => {
    // Like Vercel's server emitter, preserve module boundaries rather than bundling
    // them away. Native Node then catches missing .js extensions in the closure.
    mkdirSync('work', { recursive: true });
    const outDir = mkdtempSync(path.resolve('work/server-esm-'));
    try {
      const roots = ['api/leagues.ts', 'api/teams.ts', 'api/matches.ts', 'api/schedule-admin.ts', 'api/scoring.ts', 'api/player-identities.ts'];
      const program = ts.createProgram(roots, {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler, esModuleInterop: true,
        strict: true, skipLibCheck: true, outDir, rootDir: process.cwd(),
      });
      const diagnostics = ts.getPreEmitDiagnostics(program);
      expect(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
      expect(program.emit().emitSkipped).toBe(false);
      writeFileSync(path.join(outDir, 'package.json'), '{"type":"module"}');
      const urls = roots.map(root => pathToFileURL(path.join(outDir, root.replace(/\.ts$/, '.js'))).href);
      const script = `for (const url of ${JSON.stringify(urls)}) { const mod = await import(url); if (typeof mod.default !== 'function') throw new Error('Missing API handler'); } console.log('server modules loaded');`;
      // A deliberately minimal environment: never pass Vercel or DB credentials.
      const result = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        encoding: 'utf8', timeout: 10000, env: { PATH: process.env.PATH },
      });
      expect(result.trim()).toBe('server modules loaded');
    } finally { rmSync(outDir, { recursive: true, force: true }); }
  }, 20000);
});
