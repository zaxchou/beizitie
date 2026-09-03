// ===== 用户认证状态管理（Zustand + persist 中间件 → localStorage） =====

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, AuthConfig } from '@/types';

const API_BASE = '';

interface AuthStore {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
  authConfig: AuthConfig | null;
  fetchConfig: () => Promise<void>;
  login: (username: string, password: string, rememberMe?: boolean) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  loginFromGuest: (res: { token: string; user: User }) => void;
  logout: () => void;
  clearError: () => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isLoading: false,
      error: null,
      authConfig: null,

      fetchConfig: async () => {
        try {
          const res = await fetch(`${API_BASE}/api/auth/config`);
          const data = await res.json();
          set({ authConfig: data });
        } catch {
          // 静默失败，不影响登录流程
        }
      },

      login: async (username: string, password: string, rememberMe = false) => {
        set({ isLoading: true, error: null });
        try {
          const res = await fetch(`${API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, rememberMe }),
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || '登录失败');
          }
          set({ user: data.user, token: data.token, isLoading: false });
        } catch (err) {
          const msg = err instanceof Error ? err.message : '登录失败';
          set({ error: msg, isLoading: false });
          throw err;
        }
      },

      register: async (username: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          const res = await fetch(`${API_BASE}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || '注册失败');
          }
          set({ user: data.user, token: data.token, isLoading: false });
        } catch (err) {
          const msg = err instanceof Error ? err.message : '注册失败';
          set({ error: msg, isLoading: false });
          throw err;
        }
      },

      loginFromGuest: (res: { token: string; user: User }) => {
        set({ user: res.user, token: res.token, isLoading: false, error: null });
      },

      logout: () => {
        set({ user: null, token: null, error: null });
      },

      clearError: () => {
        set({ error: null });
      },
    }),
    {
      name: '背字帖-auth',
      partialize: (state) => ({ user: state.user, token: state.token }),
    }
  )
);
