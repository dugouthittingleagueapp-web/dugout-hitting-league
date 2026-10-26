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
 * Handles digits, words, homophones, slang, clipped acoustics, and common ambient speech transcriptions.
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
  const undoRegex = /\b(undo|un do|and do|on do|in do|take back|scratch|scratch that|cancel|oops|delete|erase|mistake|wrong|remove|go back|back)\b/;
  const undoMatch = clean.match(undoRegex);
  if (undoMatch) {
    return {
      type: 'undo',
      raw: rawTranscript,
      matchedWord: undoMatch[0]
    };
  }

  // 2. High-speed exact single-token match (covers 95%+ of live umpire spoken inputs)
  // Exact 4 matches:
  if (/^(4|4th|four|for|fore|fourth|forth|ford|fort|poor|pour|pore|floor|door|thor|core|cor|fall|full|forward|form|from|homer|dinger|bomb|blast|slam|quad|jack|yard|gone|hr|iv)$/.test(clean)) {
    return { type: 'score', score: 4, raw: rawTranscript, matchedWord: clean };
  }

  // Exact 0 matches (digits, letter O, negations, baseball outs):
  if (/^(0|zero|zeros|zeroes|o|oh|owe|no|nope|not|hero|cero|xero|zro|zee|zed|sero|cerro|euro|arrow|row|out|outs|miss|missed|strike|strikes|whiff|whiffs|foul|fouled|ball|take|nothing|none|nil|null|zip|nada|zilch|donut|duck|blank)$/.test(clean)) {
    return { type: 'score', score: 0, raw: rawTranscript, matchedWord: clean };
  }

  // Exact 3 matches:
  if (/^(3|3rd|three|triple|triples|third|tree|free|trey|tray|tri|thee|tripp)$/.test(clean)) {
    return { type: 'score', score: 3, raw: rawTranscript, matchedWord: clean };
  }

  // Exact 2 matches:
  if (/^(2|2nd|two|double|doubles|second|to|too|tu|due|dew|deuce|pair)$/.test(clean)) {
    return { type: 'score', score: 2, raw: rawTranscript, matchedWord: clean };
  }

  // Exact 1 matches:
  if (/^(1|1st|one|single|singles|first|won|juan|wan|hit)$/.test(clean)) {
    return { type: 'score', score: 1, raw: rawTranscript, matchedWord: clean };
  }

  // Clipped microphone / VAD acoustics for "four" (where initial /f/ was cut by noise gate or ambient sounds):
  if (/^(or|oar|ore|our|hour|bore|boar|chore|shore|store|tore|war|more|far|fur|fir|fair|fare|fear|fire|foam|force)$/.test(clean)) {
    return { type: 'score', score: 4, raw: rawTranscript, matchedWord: clean };
  }

  // Standalone acoustic slips for "three":
  if (/^(the|see|sea|tea|tee)$/.test(clean)) {
    return { type: 'score', score: 3, raw: rawTranscript, matchedWord: clean };
  }

  // Standalone "h r" abbreviation for home run
  if (/^h\s*r$/.test(clean)) {
    return { type: 'score', score: 4, raw: rawTranscript, matchedWord: clean };
  }

  // 3. Multi-word phrases with specific baseball scoring meanings
  // 4 Points: Home run variations
  const fourPhraseRegex = /\b(home run|homerun|grand slam|four bagger|4 bagger|four points|4 points|4 point|four point|point four|point 4|big fly|moon shot|moonshot|over the fence|over the wall|out of the park|score 4|score four|pitch 4|pitch four|number 4|number four)\b/;
  const fourPhraseMatch = clean.match(fourPhraseRegex);
  if (fourPhraseMatch) {
    return { type: 'score', score: 4, raw: rawTranscript, matchedWord: fourPhraseMatch[0] };
  }

  // 3 Points: Triple variations
  const threePhraseRegex = /\b(three points|3 points|3 point|three point|point three|point 3|third base|3 bagger|three bagger|score 3|score three|pitch 3|pitch three|number 3|number three)\b/;
  const threePhraseMatch = clean.match(threePhraseRegex);
  if (threePhraseMatch) {
    return { type: 'score', score: 3, raw: rawTranscript, matchedWord: threePhraseMatch[0] };
  }

  // 2 Points: Double variations
  const twoPhraseRegex = /\b(two points|2 points|2 point|two point|point two|point 2|second base|two bagger|2 bagger|score 2|score two|pitch 2|pitch two|number 2|number two)\b/;
  const twoPhraseMatch = clean.match(twoPhraseRegex);
  if (twoPhraseMatch) {
    return { type: 'score', score: 2, raw: rawTranscript, matchedWord: twoPhraseMatch[0] };
  }

  // 1 Point: Single variations
  const onePhraseRegex = /\b(one point|1 point|1 point|one points|point one|point 1|base hit|basehit|single hit|first base|score 1|score one|pitch 1|pitch one|number 1|number one)\b/;
  const onePhraseMatch = clean.match(onePhraseRegex);
  if (onePhraseMatch) {
    return { type: 'score', score: 1, raw: rawTranscript, matchedWord: onePhraseMatch[0] };
  }

  // 0 Points: Out / Strike / Miss / Foul multi-word variations (checked early so "strike three" or "ball four" correctly scores 0)
  const zeroPhraseRegex = /\b(zero points|0 points|0 point|zero point|point zero|point 0|swing and miss|swung and miss|swung and missed|foul ball|foul tip|foul out|fouled out|ground out|ground ball|fly out|fly ball|pop out|pop up|pop fly|line out|no hit|struck out|strike out|strike one|strike 1|strike two|strike 2|strike three|strike 3|called strike|score 0|score zero|pitch 0|pitch zero|number 0|number zero|ball one|ball 1|ball two|ball 2|ball three|ball 3|ball four|ball 4)\b/;
  const zeroPhraseMatch = clean.match(zeroPhraseRegex);
  if (zeroPhraseMatch) {
    return { type: 'score', score: 0, raw: rawTranscript, matchedWord: zeroPhraseMatch[0] };
  }

  // 4. Broader substring / word matches inside sentences:
  // Score 4:
  const fourRegex = /\b(4|4th|four|for|fore|fourth|forth|ford|fort|forward|poor|pour|pore|floor|door|thor|core|cor|fall|full|form|from|homer|homers|dinger|dingers|bomb|bombs|blast|blasts|slam|slams|quad|quads|quadruple|jack|jacks|yard|gone|hr|iv)\b/;
  const fourMatch = clean.match(fourRegex);
  if (fourMatch) {
    return { type: 'score', score: 4, raw: rawTranscript, matchedWord: fourMatch[0] };
  }

  // Score 3:
  const threeRegex = /\b(3|3rd|three|triple|triples|tree|free|third|tripp|trey|tray|tri|thee)\b/;
  const threeMatch = clean.match(threeRegex);
  if (threeMatch) {
    return { type: 'score', score: 3, raw: rawTranscript, matchedWord: threeMatch[0] };
  }

  // Score 2:
  const twoRegex = /\b(2|2nd|two|double|doubles|second|deuce|tu|due|dew|pair|to|too)\b/;
  const twoMatch = clean.match(twoRegex);
  if (twoMatch) {
    return { type: 'score', score: 2, raw: rawTranscript, matchedWord: twoMatch[0] };
  }

  // Score 1:
  const oneRegex = /\b(1|1st|one|single|singles|won|juan|wan|first|hit)\b/;
  const oneMatch = clean.match(oneRegex);
  if (oneMatch) {
    return { type: 'score', score: 1, raw: rawTranscript, matchedWord: oneMatch[0] };
  }

  // Score 0:
  const zeroRegex = /\b(0|zero|zeros|zeroes|hero|cero|sierra|xero|zro|zee|zed|sero|cerro|euro|arrow|out|outs|miss|missed|strike|strikes|whiff|whiffs|foul|fouled|strikeout|struck|grounder|ball|take|nothing|none|nil|null|zip|nada|zilch|donut|duck|blank|oh|owe|o|no|nope|not)\b/;
  const zeroMatch = clean.match(zeroRegex);
  if (zeroMatch) {
    return { type: 'score', score: 0, raw: rawTranscript, matchedWord: zeroMatch[0] };
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
        // Evaluate finalized results so the acoustic model captures the full utterance
        recognition.interimResults = false;
        recognition.lang = 'en-US';
        // Request top 5 alternatives to catch acoustic variants and homophones
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

            // If this result index was already recognized, ignore duplicates
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
