import { useEffect } from 'react';

/**
 * Keep the scoring display awake when supported by the umpire's device.
 * Browsers without the Screen Wake Lock API continue normally.
 */
export const useScreenWakeLock = () => {
  useEffect(() => {
    let wakeLock: { release: () => Promise<void> } | null = null;
    let cancelled = false;
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          const acquired = await (navigator as any).wakeLock.request('screen');
          if (cancelled) {
            void acquired.release().catch(() => {});
          } else {
            wakeLock = acquired;
          }
        }
      } catch (err) { /* Wake lock support is optional. */ }
    };
    void requestWakeLock();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void requestWakeLock();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLock) void wakeLock.release().catch(() => {});
    };
  }, []);
};
