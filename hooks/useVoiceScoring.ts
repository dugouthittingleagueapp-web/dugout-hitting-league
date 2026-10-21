import { useState, useEffect, useRef, useCallback } from 'react';

interface VoiceScoringOptions {
  enabled: boolean;
  onScore: (score: number) => void;
  onUndo: () => void;
}

// Gentle audio chime confirmation using Web Audio API so umpire knows a pitch was recognized without looking down
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
  const recognitionRef = useRef<any>(null);
  const enabledRef = useRef(enabled);
  const onScoreRef = useRef(onScore);
  const onUndoRef = useRef(onUndo);

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
      setLastHeard('Undo');
      playChime(440, 'triangle', 0.15);
      onUndoRef.current();
      return;
    }

    // Number matching (strictly numbers 0, 1, 2, 3, 4)
    // Supports digits and spoken words
    let matchedScore: number | null = null;

    if (/\b(0|zero|miss|out|nothing|strike)\b/.test(clean)) matchedScore = 0;
    else if (/\b(1|one|single)\b/.test(clean)) matchedScore = 1;
    else if (/\b(2|two|double|to|too)\b/.test(clean)) matchedScore = 2;
    else if (/\b(3|three|triple)\b/.test(clean)) matchedScore = 3;
    else if (/\b(4|four|homer|home run|quad)\b/.test(clean)) matchedScore = 4;

    if (matchedScore !== null) {
      setLastHeard(`${matchedScore} pts`);
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
    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onend = () => {
      setIsListening(false);
      // If voice scoring is still enabled and hook is not cleaned up, restart automatically
      if (!isCleanedUp && enabledRef.current) {
        try {
          recognition.start();
        } catch (e) {}
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed') {
        console.warn('Microphone permission denied for voice scoring');
        setIsListening(false);
      }
    };

    recognition.onresult = (event: any) => {
      const results = event.results;
      if (!results || results.length === 0) return;
      const latest = results[results.length - 1];
      if (latest && latest[0]) {
        processTranscript(latest[0].transcript);
      }
    };

    recognitionRef.current = recognition;

    if (enabled) {
      try {
        recognition.start();
      } catch (e) {}
    }

    return () => {
      isCleanedUp = true;
      try {
        recognition.stop();
      } catch (e) {}
      recognitionRef.current = null;
    };
  }, [enabled, processTranscript]);

  return {
    isListening,
    lastHeard,
    supported
  };
};
