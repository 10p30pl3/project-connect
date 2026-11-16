import { createContext, useContext, useState, type ReactNode } from 'react';

export type ExperienceMode = 'basic' | 'advanced';

export const EXPERIENCE_MODE_META: Record<
  ExperienceMode,
  { label: string; shortLabel: string; description: string; order: number }
> = {
  basic: {
    label: 'Básico',
    shortLabel: 'Básico',
    description: 'Essencial do dia a dia: visão geral, campanhas, contatos, mailings, calendários, canais, agentes de voz, telefonia e consumo de tempo.',
    order: 0,
  },
  advanced: {
    label: 'Avançado',
    shortLabel: 'Avançado',
    description: 'Operação completa: inclui modelos, inteligência, listas, jornadas, estratégias, tabulação, relatórios e governança.',
    order: 1,
  },
};

export const EXPERIENCE_MODE_TOOLTIP =
  'Básico exibe os fluxos essenciais do dia a dia. Avançado libera listas, jornadas, estratégias, tabulação, relatórios e governança.';

const STORAGE_KEY = 'voll-experience-mode';

function readStoredMode(): ExperienceMode {
  if (typeof window === 'undefined') return 'basic';
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'advanced') return 'advanced';
  } catch {
    // ignore storage errors
  }
  return 'basic';
}

type Ctx = {
  mode: ExperienceMode;
  setMode: (mode: ExperienceMode) => void;
  isAtLeast: (minMode: ExperienceMode) => boolean;
};

const ExperienceModeContext = createContext<Ctx>({
  mode: 'basic',
  setMode: () => {},
  isAtLeast: () => false,
});

export function ExperienceModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ExperienceMode>(readStoredMode);

  const setMode = (next: ExperienceMode) => {
    setModeState(next);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore
      }
    }
  };

  const isAtLeast = (minMode: ExperienceMode) =>
    EXPERIENCE_MODE_META[mode].order >= EXPERIENCE_MODE_META[minMode].order;

  return (
    <ExperienceModeContext.Provider value={{ mode, setMode, isAtLeast }}>
      {children}
    </ExperienceModeContext.Provider>
  );
}

export function useExperienceMode() {
  return useContext(ExperienceModeContext);
}
