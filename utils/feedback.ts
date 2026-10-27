// Tactile haptic feedback utility for touch scoring

let lastHapticTimestamp = 0;

export const resetHapticThrottle = () => {
  lastHapticTimestamp = 0;
};

export const triggerHaptic = (type: 'score' | 'undo' | 'toggle' | 'tap' = 'score') => {
  const now = Date.now();
  // Prevent duplicate vibrations if both pointerdown and click fire rapidly (<80ms)
  if (lastHapticTimestamp > 0 && now >= lastHapticTimestamp && now - lastHapticTimestamp < 80) {
    return;
  }
  lastHapticTimestamp = now;

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      switch (type) {
        case 'score':
          // Uniform tactile vibration feedback for all score input buttons (0-4)
          navigator.vibrate(60);
          break;
        case 'undo':
          navigator.vibrate([40, 60, 40]);
          break;
        case 'toggle':
          navigator.vibrate(35);
          break;
        case 'tap':
          navigator.vibrate(25);
          break;
      }
    }
  } catch (e) {
    // Vibration may be unavailable, unsupported, or disallowed on some devices/browsers
  }
};


