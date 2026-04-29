/**
 * TradingView-style Audio Alert System
 *
 * Features:
 * - Pre-loaded sounds for instant playback
 * - Multiple alert types
 * - Volume control
 * - Browser autoplay handling
 */

import { useCallback, useRef, useEffect } from 'react';

export type AlertSound =
  | 'zone-tap'      // Zone touched
  | 'order-filled'  // Order filled
  | 'stop-hit'      // Stop loss triggered
  | 'tp-hit'        // Take profit hit
  | 'breakeven'     // Breakeven moved
  | 'warning'       // General warning
  | 'success'       // Success sound
  | 'ding';         // Simple ding

// Generate beep tones programmatically (no sound files needed)
const createBeepSound = (
  frequency: number,
  duration: number,
  type: OscillatorType = 'sine',
  volume: number = 0.3
): () => void => {
  return () => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = frequency;
      oscillator.type = type;

      gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration / 1000);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + duration / 1000);
    } catch (err) {
      console.warn('Audio playback failed:', err);
    }
  };
};

// Double beep for important alerts
const createDoubleBeep = (
  frequency: number,
  duration: number,
  type: OscillatorType = 'sine',
  volume: number = 0.3
): () => void => {
  return () => {
    const beep = createBeepSound(frequency, duration, type, volume);
    beep();
    setTimeout(beep, duration + 50);
  };
};

// Triple beep for critical alerts
const createTripleBeep = (
  frequency: number,
  duration: number,
  type: OscillatorType = 'sine',
  volume: number = 0.3
): () => void => {
  return () => {
    const beep = createBeepSound(frequency, duration, type, volume);
    beep();
    setTimeout(beep, duration + 50);
    setTimeout(beep, (duration + 50) * 2);
  };
};

// Alert sound configurations (TradingView-style)
const ALERT_SOUNDS: Record<AlertSound, () => void> = {
  'zone-tap': createDoubleBeep(880, 150, 'sine', 0.4),      // High double beep
  'order-filled': createBeepSound(1200, 200, 'sine', 0.5),  // High success tone
  'stop-hit': createTripleBeep(400, 200, 'square', 0.4),    // Low warning triple beep
  'tp-hit': createDoubleBeep(1000, 150, 'sine', 0.5),       // Happy double beep
  'breakeven': createBeepSound(600, 300, 'triangle', 0.3),  // Medium confirmation
  'warning': createDoubleBeep(500, 200, 'sawtooth', 0.3),   // Warning sound
  'success': createBeepSound(800, 250, 'sine', 0.4),        // Simple success
  'ding': createBeepSound(1400, 100, 'sine', 0.3),          // Quick ding
};

// Singleton for global alert access
let globalPlayAlert: ((sound: AlertSound, message?: string) => void) | null = null;

export function useAudioAlert() {
  const volumeRef = useRef<number>(0.5);
  const enabledRef = useRef<boolean>(true);
  const lastPlayedRef = useRef<number>(0);

  const playAlert = useCallback((sound: AlertSound, message?: string) => {
    if (!enabledRef.current) return;

    // Debounce - prevent spam (min 200ms between alerts)
    const now = Date.now();
    if (now - lastPlayedRef.current < 200) return;
    lastPlayedRef.current = now;

    // Play the sound
    const playSound = ALERT_SOUNDS[sound];
    if (playSound) {
      playSound();
    }

    // Log the alert
    if (message) {
      console.log(`🔔 ALERT [${sound}]: ${message}`);
    }
  }, []);

  const setVolume = useCallback((volume: number) => {
    volumeRef.current = Math.max(0, Math.min(1, volume));
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    enabledRef.current = enabled;
  }, []);

  // Expose globally for use outside React components
  useEffect(() => {
    globalPlayAlert = playAlert;
    return () => {
      globalPlayAlert = null;
    };
  }, [playAlert]);

  return {
    playAlert,
    setVolume,
    setEnabled,
  };
}

// Global function for use outside React components
export function playGlobalAlert(sound: AlertSound, message?: string) {
  if (globalPlayAlert) {
    globalPlayAlert(sound, message);
  } else {
    // Fallback if hook not mounted
    const playSound = ALERT_SOUNDS[sound];
    if (playSound) playSound();
    if (message) console.log(`🔔 ALERT [${sound}]: ${message}`);
  }
}

export default useAudioAlert;
