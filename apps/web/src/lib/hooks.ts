import { useEffect, useState } from 'react';

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Paginação por cursor: mantém pilha de cursores para Anterior/Próxima. */
export function useCursorPager() {
  const [stack, setStack] = useState<(string | null)[]>([null]);
  const cursor = stack[stack.length - 1];
  return {
    cursor,
    page: stack.length,
    next: (c: string | null) => c && setStack((s) => [...s, c]),
    prev: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    reset: () => setStack([null]),
  };
}
