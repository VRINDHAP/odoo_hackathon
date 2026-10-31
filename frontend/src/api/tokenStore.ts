/* ==========================================================================
   In-Memory Secure JWT Token Store (SPEC.md §9, DONE.md §5)
   - Never writes raw JWT access tokens or passwords to localStorage or console
   - Session pointer cookie/sessionStorage holds only non-sensitive user id for
     mock-mode silent /auth/refresh simulation when backend cookie is offline
   ========================================================================== */

import type { AuthUser } from '../types/domain';

type AuthListener = () => void;

let memoryAccessToken: string | null = null;
let memoryUser: AuthUser | null = null;
const listeners = new Set<AuthListener>();

const MOCK_REFRESH_UID_KEY = 'brightloop_refresh_uid';

function notify(): void {
  listeners.forEach((fn) => fn());
}

export const tokenStore = {
  getAccessToken(): string | null {
    return memoryAccessToken;
  },

  getUser(): AuthUser | null {
    return memoryUser;
  },

  setSession(accessToken: string, user: AuthUser): void {
    memoryAccessToken = accessToken;
    memoryUser = user;
    try {
      sessionStorage.setItem(MOCK_REFRESH_UID_KEY, user.id);
    } catch {
      // Ignore storage quota/sandbox issues
    }
    notify();
  },

  updateUser(user: AuthUser): void {
    memoryUser = user;
    notify();
  },

  clearSession(): void {
    memoryAccessToken = null;
    memoryUser = null;
    try {
      sessionStorage.removeItem(MOCK_REFRESH_UID_KEY);
    } catch {
      // Ignore storage errors
    }
    notify();
  },

  getRefreshHintUserId(): string | null {
    try {
      return sessionStorage.getItem(MOCK_REFRESH_UID_KEY);
    } catch {
      return null;
    }
  },

  subscribe(listener: AuthListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

