import { describe, expect, it } from 'vitest';
import { mergeAvailableSeasons } from '../../utils/availableSeasons';

describe('Season picker archive merge', () => {
  it('preserves 2025/2026 archives and current season on fresh installs', () => {
    expect(mergeAvailableSeasons([], '2026')).toEqual(['2026', '2025']);
  });
  it('deduplicates and numerically sorts newer years ahead of 2025 archive', () => {
    expect(mergeAvailableSeasons(['2025', '2027', '2026', '2027', '2024'], '2028'))
      .toEqual(['2028', '2027', '2026', '2025', '2024']);
  });
  it('does not alter the server or cache input list', () => {
    const seasons = ['2026', '2025', '2026'];
    const before = [...seasons];
    expect(mergeAvailableSeasons(seasons, '2027')).toEqual(['2027', '2026', '2025']);
    expect(seasons).toEqual(before);
  });
});
