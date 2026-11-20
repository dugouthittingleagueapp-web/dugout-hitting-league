import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ScoreInput } from '../../components/ScoreInput';

const renderTile = (readOnly: boolean, value: number | null, isEditing = false) =>
  renderToStaticMarkup(<ScoreInput pitchNumber={3} value={value} readOnly={readOnly}
    isEditing={isEditing} onOpen={() => {}} onClose={() => {}} onChange={() => {}} />);

describe('read-only score tiles', () => {
  it.each([null, 0, 1, 2, 3, 4])('displays %s accessibly without a disabled form control', value => {
    const html = renderTile(true, value);
    expect(html).toContain(`aria-label="Pitch 3, Score: ${value ?? 'None'}"`);
    expect(html).toContain('role="img"');
    expect(html).not.toContain('<button');
  });

  it('retains a score-entry button for umpires', () => {
    const html = renderTile(false, 0);
    expect(html).toContain('<button');
    expect(html).toContain('aria-label="Pitch 3, Score: 0"');
    expect(html).not.toContain('disabled');
  });

  it('cannot open an editor after becoming read-only', () => {
    // Also verifies this path never attempts to create a portal into document.body.
    expect(renderTile(true, 4, true)).not.toContain('role="dialog"');
  });
});
