import { useState, useEffect, useRef, useCallback } from 'react';

interface VoiceScoringOptions {
  enabled: boolean;
  onScore: (score: number) => void;
  onUndo: () => void;
}

// Universal Haptic / Vibration feedback
export const triggerHaptic = (type: 'score' | 'undo' | 'toggle' | 'tap' = 'score') => {
  try {
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      switch (type) {
        case 'score':
          // Uniform tactile feedback for ALL scores 0-4
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
    // Vibration may be unavailable or disallowed on some browsers
  }
};

// Gentle audio chime confirmation using Web Audio API
let sharedAudioCtx: AudioContext | null = null;

export const unlockAudio = () => {
  try {
    if (typeof window === 'undefined') return;
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass && (!sharedAudioCtx || sharedAudioCtx.state === 'closed')) {
      sharedAudioCtx = new AudioContextClass();
    }
    if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }
  } catch (e) {}
};

export const playChime = (frequency: number = 587.33, type: OscillatorType = 'sine', duration: number = 0.12) => {
  try {
    if (typeof window === 'undefined') return;
    unlockAudio();
    if (!sharedAudioCtx) return;

    const osc = sharedAudioCtx.createOscillator();
    const gain = sharedAudioCtx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, sharedAudioCtx.currentTime);
    gain.gain.setValueAtTime(0.09, sharedAudioCtx.currentTime);
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
  const restartTimerRef = useRef<any>(null);

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
    if (/\b(undo|back|cancel|scratch|oops)\b/.test(clean)) {
      const now = Date.now();
      if (now - lastScoreTimeRef.current < 400) return;
      lastScoreTimeRef.current = now;

      setLastHeard('Undo');
      triggerHaptic('undo');
      playChime(440, 'triangle', 0.15);
      onUndoRef.current();
      return;
    }

    // Number matching (0, 1, 2, 3, 4) with common homophones and baseball terms
    let matchedScore: number | null = null;

    if (/\b(0|zero|miss|out|nothing|strike|oh|ball|none|take)\b/.test(clean)) {
      matchedScore = 0;
    } else if (/\b(1|one|won|single|first|juan)\b/.test(clean)) {
      matchedScore = 1;
    } else if (/\b(2|two|to|too|double|second|tu)\b/.test(clean)) {
      matchedScore = 2;
    } else if (/\b(3|three|tree|free|triple|third)\b/.test(clean)) {
      matchedScore = 3;
    } else if (/\b(4|four|for|fore|homer|home run|homerun|quad|fourth|ford)\b/.test(clean)) {
      matchedScore = 4;
    }

    if (matchedScore !== null) {
      const now = Date.now();
      if (now - lastScoreTimeRef.current < 400) return;
      lastScoreTimeRef.current = now;

      setLastHeard(`${matchedScore} pts`);
      // EXACT SAME FEEDBACK REGARDLESS OF HIT RESULT (0-4):
      triggerHaptic('score');
      playChime(587.33, 'sine', 0.12);
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

    const handleRestart = () => {
      if (isCleanedUp || !enabledRef.current) return;
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => {
        if (isCleanedUp || !enabledRef.current) return;
        try {
          if (recognitionRef.current) {
            recognitionRef.current.start();
          }
        } catch (err: any) {
          // If already started (InvalidStateError), ignore. Otherwise re-initialize
          if (err?.name !== 'InvalidStateError') {
            setupRecognition();
          }
        }
      }, 250);
    };

    const setupRecognition = () => {
      if (isCleanedUp || !enabledRef.current) return;

      try {
        if (recognitionRef.current) {
          try {
            recognitionRef.current.onstart = null;
            recognitionRef.current.onend = null;
            recognitionRef.current.onerror = null;
            recognitionRef.current.onresult = null;
            recognitionRef.current.abort();
          } catch (e) {}
          recognitionRef.current = null;
        }

        const recognition = new SpeechRecognitionClass();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = 'en-US';
        recognition.maxAlternatives = 2;

        recognition.onstart = () => {
          if (isCleanedUp) return;
          setIsListening(true);
          setError(null);
        };

        recognition.onend = () => {
          if (isCleanedUp) return;
          setIsListening(false);
          // Auto restart when recognition ends naturally or due to pause
          handleRestart();
        };

        recognition.onerror = (event: any) => {
          if (isCleanedUp) return;
          const err = event.error;
          if (err === 'not-allowed') {
            setError('Microphone access was denied. Please allow microphone permissions in your browser address bar.');
            setIsListening(false);
          } else if (err === 'audio-capture') {
            setError('No microphone detected on this device.');
            setIsListening(false);
          }
          // 'no-speech', 'network', 'aborted' are transient; onend will restart
        };

        recognition.onresult = (event: any) => {
          if (isCleanedUp) return;
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
      } catch (err: any) {
        setIsListening(false);
        if (err?.name !== 'InvalidStateError') {
          handleRestart();
        }
      }
    };

    if (enabled) {
      setError(null);
      setupRecognition();
    } else {
      setIsListening(false);
      clearTimeout(restartTimerRef.current);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.onstart = null;
          recognitionRef.current.onend = null;
          recognitionRef.current.onerror = null;
          recognitionRef.current.onresult = null;
          recognitionRef.current.stop();
        } catch (e) {}
        recognitionRef.current = null;
      }
    }

    return () => {
      isCleanedUp = true;
      clearTimeout(restartTimerRef.current);
      setIsListening(false);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.onstart = null;
          recognitionRef.current.onend = null;
          recognitionRef.current.onerror = null;
          recognitionRef.current.onresult = null;
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
