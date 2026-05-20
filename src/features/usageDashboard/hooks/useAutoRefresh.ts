import { useRef, useCallback, useEffect } from 'react';

export function useAutoRefresh(
  callback: () => void,
  intervalSeconds: number,
) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    stop();
    if (intervalSeconds <= 0) return;
    timerRef.current = setInterval(() => {
      callbackRef.current();
    }, intervalSeconds * 1000);
  }, [intervalSeconds, stop]);

  const reset = useCallback(() => {
    stop();
    if (intervalSeconds > 0) {
      start();
    }
  }, [intervalSeconds, start, stop]);

  return { start, stop, reset };
}
