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
  // Exact 4 matches (digits, numbers, homophones, slang, reverberated/clipped acoustics):
  if (/^(4|4th|four|for|fore|fourth|forth|ford|fort|forward|poor|pour|pore|floor|door|thor|core|cor|fall|full|form|from|homer|homers|dinger|bomb|blast|slam|quad|jack|yard|gone|hr|iv|forty|40|fourteen|14|fork|force|fo|foe|faux|pho|board|bored|court|port|short|sport|chord|cord|flour|flower|power|tour|sour|tower|bore|boar|chore|shore|store|tore|war|more|far|fur|fir|fair|fare|fear|fire|foam|or|oar|ore|our|hour)$/.test(clean)) {
    return { type: 'score', score: 4, raw: rawTranscript, matchedWord: clean };
  }

  // Exact 0 matches (digits, letter O, negations, baseball outs):
  if (/^(0|zero|zeros|zeroes|o|oh|owe|no|nope|not|hero|cero|xero|zro|zee|zed|sero|cerro|euro|arrow|row|out|outs|miss|missed|strike|strikes|whiff|whiffs|foul|fouled|ball|take|nothing|none|nil|null|zip|nada|zilch|donut|duck|blank|goose|bagel|shutout|k|kay)$/.test(clean)) {
    return { type: 'score', score: 0, raw: rawTranscript, matchedWord: clean };
  }

  // Exact 3 matches:
  if (/^(3|3rd|three|triple|triples|third|tree|free|trey|tray|tri|thee|tripp|trip|trips|trio|thru|through|threw)$/.test(clean)) {
    return { type: 'score', score: 3, raw: rawTranscript, matchedWord: clean };
  }

  // Exact 2 matches:
  if (/^(2|2nd|two|double|doubles|second|to|too|tu|due|dew|deuce|pair|duo|dos|do)$/.test(clean)) {
    return { type: 'score', score: 2, raw: rawTranscript, matchedWord: clean };
  }

  // Exact 1 matches:
  if (/^(1|1st|one|single|singles|first|won|juan|wan|hit|hits|uno)$/.test(clean)) {
    return { type: 'score', score: 1, raw: rawTranscript, matchedWord: clean };
  }

  // Standalone acoustic slips for "three":
  if (/^(the|see|sea|tea|tee|key|pee|fee|knee|glee|plea|flee)$/.test(clean)) {
    return { type: 'score', score: 3, raw: rawTranscript, matchedWord: clean };
  }

  // Standalone "h r" abbreviation for home run
  if (/^h\s*r$/.test(clean)) {
    return { type: 'score', score: 4, raw: rawTranscript, matchedWord: clean };
  }

  // 3. Multi-word phrases with specific baseball scoring meanings
  // 0 Points: Out / Strike / Miss / Foul multi-word variations (Checked FIRST among phrases so strike one / ball one scores 0)
  const zeroPhraseRegex = /\b(zero points|0 points|0 point|zero point|point zero|point 0|swing and miss|swung and miss|swung and missed|foul ball|foul tip|foul out|fouled out|ground out|ground ball|groundout|fly out|fly ball|flyout|pop out|pop up|pop fly|popout|popup|line out|lineout|no hit|struck out|strike out|strike one|strike 1|strike two|strike 2|strike three|strike 3|called strike|score 0|score zero|pitch 0|pitch zero|number 0|number zero|ball one|ball 1|ball two|ball 2|ball three|ball 3|no runs|zero runs|0 runs)\b/;
  const zeroPhraseMatch = clean.match(zeroPhraseRegex);
  if (zeroPhraseMatch) {
    return { type: 'score', score: 0, raw: rawTranscript, matchedWord: zeroPhraseMatch[0] };
  }

  // 4 Points: Home run variations, spoken scores, pitch numbers
  const fourPhraseRegex = /\b(home run|homerun|grand slam|four bagger|4 bagger|four points|4 points|4 point|four point|point four|point 4|big fly|moon shot|moonshot|over the fence|over the wall|out of the park|score 4|score four|pitch 4|pitch four|number 4|number four|it is four|it s four|its four|that is four|that s four|thats four|touch em all|touch them all|deep drive|solo shot|four runs|4 runs|got four|hit four|hit a four|give him four|give me four|all four|call four)\b/;
  const fourPhraseMatch = clean.match(fourPhraseRegex);
  if (fourPhraseMatch) {
    return { type: 'score', score: 4, raw: rawTranscript, matchedWord: fourPhraseMatch[0] };
  }

  // 3 Points: Triple variations
  const threePhraseRegex = /\b(three points|3 points|3 point|three point|point three|point 3|third base|3 bagger|three bagger|score 3|score three|pitch 3|pitch three|number 3|number three|three runs|3 runs|got three|hit three|hit a three)\b/;
  const threePhraseMatch = clean.match(threePhraseRegex);
  if (threePhraseMatch) {
    return { type: 'score', score: 3, raw: rawTranscript, matchedWord: threePhraseMatch[0] };
  }

  // 2 Points: Double variations
  const twoPhraseRegex = /\b(two points|2 points|2 point|two point|point two|point 2|second base|two bagger|2 bagger|score 2|score two|pitch 2|pitch two|number 2|number two|two runs|2 runs|got two|hit two|hit a two)\b/;
  const twoPhraseMatch = clean.match(twoPhraseRegex);
  if (twoPhraseMatch) {
    return { type: 'score', score: 2, raw: rawTranscript, matchedWord: twoPhraseMatch[0] };
  }

  // 1 Point: Single variations
  const onePhraseRegex = /\b(one point|1 point|one points|point one|point 1|base hit|basehit|single hit|first base|score 1|score one|pitch 1|pitch one|number 1|number one|one run|1 run|got one|hit one)\b/;
  const onePhraseMatch = clean.match(onePhraseRegex);
  if (onePhraseMatch) {
    return { type: 'score', score: 1, raw: rawTranscript, matchedWord: onePhraseMatch[0] };
  }

  // 4. Broader substring / word matches inside sentences:
  // Score 4:
  const fourRegex = /\b(4|4th|four|for|fore|fourth|forth|ford|fort|forward|poor|pour|pore|floor|door|thor|core|cor|fall|full|form|from|homer|homers|dinger|dingers|bomb|bombs|blast|blasts|slam|slams|quad|quads|quadruple|jack|jacks|yard|gone|hr|iv|forty|40|fourteen|14|fork|force|fo|foe|faux|pho|board|bored|court|port|short|sport|chord|cord|flour|flower|power|tour|sour|tower|bore|boar|chore|shore|store|tore|war|more|far|fur|fir|fair|fare|fear|fire|foam)\b/;
  const fourMatch = clean.match(fourRegex);
  if (fourMatch) {
    return { type: 'score', score: 4, raw: rawTranscript, matchedWord: fourMatch[0] };
  }

  // Score 3:
  const threeRegex = /\b(3|3rd|three|triple|triples|tree|free|third|tripp|trip|trips|trio|trey|tray|tri|thee|thru|through|threw)\b/;
  const threeMatch = clean.match(threeRegex);
  if (threeMatch) {
    return { type: 'score', score: 3, raw: rawTranscript, matchedWord: threeMatch[0] };
  }

  // Score 2:
  const twoRegex = /\b(2|2nd|two|double|doubles|second|deuce|tu|due|dew|pair|to|too|duo|dos)\b/;
  const twoMatch = clean.match(twoRegex);
  if (twoMatch) {
    return { type: 'score', score: 2, raw: rawTranscript, matchedWord: twoMatch[0] };
  }

  // Score 1:
  const oneRegex = /\b(1|1st|one|single|singles|won|juan|wan|first|hit|hits|uno)\b/;
  const oneMatch = clean.match(oneRegex);
  if (oneMatch) {
    return { type: 'score', score: 1, raw: rawTranscript, matchedWord: oneMatch[0] };
  }

  // Score 0:
  const zeroRegex = /\b(0|zero|zeros|zeroes|hero|cero|sierra|xero|zro|zee|zed|sero|cerro|euro|arrow|out|outs|miss|missed|strike|strikes|whiff|whiffs|foul|fouled|strikeout|struck|grounder|take|nothing|nil|null|zip|nada|zilch|donut|duck|blank|oh|owe|o|no|nope|not|goose|bagel|shutout)\b/;
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
        // Always instantiate a clean instance to avoid InvalidStateError on stopped instances
        setupRecognition();
      }, 100);
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
        // MUST BE TRUE: Enables immediate zero-lag recognition for 1-syllable numbers (4, 0, 1, 2, 3)
        // without waiting 3-8 seconds for silence detection to finalize
        recognition.interimResults = true;
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

            // If this result index was already recognized and executed, ignore duplicate events for this utterance
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
              // 400ms cooldown prevents accidental rapid-fire double triggers
              if (now - lastScoreTimeRef.current >= 400) {
                lastScoreTimeRef.current = now;
                // Mark this index as handled so subsequent interim/final events for index i are skipped
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
            } else if (rawCandidate) {
              // Update what was heard in real-time so the user has immediate visual confirmation of mic activity
              setLastHeard(res.isFinal ? `"${rawCandidate}" (unrecognized)` : `"${rawCandidate}"...`);
            }
          }
        };

        recognitionRef.current = recognition;
        recognition.start();
      } catch (err: any) {
        setIsListening(false);
        handleRestart();
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
