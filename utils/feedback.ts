// Tactile haptic and acoustic umpire indicator feedback utility for touch scoring

let lastHapticTimestamp = 0;
let fallbackAudioCtx: AudioContext | null = null;

export const resetHapticThrottle = () => {
  lastHapticTimestamp = 0;
};

// Get or lazily initialize the Web Audio context
const getAudioContext = (): AudioContext | null => {
  if (typeof window === 'undefined') return null;
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!fallbackAudioCtx) {
      fallbackAudioCtx = new AudioContextClass();
    }
    if (fallbackAudioCtx.state === 'suspended') {
      fallbackAudioCtx.resume().catch(() => {});
    }
    return fallbackAudioCtx;
  } catch {
    return null;
  }
};

// Proactively unlock Web Audio on iOS Safari / WebKit upon first user gesture
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    try {
      const ctx = getAudioContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    } catch {
      // Ignore background audio unlock errors
    }
  };

  ['touchstart', 'touchend', 'pointerdown', 'click'].forEach((event) => {
    window.addEventListener(event, unlockAudio, { passive: true, once: true });
  });
}

/**
 * Authentic mechanical baseball umpire counter indicator "snap-click".
 * Replicates the dual-tooth ratchet action of an umpire's indicator (ball/strike counter)
 * to provide unmistakable acoustic confirmation on iPhones and non-vibrating devices.
 */
export const playUmpireClickerSound = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const t = ctx.currentTime;

    // Component 1: Initial high-frequency mechanical tooth release snap (~2200Hz -> 650Hz in 8ms)
    const snapOsc = ctx.createOscillator();
    const snapGain = ctx.createGain();
    snapOsc.type = 'triangle';
    snapOsc.frequency.setValueAtTime(2200, t);
    snapOsc.frequency.exponentialRampToValueAtTime(650, t + 0.008);

    snapGain.gain.setValueAtTime(0.45, t);
    snapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.008);

    snapOsc.connect(snapGain);
    snapGain.connect(ctx.destination);
    snapOsc.start(t);
    snapOsc.stop(t + 0.009);

    // Component 2: Ratchet stop impact / settling body thump (~900Hz -> 180Hz in 20ms)
    const bodyOsc = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    const bodyStart = t + 0.003; // Slight 3ms offset simulates the physical ratchet tooth seating
    bodyOsc.type = 'sine';
    bodyOsc.frequency.setValueAtTime(900, bodyStart);
    bodyOsc.frequency.exponentialRampToValueAtTime(180, bodyStart + 0.020);

    bodyGain.gain.setValueAtTime(0.35, bodyStart);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, bodyStart + 0.020);

    bodyOsc.connect(bodyGain);
    bodyGain.connect(ctx.destination);
    bodyOsc.start(bodyStart);
    bodyOsc.stop(bodyStart + 0.021);

    // Component 3: Mechanical friction click texture (bandpass filtered noise burst)
    const sampleRate = ctx.sampleRate || 44100;
    const bufferLength = Math.max(1, Math.floor(sampleRate * 0.005));
    const noiseBuffer = ctx.createBuffer(1, bufferLength, sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferLength; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferLength);
    }

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(3200, t);
    filter.Q.setValueAtTime(3, t);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.2, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.005);

    noiseSource.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noiseSource.start(t);
    noiseSource.stop(t + 0.006);
  } catch {
    // Audio playback is optional & non-blocking
  }
};

/**
 * Subtle tactile acoustic click fallback for general UI taps/toggles
 */
export const playHapticFallbackClick = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const startTime = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, startTime);
    osc.frequency.exponentialRampToValueAtTime(40, startTime + 0.015);

    gain.gain.setValueAtTime(0.25, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.015);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + 0.015);
  } catch {
    // Non-blocking
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
  } catch {
    didVibrate = false;
  }

  // Umpire scoring feedback:
  // On score recording, always play the authentic umpire indicator clicker sound so umpires
  // on iPhones, iPads, Firefox, and desktop get instant, audible mechanical confirmation that
  // the pitch score was registered.
  if (type === 'score') {
    playUmpireClickerSound();
  } else if (!didVibrate) {
    playHapticFallbackClick();
  }
};


