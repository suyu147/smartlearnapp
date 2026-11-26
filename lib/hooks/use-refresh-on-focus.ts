"use client";
import { useEffect, useRef } from 'react';
export function useRefreshOnFocus(refresh: () => void | Promise<void>, enabled = true) {
  const latest = useRef(refresh), allowed = useRef(enabled);
  latest.current = refresh; allowed.current = enabled;
  useEffect(() => {
    const run = () => { if (allowed.current && document.visibilityState === 'visible') void Promise.resolve(latest.current()).catch(() => {}); };
    window.addEventListener('focus', run); window.addEventListener('online', run); document.addEventListener('visibilitychange', run);
    return () => { window.removeEventListener('focus', run); window.removeEventListener('online', run); document.removeEventListener('visibilitychange', run); };
  }, []);
}
