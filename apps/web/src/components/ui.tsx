import * as Dialog from '@radix-ui/react-dialog';
import * as RTabs from '@radix-ui/react-tabs';
import * as RTooltip from '@radix-ui/react-tooltip';
import clsx from 'clsx';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  CircleDot,
  Clock,
  HelpCircle,
  Info,
  LayoutGrid,
  List,
  Loader2,
  Pause,
  PlayCircle,
  Square,
  X,
  XCircle,
} from 'lucide-react';
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ATTEMPT_STATE_LABEL, CAMPAIGN_STATUS_LABEL, type AttemptState, type CampaignStatus } from '@voll/shared';
import { errorMessage } from '../lib/api';

// ------------------------------------------------------------------ Brand Logo
export function BrandLogo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg'; showTagline?: boolean }) {
  const logoH = size === 'lg' ? 'h-7' : size === 'sm' ? 'h-4.5' : 'h-5.5';
  const textCls = size === 'lg' ? 'text-lg' : size === 'sm' ? 'text-xs' : 'text-sm';
  return (
    <div className="inline-flex items-center gap-2 select-none">
      <img
        src="/voll-logo.svg"
        alt="Voll Solutions"
        className={clsx('w-auto object-contain', logoH)}
      />
      <div className="flex items-center gap-1.5 border-l border-slate-200 pl-2">
        <span className={clsx('font-bold tracking-tight text-slate-800', textCls)}>
          Connect
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Button
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode };
export function btnClass(variant: Variant = 'secondary', size: 'sm' | 'md' = 'md', className?: string) {
  return clsx(
    'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3.5 text-sm',
    variant === 'primary' && 'bg-brand-700 text-white hover:bg-brand-800 shadow-sm',
    variant === 'secondary' && 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 shadow-sm',
    variant === 'ghost' && 'text-slate-700 hover:bg-slate-100',
    variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
    variant === 'link' && 'h-auto px-0 text-brand-700 underline-offset-2 hover:underline',
    className,
  );
}
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={btnClass(variant, size, className)}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

// ------------------------------------------------------------------ Tooltips Globais
export function Tooltip({
  content,
  children,
  side = 'top',
  className,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
}) {
  return (
    <RTooltip.Provider delayDuration={150}>
      <RTooltip.Root>
        <RTooltip.Trigger asChild>
          <span className={clsx('inline-flex items-center cursor-help', className)}>{children}</span>
        </RTooltip.Trigger>
        <RTooltip.Portal>
          <RTooltip.Content
            side={side}
            sideOffset={5}
            className="z-50 max-w-xs rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white shadow-xl animate-in fade-in-0 zoom-in-95 leading-relaxed border border-slate-800 font-normal"
          >
            {content}
            <RTooltip.Arrow className="fill-slate-900" />
          </RTooltip.Content>
        </RTooltip.Portal>
      </RTooltip.Root>
    </RTooltip.Provider>
  );
}

export function InfoTooltip({
  content,
  side = 'top',
  className,
}: {
  content: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
}) {
  if (!content) return null;
  return (
    <Tooltip content={content} side={side}>
      <span
        role="button"
        tabIndex={-1}
        className={clsx(
          'inline-flex items-center justify-center size-4 rounded-full text-slate-400 hover:text-slate-600 transition-colors cursor-help',
          className,
        )}
        aria-label="Ajuda / Informações"
      >
        <HelpCircle className="size-3.5 shrink-0" aria-hidden />
      </span>
    </Tooltip>
  );
}

// ------------------------------------------------------------------ Layout bits
export function PageHeader({
  title,
  subtitle,
  tooltip,
  actions,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  tooltip?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {back}
        <div className="flex items-center gap-1.5">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">{title}</h1>
          {tooltip && <InfoTooltip content={tooltip} />}
        </div>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  tooltip,
  actions,
  children,
  className,
  padded = true,
}: {
  title?: ReactNode;
  tooltip?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={clsx('rounded-xl border border-slate-200/90 bg-white shadow-xs', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          {title && (
            <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
              {typeof title === 'string' ? <h2>{title}</h2> : title}
              {tooltip && <InfoTooltip content={tooltip} />}
            </div>
          )}
          {actions}
        </header>
      )}
      <div className={clsx(padded && 'p-4')}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tooltip,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tooltip?: ReactNode;
  tone?: 'warn' | 'bad' | 'good';
}) {
  return (
    <div className="rounded-xl border border-slate-200/90 bg-white px-4 py-3 shadow-xs transition-colors hover:border-slate-300/80">
      <div className="flex items-center gap-1 text-xs font-medium text-slate-500">
        <span>{label}</span>
        {tooltip && <InfoTooltip content={tooltip} />}
      </div>
      <div
        className={clsx(
          'tabular mt-1 text-2xl font-semibold tracking-tight text-slate-900',
          tone === 'warn' && 'text-amber-700',
          tone === 'bad' && 'text-red-700',
          tone === 'good' && 'text-emerald-700',
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

/** Mostra valor ou "—" com dica de dado ausente (nunca zero fabricado). */
export function Maybe({ value, hint = 'Sem dados suficientes' }: { value: ReactNode | null | undefined; hint?: string }) {
  if (value === null || value === undefined || value === '—')
    return (
      <span title={hint} className="text-slate-400">
        —<span className="sr-only"> ({hint})</span>
      </span>
    );
  return <>{value}</>;
}

// ------------------------------------------------------------------ Badges
type Tone = 'gray' | 'brand' | 'green' | 'amber' | 'red' | 'blue';
export function Badge({ tone = 'gray', icon, children, className }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        tone === 'gray' && 'bg-slate-50 text-slate-700 ring-slate-200',
        tone === 'brand' && 'bg-brand-50 text-brand-800 ring-brand-200',
        tone === 'green' && 'bg-emerald-50 text-emerald-800 ring-emerald-200',
        tone === 'amber' && 'bg-amber-50 text-amber-800 ring-amber-200',
        tone === 'red' && 'bg-red-50 text-red-800 ring-red-200',
        tone === 'blue' && 'bg-sky-50 text-sky-800 ring-sky-200',
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

const ic = 'size-3.5';
export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const map: Record<CampaignStatus, [Tone, ReactNode]> = {
    READY: ['gray', <CircleDashed className={ic} aria-hidden />],
    SCHEDULED: ['blue', <Clock className={ic} aria-hidden />],
    RUNNING: ['green', <PlayCircle className={ic} aria-hidden />],
    PAUSED: ['amber', <Pause className={ic} aria-hidden />],
    CLOSED: ['red', <Square className={ic} aria-hidden />],
    COMPLETED: ['brand', <CheckCircle2 className={ic} aria-hidden />],
    ARCHIVED: ['gray', <Square className={ic} aria-hidden />],
  };
  const [tone, icon] = map[status] ?? ['gray', null];
  return (
    <Badge tone={tone} icon={icon}>
      {CAMPAIGN_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

export function AttemptStateBadge({ state, label }: { state: AttemptState; label?: string }) {
  const map: Record<AttemptState, [Tone, ReactNode]> = {
    RESERVED: ['blue', <CircleDot className={ic} aria-hidden />],
    SENT: ['brand', <ChevronRight className={ic} aria-hidden />],
    AWAITING_FEEDBACK: ['brand', <Clock className={ic} aria-hidden />],
    RECONCILIATION: ['amber', <AlertTriangle className={ic} aria-hidden />],
    FINALIZED: ['green', <CheckCircle2 className={ic} aria-hidden />],
    RELEASED: ['gray', <CircleDashed className={ic} aria-hidden />],
    CANCELLED: ['red', <XCircle className={ic} aria-hidden />],
  };
  const [tone, icon] = map[state] ?? ['gray', null];
  return (
    <Badge tone={tone} icon={icon}>
      {label ?? ATTEMPT_STATE_LABEL[state] ?? state}
    </Badge>
  );
}

// ------------------------------------------------------------------ Alerts / states
export function Alert({ tone = 'info', title, children, className }: { tone?: 'info' | 'warn' | 'error' | 'success'; title?: ReactNode; children?: ReactNode; className?: string }) {
  const Icon = tone === 'error' ? AlertCircle : tone === 'warn' ? AlertTriangle : tone === 'success' ? CheckCircle2 : Info;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={clsx(
        'flex gap-2 rounded-md border px-3 py-2 text-sm',
        tone === 'info' && 'border-sky-200 bg-sky-50 text-sky-900',
        tone === 'warn' && 'border-amber-200 bg-amber-50 text-amber-900',
        tone === 'error' && 'border-red-200 bg-red-50 text-red-900',
        tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-900',
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className={clsx(title && 'mt-0.5')}>{children}</div>}
      </div>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Alert tone="error" title="Não foi possível carregar">
      {errorMessage(error)}{' '}
      {onRetry && (
        <Button variant="link" onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </Alert>
  );
}

export function Loading({ label = 'Carregando…', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2 py-2">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-5" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function Empty({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <div className="font-medium text-slate-800">{title}</div>
      {children && <div className="max-w-md text-sm text-slate-600">{children}</div>}
      {action}
    </div>
  );
}

// ------------------------------------------------------------------ Form fields
type FieldProps = {
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  tooltip?: ReactNode;
  required?: boolean;
  className?: string;
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactElement;
};
export function Field({ label, error, hint, tooltip, required, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="flex items-center gap-1.5 text-[13px] font-medium leading-snug text-slate-700">
        <span>{label}</span>
        {required && (
          <span className="text-red-600" aria-hidden>
            *
          </span>
        )}
        {tooltip && <InfoTooltip content={tooltip} />}
      </label>
      <div className="mt-auto">{children({ id, describedBy, invalid: !!error })}</div>
      {hint && !error && (
        <p id={hintId} className="text-xs leading-relaxed text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="flex items-center gap-1 text-xs font-medium text-red-700">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}

const inputCls =
  'h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-xs transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-slate-100 disabled:text-slate-500 aria-[invalid=true]:border-red-500 aria-[invalid=true]:ring-red-100';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={clsx(inputCls, className)} {...p} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={clsx(inputCls, 'h-auto min-h-[80px] py-2 font-mono text-xs', className)} {...p} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return (
    <select ref={ref} className={clsx(inputCls, 'pr-8', className)} {...p}>
      {children}
    </select>
  );
});

export function Checkbox({ label, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={clsx('inline-flex cursor-pointer items-center gap-2 text-sm text-slate-800 select-none', className)}>
      <input type="checkbox" className="size-4 rounded border-slate-300 accent-brand-700" {...p} />
      {label}
    </label>
  );
}

export function RadioCard({
  name,
  value,
  checked,
  onChange,
  title,
  description,
  disabled,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (v: string) => void;
  title: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={clsx(
        'flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors',
        checked ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-slate-200 bg-white hover:border-slate-300',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="mt-0.5 size-4 accent-brand-700"
      />
      <span>
        <span className="block text-sm font-medium text-slate-900">{title}</span>
        {description && <span className="mt-0.5 block text-xs text-slate-600">{description}</span>}
      </span>
    </label>
  );
}

// ------------------------------------------------------------------ Modal (Radix: foco preso, Escape, retorno do foco)
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
  side,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  side?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/45 backdrop-blur-[2px]" />
        <div
          className={clsx(
            'fixed inset-0 z-50 flex',
            side ? 'justify-end' : 'items-center justify-center p-4 sm:p-6',
          )}
        >
          <Dialog.Content
            className={clsx(
              'flex flex-col bg-white shadow-2xl ring-1 ring-slate-900/10 focus:outline-none',
              side
                ? 'h-full max-h-[100dvh] w-full max-w-2xl'
                : clsx('max-h-[90dvh] w-full rounded-xl', wide ? 'max-w-3xl' : 'max-w-lg'),
            )}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
              <div className="min-w-0">
                <Dialog.Title className="text-base font-semibold tracking-tight text-slate-900">{title}</Dialog.Title>
                {description ? (
                  <Dialog.Description className="mt-0.5 text-sm text-slate-600">{description}</Dialog.Description>
                ) : (
                  <Dialog.Description className="sr-only">{typeof title === 'string' ? title : 'Janela'}</Dialog.Description>
                )}
              </div>
              <Dialog.Close asChild>
                <Button variant="ghost" size="sm" aria-label="Fechar">
                  <X className="size-4" aria-hidden />
                </Button>
              </Dialog.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
            {footer && <div className="flex flex-wrap justify-end gap-2.5 border-t border-slate-100 bg-slate-50/50 px-6 py-3.5 rounded-b-xl">{footer}</div>}
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel = 'Confirmar',
  danger,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

// ------------------------------------------------------------------ Tabs
export function Tabs({
  value,
  onValueChange,
  tabs,
}: {
  value: string;
  onValueChange: (v: string) => void;
  tabs: { value: string; label: ReactNode; content: ReactNode }[];
}) {
  return (
    <RTabs.Root value={value} onValueChange={onValueChange}>
      <RTabs.List className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200" aria-label="Seções">
        {tabs.map((t) => (
          <RTabs.Trigger
            key={t.value}
            value={t.value}
            className="-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 data-[state=active]:border-brand-700 data-[state=active]:text-brand-800"
          >
            {t.label}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {tabs.map((t) => (
        <RTabs.Content key={t.value} value={t.value} className="focus:outline-none">
          {t.content}
        </RTabs.Content>
      ))}
    </RTabs.Root>
  );
}

// ------------------------------------------------------------------ Pager
export function Pager({ page, hasNext, onPrev, onNext, total }: { page: number; hasNext: boolean; onPrev: () => void; onNext: () => void; total?: number }) {
  return (
    <nav aria-label="Paginação" className="flex items-center justify-between gap-2 px-3 py-2 text-sm text-slate-600">
      <span>
        Página {page}
        {total !== undefined && ` · ${total.toLocaleString('pt-BR')} registros`}
      </span>
      <div className="flex gap-1">
        <Button size="sm" onClick={onPrev} disabled={page <= 1} icon={<ChevronLeft className="size-4" aria-hidden />}>
          Anterior
        </Button>
        <Button size="sm" onClick={onNext} disabled={!hasNext}>
          Próxima <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
    </nav>
  );
}

export function TableWrap({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="overflow-x-auto" role="region" aria-label={label} tabIndex={label ? 0 : undefined}>
      {children}
    </div>
  );
}

// ------------------------------------------------------------------ Toasts (aria-live)
type ToastItem = { id: number; tone: 'success' | 'error' | 'info'; text: string };
const ToastCtx = createContext<(tone: ToastItem['tone'], text: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((tone: ToastItem['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, tone, text }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-20 right-4 z-[60] flex flex-col gap-2 md:bottom-4">
        {items.map((t) => (
          <div
            key={t.id}
            className={clsx(
              'pointer-events-auto flex max-w-sm items-start gap-2 rounded-md px-3 py-2 text-sm text-white shadow-lg',
              t.tone === 'success' && 'bg-emerald-700',
              t.tone === 'error' && 'bg-red-700',
              t.tone === 'info' && 'bg-slate-800',
            )}
          >
            {t.tone === 'error' ? <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-slate-500">{k}</dt>
          <dd className="min-w-0 break-words text-slate-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ------------------------------------------------------------------ View Mode Toggle (Cards Default vs Lista)
export type ViewMode = 'cards' | 'list';
export function ViewModeToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  return (
    <div
      className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-100/80 p-0.5 shadow-2xs"
      role="group"
      aria-label="Alternar modo de visualização"
    >
      <button
        type="button"
        onClick={() => onChange('cards')}
        aria-pressed={value === 'cards'}
        className={clsx(
          'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all cursor-pointer',
          value === 'cards'
            ? 'bg-white text-brand-800 shadow-xs ring-1 ring-slate-200/80 font-semibold'
            : 'text-slate-600 hover:text-slate-900',
        )}
      >
        <LayoutGrid className="size-3.5 shrink-0" aria-hidden />
        <span>Cards</span>
      </button>
      <button
        type="button"
        onClick={() => onChange('list')}
        aria-pressed={value === 'list'}
        className={clsx(
          'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all cursor-pointer',
          value === 'list'
            ? 'bg-white text-brand-800 shadow-xs ring-1 ring-slate-200/80 font-semibold'
            : 'text-slate-600 hover:text-slate-900',
        )}
      >
        <List className="size-3.5 shrink-0" aria-hidden />
        <span>Lista</span>
      </button>
    </div>
  );
}
