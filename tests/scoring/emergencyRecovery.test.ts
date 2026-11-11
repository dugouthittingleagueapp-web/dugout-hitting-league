import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Emergency app recovery', () => {
  it('never clears all browser storage, which may contain unsynced pitches', () => {
    const source = readFileSync(new URL('../../index.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/localStorage\.clear\s*\(/);
    expect(source).not.toMatch(/sessionStorage\.clear\s*\(/);
    expect(source).not.toContain('Reset Cache & Reload');
    expect(source).toContain("localStorage.removeItem('dugout_app_state')");
    expect(source).toContain('Reload Safely');
  });
});
