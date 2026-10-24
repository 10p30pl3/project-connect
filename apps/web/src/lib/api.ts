import type { ApiProblem } from '@voll/shared';
import type { FieldValues, Path, UseFormSetError, UseFormSetFocus } from 'react-hook-form';

export const API_BASE = '/api';

export class ApiError extends Error {
  status: number;
  problem: ApiProblem;
  constructor(problem: ApiProblem) {
    super(problem.detail || problem.title);
    this.status = problem.status;
    this.problem = problem;
  }
  get fieldErrors(): Record<string, string> {
    return this.problem.fieldErrors ?? {};
  }
}

type Opts = { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal };

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

const DEMO_ROLE_KEY = 'vc_demo_role';
/** Modo mockup: perfil simulado enviado em X-Demo-Role (a API ignora quando o login está ativo). */
export function getDemoRole(): string | null {
  try {
    return localStorage.getItem(DEMO_ROLE_KEY);
  } catch {
    return null;
  }
}
export function setDemoRole(role: string) {
  try {
    localStorage.setItem(DEMO_ROLE_KEY, role);
  } catch {
    /* sem storage: fica no padrão (Administrador) */
  }
}

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  const demoRole = getDemoRole();
  if (demoRole) headers['X-Demo-Role'] = demoRole;
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body,
      credentials: 'include',
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError({ type: 'network', title: 'Sem conexão com o servidor', status: 0, detail: 'Verifique sua conexão e tente novamente.' });
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const problem: ApiProblem =
      data && typeof data === 'object' && 'title' in data
        ? (data as ApiProblem)
        : { type: 'about:blank', title: defaultTitle(res.status), status: res.status, detail: typeof data === 'string' ? data.slice(0, 300) : undefined };
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.();
    throw new ApiError(problem);
  }
  return data as T;
}

function defaultTitle(status: number) {
  if (status === 401) return 'Sessão expirada';
  if (status === 403) return 'Seu perfil não tem permissão para esta ação';
  if (status === 404) return 'Não encontrado';
  if (status === 409) return 'Conflito: os dados mudaram desde a última leitura';
  if (status === 422) return 'Verifique os campos destacados';
  return 'Erro inesperado';
}

export const get = <T,>(path: string, signal?: AbortSignal) => api<T>(path, { signal });
export const post = <T,>(path: string, body?: unknown, headers?: Record<string, string>) =>
  api<T>(path, { method: 'POST', body: body ?? {}, headers });
export const put = <T,>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const patch = <T,>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const del = <T,>(path: string) => api<T>(path, { method: 'DELETE' });

export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
}

/**
 * Aplica erros por campo do servidor no formulário (§26.2): mensagem junto ao campo e foco no primeiro inválido.
 * Retorna true se algum erro foi mapeado para um campo conhecido.
 */
export function applyFieldErrors<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  opts: { setFocus?: UseFormSetFocus<T>; prefix?: string; known?: string[] } = {},
): boolean {
  if (!(err instanceof ApiError)) return false;
  const entries = Object.entries(err.fieldErrors);
  let first: string | null = null;
  for (const [k, msg] of entries) {
    const key = opts.prefix && k.startsWith(opts.prefix) ? k.slice(opts.prefix.length) : k;
    if (opts.known && !opts.known.some((p) => key === p || key.startsWith(p + '.'))) continue;
    setError(key as Path<T>, { type: 'server', message: msg });
    first ??= key;
  }
  if (first && opts.setFocus) {
    try {
      opts.setFocus(first as Path<T>);
    } catch {
      /* campo sem ref */
    }
  }
  return first !== null;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const fe = Object.values(err.fieldErrors);
    return err.problem.detail || (fe.length ? `${err.problem.title}: ${fe[0]}` : err.problem.title);
  }
  if (err instanceof Error) return err.message;
  return 'Erro inesperado';
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
