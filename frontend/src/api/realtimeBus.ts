/* ==========================================================================
   Real-Time Cross-Tab & In-Tab Ledger Synchronization Bus
   - Propagates write mutations across browser tabs via BroadcastChannel
   - Notifies mounted views in the current tab immediately after mutations
   - Tracks last live synchronization timestamp for workspace header telemetry
   ========================================================================== */

export interface RealtimeMutationEvent {
  method: string;
  path: string;
  timestamp: string;
  source: 'live' | 'mock-fallback' | 'manual';
}

type RealtimeListener = (event: RealtimeMutationEvent) => void;

const CHANNEL_NAME = 'brightloop_realtime_sync_v1';
const listeners = new Set<RealtimeListener>();
let lastSyncTimestamp: string = new Date().toISOString();
let broadcastChannel: BroadcastChannel | null = null;

function ensureChannel(): BroadcastChannel | null {
  if (broadcastChannel) return broadcastChannel;
  if (typeof BroadcastChannel === 'undefined') return null;
  try {
    broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
    broadcastChannel.onmessage = (msg: MessageEvent<RealtimeMutationEvent>) => {
      if (msg?.data?.timestamp) {
        lastSyncTimestamp = msg.data.timestamp;
        listeners.forEach((listener) => listener(msg.data));
      }
    };
    return broadcastChannel;
  } catch {
    return null;
  }
}

export function markSyncedNow(): void {
  lastSyncTimestamp = new Date().toISOString();
}

export function getLastSyncTimestamp(): string {
  return lastSyncTimestamp;
}

export function emitDataMutation(
  method: string,
  path: string,
  source: 'live' | 'mock-fallback' | 'manual'
): void {
  const event: RealtimeMutationEvent = {
    method: method.toUpperCase(),
    path,
    timestamp: new Date().toISOString(),
    source,
  };
  lastSyncTimestamp = event.timestamp;
  listeners.forEach((listener) => listener(event));

  const ch = ensureChannel();
  if (ch) {
    try {
      ch.postMessage(event);
    } catch {
      // Ignore channel serialization errors in restricted environments
    }
  }
}

export function emitManualRefresh(): void {
  emitDataMutation('REFRESH', '*', 'manual');
}

export function subscribeRealtimeSync(listener: RealtimeListener): () => void {
  ensureChannel();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

