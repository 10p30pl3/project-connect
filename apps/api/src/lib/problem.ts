import type { FastifyReply } from 'fastify';
import { ZodError, type ZodTypeAny, type output } from 'zod';
import type { ApiProblem } from '@voll/shared';

export class HttpError extends Error {
  constructor(
    public status: number,
    public title: string,
    public detail?: string,
    public fieldErrors?: Record<string, string>,
  ) {
    super(detail ?? title);
  }
}

export const badRequest = (detail: string) => new HttpError(400, 'Requisição inválida', detail);
export const notFound = (what = 'Recurso') => new HttpError(404, 'Não encontrado', `${what} não encontrado`);
export const conflict = (detail: string) => new HttpError(409, 'Conflito', detail);
export const forbidden = (detail = 'Seu perfil não tem permissão para esta ação') =>
  new HttpError(403, 'Acesso negado', detail);
export const unprocessable = (detail: string, fieldErrors?: Record<string, string>) =>
  new HttpError(422, 'Validação falhou', detail, fieldErrors);

export function zodToFieldErrors(e: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of e.issues) {
    const k = i.path.join('.') || '_';
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): output<S> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw unprocessable('Corrija os campos indicados', zodToFieldErrors(r.error));
  return r.data;
}

export function sendProblem(reply: FastifyReply, p: ApiProblem) {
  return reply.code(p.status).type('application/problem+json').send(p);
}

export function toProblem(err: unknown): ApiProblem {
  if (err instanceof HttpError) {
    return {
      type: `https://voll.connect/problems/${err.status}`,
      title: err.title,
      status: err.status,
      detail: err.detail,
      fieldErrors: err.fieldErrors,
    };
  }
  if (err instanceof ZodError) {
    return {
      type: 'https://voll.connect/problems/422',
      title: 'Validação falhou',
      status: 422,
      detail: 'Corrija os campos indicados',
      fieldErrors: zodToFieldErrors(err),
    };
  }
  const anyErr = err as any;
  if (anyErr?.statusCode && anyErr.statusCode < 500) {
    return {
      type: `https://voll.connect/problems/${anyErr.statusCode}`,
      title: anyErr.statusCode === 429 ? 'Muitas requisições' : 'Requisição inválida',
      status: anyErr.statusCode,
      detail: anyErr.message,
    };
  }
  if (anyErr?.code === '23505') {
    return { type: 'https://voll.connect/problems/409', title: 'Conflito', status: 409, detail: 'Registro duplicado' };
  }
  return { type: 'https://voll.connect/problems/500', title: 'Erro interno', status: 500 };
}
