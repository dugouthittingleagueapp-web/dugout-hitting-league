import { useState, useEffect, useRef, useCallback } from 'react';

export interface VoiceScoringOptions {
  enabled: boolean;
  onScore: (score: number) => void;
  onUndo: () => void;
}

export interface VoiceCommand {
  type: 'score' | 'undo';
  score?: number;
  raw: string;
  matchedWord: string;
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

/**
 * Robust phonetic and baseball vocabulary parser.
 * Handles digits, words, homophones, slang, and common ambient speech transcriptions.
 */
export const parseVoiceTranscript = (rawTranscript: string): VoiceCommand | null => {
  if (!rawTranscript || typeof rawTranscript !== 'string') return null;

  // Clean transcript: lowercase, remove punctuation, collapse extra whitespace
  const clean = rawTranscript
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) return null;

  // 1. Check for UNDO commands (including common speech engine misrecognitions like "and do", "on do")
  const undoRegex = /\b(undo|un do|and do|on do|in do|take back|scratch|cancel|oops|delete|erase|mistake|wrong|remove|go back|back)\b/;
  const undoMatch = clean.match(undoRegex);
  if (undoMatch) {
    return {
      type: 'undo',
      raw: rawTranscript,
      matchedWord: undoMatch[0]
    };
  }

  // 2. Multi-word phrases with specific baseball scoring meanings
  // 4 Points: Home run variations
  const fourPhraseRegex = /\b(home run|homerun|grand slam|four bagger|four points|4 points|big fly|moon shot|moonshot|over the fence|out of the park)\b/;
  const fourPhraseMatch = clean.match(fourPhraseRegex);
  if (fourPhraseMatch) {
    return { type: 'score', score: 4, raw: rawTranscript, matchedWord: fourPhraseMatch[0] };
  }

  // 3 Points: Triple variations
  const threePhraseRegex = /\b(three points|3 points|third base|3 bagger|three bagger)\b/;
  const threePhraseMatch = clean.match(threePhraseRegex);
  if (threePhraseMatch) {
    return { type: 'score', score: 3, raw: rawTranscript, matchedWord: threePhraseMatch[0] };
  }

  // 2 Points: Double variations
  const twoPhraseRegex = /\b(two points|2 points|second base|two bagger|2 bagger)\b/;
  const twoPhraseMatch = clean.match(twoPhraseRegex);
  if (twoPhraseMatch) {
    return { type: 'score', score: 2, raw: rawTranscript, matchedWord: twoPhraseMatch[0] };
  }

  // 1 Point: Single variations
  const onePhraseRegex = /\b(one point|1 point|base hit|basehit|single hit|first base)\b/;
  const onePhraseMatch = clean.match(onePhraseRegex);
  if (onePhraseMatch) {
    return { type: 'score', score: 1, raw: rawTranscript, matchedWord: onePhraseMatch[0] };
  }

  // 0 Points: Out / Strike / Miss / Foul multi-word variations (checked early to prevent partial collisions with digits)
  const zeroPhraseRegex = /\b(zero points|0 points|swing and miss|foul ball|ground out|fly out|pop out|line out|no hit|struck out|strike out|strike one|strike two|strike three|called strike)\b/;
  const zeroPhraseMatch = clean.match(zeroPhraseRegex);
  if (zeroPhraseMatch) {
    return { type: 'score', score: 0, raw: rawTranscript, matchedWord: zeroPhraseMatch[0] };
  }

  // 3. Single words & digits:
  // Out / Strike / Miss terms take priority so "strike" or "miss" is never misread as another digit
  const zeroRegex = /\b(0|zero|hero|cero|sierra|out|miss|missed|strike|whiff|foul|fouled|strikeout|struck|grounder|ball|take|nothing|none|nil|zip|nada|zilch|donut|oh|owe)\b/;
  const zeroMatch = clean.match(zeroRegex);
  if (zeroMatch) {
    return { type: 'score', score: 0, raw: rawTranscript, matchedWord: zeroMatch[0] };
  }

  // Score 4: (including common homophones like "for", "fore", "fort", "ford")
  const fourRegex = /\b(4|four|for|fore|fourth|ford|fort|pour|homer|dinger|bomb|blast|slam|quad|jack|yard|gone)\b/;
  const fourMatch = clean.match(fourRegex);
  if (fourMatch) {
    return { type: 'score', score: 4, raw: rawTranscript, matchedWord: fourMatch[0] };
  }

  // Score 3: (including common homophones like "tree", "free")
  const threeRegex = /\b(3|three|triple|triples|tree|free|thee|third|tripp)\b/;
  const threeMatch = clean.match(threeRegex);
  if (threeMatch) {
    return { type: 'score', score: 3, raw: rawTranscript, matchedWord: threeMatch[0] };
  }

  // Score 2: (including common homophones like "tu", "due", "dew", "deuce")
  const twoRegex = /\b(2|two|double|doubles|second|deuce|tu|due|dew|pair)\b/;
  const twoMatch = clean.match(twoRegex);
  if (twoMatch) {
    return { type: 'score', score: 2, raw: rawTranscript, matchedWord: twoMatch[0] };
  }

  // Score 1: (including common homophones like "won", "juan", "wan")
  const oneRegex = /\b(1|one|single|singles|won|juan|wan|first|hit)\b/;
  const oneMatch = clean.match(oneRegex);
  if (oneMatch) {
    return { type: 'score', score: 1, raw: rawTranscript, matchedWord: oneMatch[0] };
  }

  // Standalone homophones for 2 ("to", "too"):
  // Spoken "two" is frequently transcribed as isolated "to" or "too" by speech engines
  if (/^(to|too)$/.test(clean) || /\b(to|too)\b/.test(clean)) {
    return { type: 'score', score: 2, raw: rawTranscript, matchedWord: clean };
  }

  return null;
};

export const useVoiceScoring = ({ enabled, onScore, onUndo }: VoiceScoringOptions) => {
  const [isListening, setIsListening] = useState(false);
  const [lastHeard, setLastHeard] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const enabledRef = useRef(enabled);
  const isListeningRef = useRef(isListening);
  const onScoreRef = useRef(onScore);
  const onUndoRef = useRef(onUndo);
  const lastScoreTimeRef = useRef<number>(0);
  const restartTimerRef = useRef<any>(null);
  const watchdogTimerRef = useRef<any>(null);
  const handledIndicesRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    onScoreRef.current = onScore;
  }, [onScore]);

  useEffect(() => {
    onUndoRef.current = onUndo;
  }, [onUndo]);

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
          } else {
            setupRecognition();
          }
        } catch (err: any) {
          // If already running (InvalidStateError), ignore. Otherwise re-initialize
          if (err?.name !== 'InvalidStateError') {
            setupRecognition();
          }
        }
      }, 120);
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
        // ENABLE INTERIM RESULTS for instant response without needing awkward pauses
        recognition.interimResults = true;
        recognition.lang = 'en-US';
        // Check top 5 alternatives to catch misheard homophones immediately
        recognition.maxAlternatives = 5;

        recognition.onstart = () => {
          if (isCleanedUp) return;
          setIsListening(true);
          handledIndicesRef.current.clear();
          setError(null);
        };

        recognition.onend = () => {
          if (isCleanedUp) return;
          setIsListening(false);
          handledIndicesRef.current.clear();
          // Auto-restart immediately when recognition ends naturally or times out
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
          // 'no-speech', 'network', 'aborted' are transient; onend will automatically restart
        };

        recognition.onresult = (event: any) => {
          if (isCleanedUp) return;
          if (!event.results) return;

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const res = event.results[i];
            if (!res) continue;

            // If this result index was already recognized, ignore subsequent updates
            if (handledIndicesRef.current.has(i)) {
              continue;
            }

            let matchedCmd: VoiceCommand | null = null;
            let rawCandidate = '';

            // Check across all alternatives provided by speech recognition
            for (let alt = 0; alt < res.length; alt++) {
              const transcript = res[alt]?.transcript;
              if (transcript) {
                if (!rawCandidate) rawCandidate = transcript.trim();
                const cmd = parseVoiceTranscript(transcript);
                if (cmd) {
                  matchedCmd = cmd;
                  break;
                }
              }
            }

            if (matchedCmd) {
              const now = Date.now();
              // 450ms cooldown prevents accidental rapid-fire double triggers
              if (now - lastScoreTimeRef.current >= 450) {
                lastScoreTimeRef.current = now;
                handledIndicesRef.current.add(i);

                if (matchedCmd.type === 'undo') {
                  setLastHeard('Undo ↩️');
                  triggerHaptic('undo');
                  playChime(440, 'triangle', 0.15);
                  onUndoRef.current();
                } else if (matchedCmd.type === 'score' && matchedCmd.score !== undefined) {
                  const pts = matchedCmd.score;
                  setLastHeard(`${pts} pt${pts === 1 ? '' : 's'} ("${matchedCmd.matchedWord}")`);
                  // EXACT SAME FEEDBACK REGARDLESS OF HIT RESULT (0-4):
                  triggerHaptic('score');
                  playChime(587.33, 'sine', 0.12);
                  onScoreRef.current(pts);
                }
              }
            } else if (res.isFinal && rawCandidate) {
              // If a final result segment was not matched, show the user what was heard
              setLastHeard(`"${rawCandidate}" (unrecognized)`);
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

      // Watchdog interval to revive recognition if browser silently suspends it
      watchdogTimerRef.current = setInterval(() => {
        if (!isCleanedUp && enabledRef.current && !isListeningRef.current) {
          handleRestart();
        }
      }, 4000);
    } else {
      setIsListening(false);
      clearTimeout(restartTimerRef.current);
      clearInterval(watchdogTimerRef.current);
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
      clearInterval(watchdogTimerRef.current);
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
  }, [enabled]);

  return {
    isListening,
    lastHeard,
    supported,
    error
  };
};
