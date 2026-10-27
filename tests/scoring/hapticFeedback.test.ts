import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { triggerHaptic, resetHapticThrottle } from '../../utils/feedback';

describe('Vibration Feedback for Score Inputs', () => {
  let vibrateMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    resetHapticThrottle();
    vibrateMock = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'vibrate', {
      value: vibrateMock,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('triggers identical vibration pattern (60ms) for score input buttons 0-4', () => {
    // Test triggering for score buttons 0 through 4
    for (let score = 0; score <= 4; score++) {
      vibrateMock.mockClear();
      vi.advanceTimersByTime(100);
      triggerHaptic('score');
      expect(vibrateMock).toHaveBeenCalledWith(60);
    }
  });

  it('throttles rapid duplicate events such as pointerdown immediately followed by click', () => {
    vi.advanceTimersByTime(100);
    vibrateMock.mockClear();
    triggerHaptic('score');
    expect(vibrateMock).toHaveBeenCalledTimes(1);

    // Immediate second trigger (<80ms) should be throttled
    vi.advanceTimersByTime(20);
    triggerHaptic('score');
    expect(vibrateMock).toHaveBeenCalledTimes(1);

    // After 100ms, new score input vibration should fire
    vi.advanceTimersByTime(100);
    triggerHaptic('score');
    expect(vibrateMock).toHaveBeenCalledTimes(2);
  });

  it('safely handles environments without navigator.vibrate support without throwing', () => {
    Object.defineProperty(navigator, 'vibrate', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    expect(() => triggerHaptic('score')).not.toThrow();
  });
});
