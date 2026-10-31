import { useEffect, useRef } from 'react';
import { subscribeRealtimeSync, type RealtimeMutationEvent } from '../api/realtimeBus';

interface RealtimeSyncOptions {
  /** Optional background polling interval in milliseconds (0 disables timer polling) */
  pollIntervalMs?: number;
  /** Optional predicate to filter relevant mutation paths */
  shouldRefresh?: (event: RealtimeMutationEvent) => boolean;
  /** Refresh automatically when tab regains visibility */
  refreshOnFocus?: boolean;
}

/**
 * Subscribes a view to real-time cross-tab mutations, manual refresh triggers,
 * tab focus revalidation, and optional background polling.
 */
export function useRealtimeSync(
  onRefresh: () => void | Promise<void>,
  options: RealtimeSyncOptions = {}
): void {
  const { pollIntervalMs = 0, shouldRefresh, refreshOnFocus = true } = options;
  const callbackRef = useRef(onRefresh);
  const filterRef = useRef(shouldRefresh);

  useEffect(() => {
    callbackRef.current = onRefresh;
    filterRef.current = shouldRefresh;
  }, [onRefresh, shouldRefresh]);

  useEffect(() => {
    const unsubscribe = subscribeRealtimeSync((event) => {
      if (filterRef.current && event.path !== '*' && !filterRef.current(event)) {
        return;
      }
      void callbackRef.current();
    });

    const handleVisibility = () => {
      if (refreshOnFocus && typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void callbackRef.current();
      }
    };

    if (refreshOnFocus && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }

    let timer: ReturnType<typeof setInterval> | null = null;
    if (pollIntervalMs > 0) {
      timer = setInterval(() => {
        if (typeof document === 'undefined' || document.visibilityState === 'visible') {
          void callbackRef.current();
        }
      }, pollIntervalMs);
    }

    return () => {
      unsubscribe();
      if (refreshOnFocus && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [pollIntervalMs, refreshOnFocus]);
}

