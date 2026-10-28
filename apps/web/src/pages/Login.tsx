import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LoginSchema } from '@voll/shared';
import type { z } from 'zod';
import { useState } from 'react';
import { ArrowRight, Crown, KeyRound, ShieldCheck, UserCheck } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { applyFieldErrors, errorMessage } from '../lib/api';
import { Alert, Badge, BrandLogo, Button, Field, Input } from '../components/ui';

type F = z.infer<typeof LoginSchema>;

const DEMO_PROFILES = [
  {
    role: 'ADMIN',
    title: 'Administrador',
    email: 'admin@voll.local',
    password: 'Voll@2026',
    badge: 'Acesso Total',
    badgeTone: 'brand' as const,
    description: 'Governança, templates de estratégias, limites, jornadas, canais e usuários.',
    icon: <Crown className="size-4 text-brand-700" />,
    bgClass: 'hover:border-brand-300 hover:bg-brand-50/40 bg-brand-50/20 border-brand-200',
  },
  {
    role: 'SUPERVISOR',
    title: 'Supervisor',
    email: 'supervisor@voll.local',
    password: 'Voll@2026',
    badge: 'Operação & Reconciliação',
    badgeTone: 'blue' as const,
    description: 'Operação de campanhas, reconciliação de tentativas pendentes e bloqueios.',
    icon: <ShieldCheck className="size-4 text-blue-600" />,
    bgClass: 'hover:border-blue-300 hover:bg-blue-50/40 bg-blue-50/20 border-blue-200',
  },
];

export function LoginPage() {
  const { me, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from ?? '/';
  const [err, setErr] = useState<string | null>(null);
  const [quickLogging, setQuickLogging] = useState<string | null>(null);

  const form = useForm<F>({ resolver: zodResolver(LoginSchema), defaultValues: { email: '', password: '' } });

  if (me) return <Navigate to={from} replace />;

  const onSubmit = form.handleSubmit(async (v) => {
    setErr(null);
    try {
      await login(v.email, v.password);
      nav(from, { replace: true });
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, { setFocus: form.setFocus })) setErr(errorMessage(e));
    }
  });

  const handleQuickLogin = async (email: string, pass: string) => {
    form.setValue('email', email);
    form.setValue('password', pass);
    setErr(null);
    setQuickLogging(email);
    try {
      await login(email, pass);
      nav(from, { replace: true });
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setQuickLogging(null);
    }
  };

  return (
    <div className="grid min-h-full place-items-center bg-gradient-to-b from-brand-50 to-slate-50 px-4 py-10">
      <div className="w-full max-w-md space-y-5">
        <div className="flex items-center justify-center">
          <BrandLogo size="lg" showTagline />
        </div>

        {/* Card de Acesso Rápido com 1 Clique para Administrador e Supervisor */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3.5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Acesso Rápido de Demonstração
            </h2>
            <span className="text-[11px] text-slate-400">Clique para entrar direto</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {DEMO_PROFILES.map((p) => {
              const isLogging = quickLogging === p.email;
              return (
                <button
                  key={p.role}
                  type="button"
                  onClick={() => handleQuickLogin(p.email, p.password)}
                  disabled={!!quickLogging}
                  className={`group flex flex-col justify-between rounded-xl border p-3 text-left transition shadow-2xs ${p.bgClass}`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-bold text-sm text-slate-900">
                        {p.icon}
                        <span>{p.title}</span>
                      </div>
                      <Badge tone={p.badgeTone}>{p.badge}</Badge>
                    </div>
                    <div className="font-mono text-[11px] text-slate-500 truncate" title={p.email}>
                      {p.email}
                    </div>
                    <p className="text-[11px] text-slate-600 leading-snug line-clamp-2">
                      {p.description}
                    </p>
                  </div>

                  <div className="mt-3 flex items-center justify-between pt-2 border-t border-slate-200/60 text-xs font-semibold text-brand-700 group-hover:text-brand-800">
                    <span>{isLogging ? 'Autenticando...' : 'Entrar como ' + p.title}</span>
                    <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Formulário Manual */}
        <form
          onSubmit={onSubmit}
          noValidate
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
          aria-labelledby="login-title"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h1 id="login-title" className="text-sm font-semibold text-slate-800">
              Ou entre com suas credenciais
            </h1>
            <KeyRound className="size-4 text-slate-400" />
          </div>

          {err && <Alert tone="error">{err}</Alert>}

          <Field label="E-mail" required error={form.formState.errors.email?.message}>
            {(p) => (
              <Input
                id={p.id}
                type="email"
                autoComplete="username"
                placeholder="ex: admin@voll.local ou supervisor@voll.local"
                aria-describedby={p.describedBy}
                aria-invalid={p.invalid}
                {...form.register('email')}
              />
            )}
          </Field>

          <Field label="Senha" required error={form.formState.errors.password?.message}>
            {(p) => (
              <Input
                id={p.id}
                type="password"
                autoComplete="current-password"
                placeholder="Senha de acesso"
                aria-describedby={p.describedBy}
                aria-invalid={p.invalid}
                {...form.register('password')}
              />
            )}
          </Field>

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            loading={form.formState.isSubmitting || !!quickLogging}
          >
            Entrar
          </Button>

          <div className="rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-[11px] text-slate-500 leading-snug">
            💡 <strong>Credenciais do Ambiente:</strong> Senha padrão <code>Voll@2026</code> para todos os usuários cadastrados (Administrador, Supervisor, Gestor, Operador e Analista).
          </div>
        </form>

        <p className="text-center text-xs text-slate-400">
          Voll Solutions · Plataforma de Gestão de Contatos e Automação de Campanhas
        </p>
      </div>
    </div>
  );
}
