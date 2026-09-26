'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ConnectivityState {
  online: boolean;
  checking: boolean;
  /** Manually re-probe: `navigator.onLine` plus an API heartbeat. */
  retry: () => void;
}

/**
 * Connectivity is `navigator.onLine` AND a heartbeat probe. The workbench is the
 * one page where offline must never lose a draft, so this is intentional.
 */
export function useConnectivity(heartbeat?: () => Promise<boolean>): ConnectivityState {
  const [online, setOnline] = useState(true);
  const [checking, setChecking] = useState(false);
  const heartbeatRef = useRef(heartbeat);

  useEffect(() => {
    heartbeatRef.current = heartbeat;
  }, [heartbeat]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setOnline(window.navigator.onLine);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const retry = useCallback(() => {
    if (typeof window === 'undefined') return;
    setChecking(true);
    const probe = heartbeatRef.current;
    const navigatorOnline = window.navigator.onLine;
    if (!probe) {
      setOnline(navigatorOnline);
      setChecking(false);
      return;
    }
    probe()
      .then((ok) => setOnline(navigatorOnline && ok))
      .catch(() => setOnline(false))
      .finally(() => setChecking(false));
  }, []);

  return { online, checking, retry };
}
