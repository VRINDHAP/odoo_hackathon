import React, { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { apiRequest, tryRefreshAccessToken } from '../api/client';
import { tokenStore } from '../api/tokenStore';
import type { AuthResponse, AuthUser } from '../types/domain';

interface SignupInput {
  name: string;
  email: string;
  company_name?: string;
  password: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isHydrating: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isStaff: boolean;
  isCustomer: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  signup: (input: SignupInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const user = useSyncExternalStore(tokenStore.subscribe, tokenStore.getUser, tokenStore.getUser);
  const [isHydrating, setIsHydrating] = useState<boolean>(() => tokenStore.getUser() === null);

  useEffect(() => {
    let active = true;
    if (tokenStore.getUser() === null) {
      tryRefreshAccessToken().finally(() => {
        if (active) setIsHydrating(false);
      });
    } else {
      setIsHydrating(false);
    }
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<AuthUser> => {
    const res = await apiRequest<AuthResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
      skipAuthRefresh: true,
    });
    tokenStore.setSession(res.access_token, res.user);
    return res.user;
  }, []);

  const signup = useCallback(async (input: SignupInput): Promise<AuthUser> => {
    const res = await apiRequest<AuthResponse>('/auth/signup', {
      method: 'POST',
      body: input,
      skipAuthRefresh: true,
    });
    tokenStore.setSession(res.access_token, res.user);
    return res.user;
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await apiRequest<void>('/auth/logout', { method: 'POST', skipAuthRefresh: true });
    } catch {
      // Ignore logout network failures and clear client memory state
    } finally {
      tokenStore.clearSession();
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isHydrating,
        isAuthenticated: Boolean(user),
        isAdmin: user?.role === 'admin',
        isStaff: user?.role === 'staff',
        isCustomer: user?.role === 'customer',
        login,
        signup,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

