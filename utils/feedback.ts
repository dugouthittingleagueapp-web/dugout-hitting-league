// Tactile haptic feedback utility for touch scoring

let lastHapticTimestamp = 0;
let fallbackAudioCtx: any = null;

export const resetHapticThrottle = () => {
  lastHapticTimestamp = 0;
};

// Subtle 15ms tactile acoustic click fallback for browsers that disable or lack the Vibration API (e.g. Firefox, Safari, Desktop)
export const playHapticFallbackClick = () => {
  try {
    if (typeof window === 'undefined') return;
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    if (!fallbackAudioCtx) {
      fallbackAudioCtx = new AudioContextClass();
    }
    if (fallbackAudioCtx.state === 'suspended') {
      fallbackAudioCtx.resume();
    }
    const osc = fallbackAudioCtx.createOscillator();
    const gain = fallbackAudioCtx.createGain();

    // Deep, crisp 15ms click simulating a tactile mechanical button tap
    const startTime = fallbackAudioCtx.currentTime;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, startTime);
    osc.frequency.exponentialRampToValueAtTime(35, startTime + 0.015);

    gain.gain.setValueAtTime(0.25, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.015);

    osc.connect(gain);
    gain.connect(fallbackAudioCtx.destination);

    osc.start(startTime);
    osc.stop(startTime + 0.015);
  } catch (e) {
    // Audio playback is optional; ignore if user hasn't interacted or audio is restricted
  }
};

export const triggerHaptic = (type: 'score' | 'undo' | 'toggle' | 'tap' = 'score') => {
  const now = Date.now();
  // Prevent duplicate feedback if both pointerdown and click fire rapidly (<80ms)
  if (lastHapticTimestamp > 0 && now >= lastHapticTimestamp && now - lastHapticTimestamp < 80) {
    return;
  }
  lastHapticTimestamp = now;

  let didVibrate = false;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      switch (type) {
        case 'score':
          // Uniform tactile vibration feedback for all score input buttons (0-4)
          didVibrate = Boolean(navigator.vibrate(60));
          break;
        case 'undo':
          didVibrate = Boolean(navigator.vibrate([40, 60, 40]));
          break;
        case 'toggle':
          didVibrate = Boolean(navigator.vibrate(35));
          break;
        case 'tap':
          didVibrate = Boolean(navigator.vibrate(25));
          break;
      }
    }
  } catch (e) {
    // Vibration may be unavailable, unsupported, or disallowed on some devices/browsers
    didVibrate = false;
  }

  // When vibration is unsupported or blocked (Firefox 129+, Safari, desktop, or iframe permissions),
  // play a subtle tactile acoustic click so users on all platforms receive immediate sensory confirmation
  if (!didVibrate) {
    playHapticFallbackClick();
  }
};


