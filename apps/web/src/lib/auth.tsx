import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, get, post, setUnauthorizedHandler } from './api';
import type { Me } from './types';
import { can, type Permission } from './permissions';

type AuthCtx = {
  me: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  can: (p: Permission) => boolean;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const meQ = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await get<Me>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.setQueryData(['me'], null);
    });
  }, [qc]);

  const login = useCallback(
    async (email: string, password: string) => {
      const r = await post<{ user: Me }>('/auth/login', { email, password });
      // garante dados completos (organization/workspace)
      let me = r.user;
      try {
        me = await get<Me>('/auth/me');
      } catch {
        /* usa o retorno do login */
      }
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      qc.setQueryData(['me'], me);
      return me;
    },
    [qc],
  );

  const logout = useCallback(async () => {
    try {
      await post('/auth/logout');
    } finally {
      qc.setQueryData(['me'], null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    }
  }, [qc]);

  const value = useMemo<AuthCtx>(
    () => ({
      me: meQ.data ?? null,
      loading: meQ.isLoading,
      login,
      logout,
      can: (p) => can(meQ.data?.role, p),
    }),
    [meQ.data, meQ.isLoading, login, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth fora do AuthProvider');
  return c;
}
