/* ==========================================================================
   API Client with Bearer Injection, 401 Silent Refresh & Mock Fallback
   (SPEC.md §3, §8, §9 | INTERFACES.md §1, §2)
   ========================================================================== */

import type { ApiErrorPayload, AuthResponse, FieldValidationError } from '../types/domain';
import { generateIdempotencyKey } from '../utils/idempotency';
import { handleMockRequest } from './mockEngine';
import { tokenStore } from './tokenStore';

const API_BASE = '/api/v1';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: FieldValidationError[];

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = payload.code;
    this.fields = payload.fields ?? [];
  }

  toFieldMap(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const f of this.fields) {
      if (f.field && !map[f.field]) {
        map[f.field] = f.message;
      }
    }
    return map;
  }
}

let activeRefreshPromise: Promise<boolean> | null = null;
let dataSourceMode: 'live' | 'mock-fallback' = 'mock-fallback';

export function getApiDataSourceMode(): 'live' | 'mock-fallback' {
  return dataSourceMode;
}

function requiresIdempotencyKey(method: string, path: string): boolean {
  if (method.toUpperCase() !== 'POST') return false;
  return (
    /^\/invoices\/[^/]+\/payments$/.test(path) ||
    path === '/invoices' ||
    path === '/billing/run' ||
    /^\/me\/invoices\/[^/]+\/pay$/.test(path)
  );
}

async function tryRefreshAccessToken(): Promise<boolean> {
  if (activeRefreshPromise) return activeRefreshPromise;

  activeRefreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.ok) {
        const data = (await res.json()) as AuthResponse;
        tokenStore.setSession(data.access_token, data.user);
        dataSourceMode = 'live';
        return true;
      }

      if (res.status === 404 || res.status === 502 || res.status === 503 || res.status === 504) {
        const mockRes = await handleMockRequest('POST', '/auth/refresh');
        if (mockRes.status === 200 && mockRes.data) {
          const data = mockRes.data as AuthResponse;
          tokenStore.setSession(data.access_token, data.user);
          dataSourceMode = 'mock-fallback';
          return true;
        }
      }
    } catch {
      const mockRes = await handleMockRequest('POST', '/auth/refresh');
      if (mockRes.status === 200 && mockRes.data) {
        const data = mockRes.data as AuthResponse;
        tokenStore.setSession(data.access_token, data.user);
        dataSourceMode = 'mock-fallback';
        return true;
      }
    } finally {
      activeRefreshPromise = null;
    }

    tokenStore.clearSession();
    return false;
  })();

  return activeRefreshPromise;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  skipAuthRefresh?: boolean;
  responseType?: 'json' | 'blob';
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const cleanEndpointPath = normalizedPath.split('?')[0];

  const headers: Record<string, string> = {
    ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...options.headers,
  };

  const token = tokenStore.getAccessToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (requiresIdempotencyKey(method, cleanEndpointPath) && !headers['Idempotency-Key']) {
    headers['Idempotency-Key'] = generateIdempotencyKey();
  }

  // Attempt live /api/v1 backend first; gracefully fall back to stateful OpenAPI mock engine if unmounted/offline
  let fallbackToMock = false;

  try {
    const response = await fetch(`${API_BASE}${normalizedPath}`, {
      method,
      headers,
      credentials: 'include',
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    if (response.status === 404 || response.status === 502 || response.status === 503 || response.status === 504) {
      // Check if it's an unmounted FastAPI route (FastAPI default 404 returns {"detail":"Not Found"} without our ErrorResponse `code` field)
      const clone = response.clone();
      const maybeJson = await clone.json().catch(() => null);
      if (!maybeJson || typeof maybeJson !== 'object' || !('code' in maybeJson)) {
        fallbackToMock = true;
      }
    }

    if (!fallbackToMock) {
      dataSourceMode = 'live';

      if (
        response.status === 401 &&
        !options.skipAuthRefresh &&
        cleanEndpointPath !== '/auth/login' &&
        cleanEndpointPath !== '/auth/refresh'
      ) {
        const refreshed = await tryRefreshAccessToken();
        if (refreshed) {
          return apiRequest<T>(path, { ...options, skipAuthRefresh: true });
        }
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
          window.location.assign('/login');
        }
      }

      if (!response.ok) {
        const errBody = (await response.json().catch(() => null)) as Partial<ApiErrorPayload> | null;
        throw new ApiClientError(response.status, {
          code: errBody?.code ?? `HTTP_${response.status}`,
          message: errBody?.message ?? response.statusText ?? 'Request failed',
          fields: errBody?.fields ?? [],
        });
      }

      if (response.status === 204) {
        return undefined as T;
      }

      if (options.responseType === 'blob') {
        return (await response.blob()) as unknown as T;
      }

      return (await response.json()) as T;
    }
  } catch (error) {
    if (error instanceof ApiClientError) {
      throw error;
    }
    fallbackToMock = true;
  }

  // Stateful OpenAPI 3.0 Mock Engine Execution
  dataSourceMode = 'mock-fallback';
  const mockResult = await handleMockRequest(method, normalizedPath, options.body, headers);

  if (mockResult.status >= 400) {
    throw new ApiClientError(
      mockResult.status,
      (mockResult.data as ApiErrorPayload) ?? {
        code: `HTTP_${mockResult.status}`,
        message: 'Mock API error',
        fields: [],
      }
    );
  }

  if (options.responseType === 'blob' && mockResult.blob) {
    return mockResult.blob as unknown as T;
  }

  return mockResult.data as T;
}

export { tryRefreshAccessToken };

