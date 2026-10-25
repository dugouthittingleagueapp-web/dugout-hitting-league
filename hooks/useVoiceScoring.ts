import { useState, useEffect, useRef, useCallback } from 'react';

interface VoiceScoringOptions {
  enabled: boolean;
  onScore: (score: number) => void;
  onUndo: () => void;
}

// Universal Haptic / Vibration feedback
export const triggerHaptic = (type: 'score' | 'homerun' | 'undo' | 'toggle' | 'tap' = 'score') => {
  try {
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      switch (type) {
        case 'homerun':
          navigator.vibrate([70, 50, 70, 50, 140]);
          break;
        case 'score':
          navigator.vibrate(80);
          break;
        case 'undo':
          navigator.vibrate([50, 70, 50]);
          break;
        case 'toggle':
          navigator.vibrate(40);
          break;
        case 'tap':
          navigator.vibrate(25);
          break;
      }
    }
  } catch (e) {
    // Vibration may be disallowed or unavailable on some desktop browsers
  }
};

// Gentle audio chime confirmation using Web Audio API
let sharedAudioCtx: AudioContext | null = null;

const playChime = (frequency: number = 587.33, type: OscillatorType = 'sine', duration: number = 0.12) => {
  try {
    if (typeof window === 'undefined') return;
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new AudioContextClass();
    }
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }
    const osc = sharedAudioCtx.createOscillator();
    const gain = sharedAudioCtx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, sharedAudioCtx.currentTime);
    gain.gain.setValueAtTime(0.08, sharedAudioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, sharedAudioCtx.currentTime + duration);

    osc.connect(gain);
    gain.connect(sharedAudioCtx.destination);

    osc.start();
    osc.stop(sharedAudioCtx.currentTime + duration);
  } catch (e) {
    // Audio context may be blocked before first user gesture
  }
};

export const useVoiceScoring = ({ enabled, onScore, onUndo }: VoiceScoringOptions) => {
  const [isListening, setIsListening] = useState(false);
  const [lastHeard, setLastHeard] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const enabledRef = useRef(enabled);
  const onScoreRef = useRef(onScore);
  const onUndoRef = useRef(onUndo);
  const lastScoreTimeRef = useRef<number>(0);
  const isStartingRef = useRef(false);
  const isActiveRef = useRef(false);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    onScoreRef.current = onScore;
  }, [onScore]);

  useEffect(() => {
    onUndoRef.current = onUndo;
  }, [onUndo]);

  const processTranscript = useCallback((transcript: string) => {
    const clean = transcript.toLowerCase().trim();
    if (!clean) return;

    // Check for "undo" command
    if (clean.includes('undo') || clean.includes('back') || clean.includes('cancel')) {
      const now = Date.now();
      if (now - lastScoreTimeRef.current < 400) return;
      lastScoreTimeRef.current = now;

      setLastHeard('Undo');
      triggerHaptic('undo');
      playChime(440, 'triangle', 0.15);
      onUndoRef.current();
      return;
    }

    // Number matching (strictly numbers 0, 1, 2, 3, 4)
    let matchedScore: number | null = null;

    if (/\b(0|zero|miss|out|nothing|strike)\b/.test(clean)) matchedScore = 0;
    else if (/\b(1|one|single)\b/.test(clean)) matchedScore = 1;
    else if (/\b(2|two|double|to|too)\b/.test(clean)) matchedScore = 2;
    else if (/\b(3|three|triple)\b/.test(clean)) matchedScore = 3;
    else if (/\b(4|four|homer|home run|quad)\b/.test(clean)) matchedScore = 4;

    if (matchedScore !== null) {
      const now = Date.now();
      if (now - lastScoreTimeRef.current < 400) return;
      lastScoreTimeRef.current = now;

      setLastHeard(`${matchedScore} pts`);
      // Haptic vibration feedback
      triggerHaptic(matchedScore === 4 ? 'homerun' : 'score');
      // Upbeat confirmation chime
      playChime(matchedScore === 0 ? 350 : 500 + matchedScore * 100, 'sine', 0.12);
      onScoreRef.current(matchedScore);
    }
  }, []);

  useEffect(() => {
    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      setSupported(false);
      return;
    }

    let isCleanedUp = false;
    let restartTimeout: any = null;

    const startRecognition = () => {
      if (isCleanedUp || !enabledRef.current) return;
      if (isActiveRef.current || isStartingRef.current) return;

      isStartingRef.current = true;

      try {
        // Clean up any stale previous instance
        if (recognitionRef.current) {
          try {
            recognitionRef.current.abort();
          } catch (e) {}
          recognitionRef.current = null;
        }

        const recognition = new SpeechRecognitionClass();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = 'en-US';
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
          isStartingRef.current = false;
          isActiveRef.current = true;
          setIsListening(true);
          setError(null);
        };

        recognition.onend = () => {
          isStartingRef.current = false;
          isActiveRef.current = false;
          setIsListening(false);

          // Bulletproof restart: schedule after brief timeout to avoid DOMException in Chrome
          if (!isCleanedUp && enabledRef.current) {
            clearTimeout(restartTimeout);
            restartTimeout = setTimeout(() => {
              startRecognition();
            }, 150);
          }
        };

        recognition.onerror = (event: any) => {
          isStartingRef.current = false;
          const err = event.error;
          if (err === 'not-allowed') {
            setError('Microphone access was denied. Please allow microphone permissions in your browser.');
            isActiveRef.current = false;
            setIsListening(false);
          } else if (err === 'audio-capture') {
            setError('No microphone detected on this device.');
            isActiveRef.current = false;
            setIsListening(false);
          }
          // 'no-speech', 'network', 'aborted' are transient; onend will restart
        };

        recognition.onresult = (event: any) => {
          if (!event.results) return;
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const res = event.results[i];
            if (res && res[0] && res[0].transcript) {
              processTranscript(res[0].transcript);
            }
          }
        };

        recognitionRef.current = recognition;
        recognition.start();
      } catch (e) {
        isStartingRef.current = false;
        isActiveRef.current = false;
        // Retry shortly if start was blocked by audio subsystem transition
        if (!isCleanedUp && enabledRef.current) {
          clearTimeout(restartTimeout);
          restartTimeout = setTimeout(() => {
            startRecognition();
          }, 300);
        }
      }
    };

    if (enabled) {
      setError(null);
      startRecognition();
    } else {
      isActiveRef.current = false;
      isStartingRef.current = false;
      setIsListening(false);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {}
        recognitionRef.current = null;
      }
    }

    // Watchdog timer: every 1200ms, ensure active listening if enabled
    const watchdog = setInterval(() => {
      if (enabledRef.current && !isCleanedUp && !isActiveRef.current && !isStartingRef.current) {
        startRecognition();
      }
    }, 1200);

    return () => {
      isCleanedUp = true;
      clearInterval(watchdog);
      clearTimeout(restartTimeout);
      isActiveRef.current = false;
      isStartingRef.current = false;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {}
        recognitionRef.current = null;
      }
    };
  }, [enabled, processTranscript]);

  return {
    isListening,
    lastHeard,
    supported,
    error
  };
};
