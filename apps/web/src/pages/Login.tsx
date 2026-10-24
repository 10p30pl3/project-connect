import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LoginSchema } from '@voll/shared';
import type { z } from 'zod';
import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { applyFieldErrors, errorMessage } from '../lib/api';
import { Alert, BrandLogo, Button, Field, Input } from '../components/ui';

type F = z.infer<typeof LoginSchema>;

export function LoginPage() {
  const { me, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from ?? '/';
  const [err, setErr] = useState<string | null>(null);
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

  return (
    <div className="grid min-h-full place-items-center bg-gradient-to-b from-brand-50 to-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center">
          <BrandLogo size="lg" showTagline />
        </div>
        <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm" aria-labelledby="login-title">
          <h1 id="login-title" className="text-lg font-semibold">
            Entrar
          </h1>
          {err && <Alert tone="error">{err}</Alert>}
          <Field label="E-mail" required error={form.formState.errors.email?.message}>
            {(p) => (
              <Input
                id={p.id}
                type="email"
                autoComplete="username"
                autoFocus
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
                aria-describedby={p.describedBy}
                aria-invalid={p.invalid}
                {...form.register('password')}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" className="w-full" loading={form.formState.isSubmitting}>
            Entrar
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-slate-500">MVP · ambiente de demonstração com conector simulado</p>
      </div>
    </div>
  );
}
