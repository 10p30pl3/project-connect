import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  Mic,
  MicOff,
  PhoneCall,
  Radio,
  RefreshCw,
} from 'lucide-react';
import {
  Alert,
  Badge,
  BrandLogo,
  Button,
  Card,
  Field,
  InfoTooltip,
  Input,
  KeyValue,
  btnClass,
  useToast,
} from '../components/ui';

interface VollVoiceWidgetInstance {
  client?: { stop?: (remote?: boolean) => Promise<void> | void };
  host?: HTMLElement;
  open?: () => void;
}

interface VollVoiceWidgetGlobal {
  mount: (opts: {
    serverUrl?: string;
    publicWidgetKey?: string;
    title?: string;
    autoOpen?: boolean;
  }) => VollVoiceWidgetInstance;
}

declare global {
  interface Window {
    VollVoiceWidget?: VollVoiceWidgetGlobal;
  }
}

let widgetScriptPromise: Promise<VollVoiceWidgetGlobal> | null = null;

function loadWidgetScript(scriptSrc: string): Promise<VollVoiceWidgetGlobal> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Ambiente sem janela de navegador.'));
  }
  if (window.VollVoiceWidget) {
    return Promise.resolve(window.VollVoiceWidget);
  }
  if (widgetScriptPromise) {
    return widgetScriptPromise;
  }

  widgetScriptPromise = new Promise<VollVoiceWidgetGlobal>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-voll-demo-widget-loader="true"]');
    if (existing && existing.getAttribute('src') !== scriptSrc) {
      existing.remove();
    }

    const script = document.createElement('script');
    script.src = scriptSrc;
    script.async = true;
    script.setAttribute('data-voll-auto', 'false');
    script.setAttribute('data-voll-demo-widget-loader', 'true');
    script.onload = () => {
      if (window.VollVoiceWidget) {
        resolve(window.VollVoiceWidget);
        return;
      }
      widgetScriptPromise = null;
      reject(new Error('Script carregado sem inicializar window.VollVoiceWidget.'));
    };
    script.onerror = () => {
      script.remove();
      widgetScriptPromise = null;
      reject(new Error('Falha ao carregar /api/public/webrtc/widget.js.'));
    };
    document.head.appendChild(script);
  });

  return widgetScriptPromise;
}

function cleanupMountedWidget(mountedRef: { current: VollVoiceWidgetInstance | null }) {
  try {
    mountedRef.current?.client?.stop?.();
  } catch {
    /* ignore cleanup failures */
  }
  mountedRef.current = null;
  if (typeof document !== 'undefined') {
    document.getElementById('voll-voice-widget-host')?.remove();
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildStandaloneDemoHtml(origin: string, widgetKey: string, channelName: string): string {
  const safeOrigin = escapeHtml(origin);
  const safeKey = escapeHtml(widgetKey);
  const safeTitle = escapeHtml(channelName || 'Atendimento de Voz');
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Demo WebRTC · ${safeTitle}</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #0f172a; display: grid; min-height: 100vh; place-items: center; padding: 24px; }
    main { max-width: 560px; width: 100%; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 24px; box-shadow: 0 4px 20px rgba(15, 23, 42, .06); }
    h1 { margin: 0 0 12px; font-size: 20px; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 8px 16px; font-size: 13px; margin: 16px 0 0; }
    dt { color: #64748b; }
    dd { margin: 0; font-family: ui-monospace, monospace; word-break: break-all; }
  </style>
</head>
<body>
  <main>
    <h1>Demo WebRTC · ${safeTitle}</h1>
    <dl>
      <dt>Servidor</dt>
      <dd>${safeOrigin}</dd>
      <dt>Widget Key</dt>
      <dd>${safeKey}</dd>
    </dl>
  </main>
  <script src="${safeOrigin}/api/public/webrtc/widget.js" data-widget-key="${safeKey}"></script>
</body>
</html>
`;
}

export function WebRtcDemoPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();

  const initialKey = (searchParams.get('key') ?? '').trim();
  const channelName = (searchParams.get('name') ?? '').trim();

  const [keyInput, setKeyInput] = useState(initialKey);
  const [activeKey, setActiveKey] = useState(initialKey);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(initialKey ? 'loading' : 'idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [copiedTag, setCopiedTag] = useState(false);

  const mountedRef = useRef<VollVoiceWidgetInstance | null>(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const hasMicSupport =
    typeof window !== 'undefined' &&
    Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia);
  const snippetTag = activeKey
    ? `<script src="${origin}/api/public/webrtc/widget.js" data-widget-key="${activeKey}"></script>`
    : '';

  useEffect(() => {
    const nextKey = (searchParams.get('key') ?? '').trim();
    setKeyInput(nextKey);
    setActiveKey(nextKey);
  }, [searchParams]);

  useEffect(() => {
    if (!activeKey || typeof window === 'undefined') {
      cleanupMountedWidget(mountedRef);
      setStatus('idle');
      setLoadError(null);
      return;
    }

    let cancelled = false;
    setStatus('loading');
    setLoadError(null);
    cleanupMountedWidget(mountedRef);

    loadWidgetScript(`${window.location.origin}/api/public/webrtc/widget.js`)
      .then((widgetApi) => {
        if (cancelled) return;
        cleanupMountedWidget(mountedRef);
        mountedRef.current = widgetApi.mount({
          serverUrl: window.location.origin,
          publicWidgetKey: activeKey,
          title: channelName || 'Atendimento de Voz',
          autoOpen: true,
        });
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setLoadError(err instanceof Error ? err.message : 'Erro inesperado ao carregar o widget.');
      });

    return () => {
      cancelled = true;
      cleanupMountedWidget(mountedRef);
    };
  }, [activeKey, channelName, reloadNonce]);

  function handleRetry() {
    widgetScriptPromise = null;
    setReloadNonce((n) => n + 1);
  }

  function handleApplyKey(e: FormEvent) {
    e.preventDefault();
    const trimmed = keyInput.trim();
    if (!trimmed) {
      toast('error', 'Informe uma chave pública do Web Widget.');
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set('key', trimmed);
    setSearchParams(next, { replace: true });
    setActiveKey(trimmed);
    setReloadNonce((n) => n + 1);
  }

  function handleCopyTag() {
    if (!snippetTag) return;
    navigator.clipboard?.writeText(snippetTag);
    setCopiedTag(true);
    toast('info', 'Tag HTML do Web Widget copiada.');
    window.setTimeout(() => setCopiedTag(false), 2000);
  }

  function handleDownloadHtml() {
    if (!activeKey || typeof document === 'undefined') return;
    const html = buildStandaloneDemoHtml(origin, activeKey, channelName || 'Atendimento de Voz');
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'webrtc-demo.html';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('success', 'Arquivo webrtc-demo.html baixado.');
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/90 bg-white px-5 py-3.5 shadow-xs">
          <div className="flex items-center gap-3">
            <BrandLogo size="md" />
            <Badge tone="brand">
              <Radio className="size-3" aria-hidden />
              Demo Pública
            </Badge>
          </div>
          <Link to="/canais" className={btnClass('ghost', 'sm')}>
            <ArrowLeft className="size-3.5" aria-hidden />
            <span>Canais</span>
          </Link>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-1.5">
            <h1 className="text-[18px] font-bold tracking-tight text-slate-900">
              {channelName ? `WebRTC · ${channelName}` : 'WebRTC · Página de Demonstração'}
            </h1>
            <InfoTooltip content="Ambiente público isolado para validar o Web Widget via /api/public/webrtc/widget.js sem sessão autenticada do portal." />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {status === 'ready' && <Badge tone="green">Widget pronto</Badge>}
            {status === 'loading' && <Badge tone="blue">Carregando widget…</Badge>}
            {status === 'error' && <Badge tone="red">Falha no widget</Badge>}
            {status === 'idle' && <Badge tone="amber">Chave não informada</Badge>}
            {hasMicSupport ? (
              <Badge tone="green" icon={<Mic className="size-3" aria-hidden />}>
                Microfone liberado
              </Badge>
            ) : (
              <Badge tone="amber" icon={<MicOff className="size-3" aria-hidden />}>
                Requer HTTPS ou localhost
              </Badge>
            )}
          </div>
        </div>

        {!hasMicSupport && (
          <Alert tone="warn" title="Microfone bloqueado fora de HTTPS ou localhost">
            Para testar áudio em origem HTTP remota, baixe o HTML de teste e sirva localmente em{' '}
            <code className="font-mono text-xs">http://localhost</code>.
          </Alert>
        )}

        {status === 'error' && loadError && (
          <Alert tone="error" title="Não foi possível carregar o widget WebRTC">
            <span className="mr-2">{loadError}</span>
            <Button size="sm" variant="link" onClick={handleRetry}>
              Tentar novamente
            </Button>
          </Alert>
        )}

        <Card
          title="Widget WebRTC Público"
          tooltip="Altere a chave pública para testar outro canal ou abra o painel flutuante no canto inferior direito."
        >
          <div className="space-y-4">
            <form onSubmit={handleApplyKey} className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Field
                label="Chave pública do widget"
                tooltip="Identificador público (data-widget-key) gerado automaticamente em Canais para conexões WebRTC."
                className="flex-1"
              >
                {(p) => (
                  <Input
                    id={p.id}
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    placeholder="webrtc_pub_..."
                    className="font-mono"
                  />
                )}
              </Field>
              <Button type="submit" variant="secondary" className="sm:mb-0">
                Carregar chave
              </Button>
            </form>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                disabled={status !== 'ready'}
                icon={<PhoneCall className="size-4" aria-hidden />}
                onClick={() => mountedRef.current?.open?.()}
              >
                Abrir widget
              </Button>
              <Button
                variant="secondary"
                disabled={!activeKey}
                icon={<RefreshCw className="size-4" aria-hidden />}
                onClick={handleRetry}
              >
                Recarregar widget
              </Button>
              <Button
                variant="secondary"
                disabled={!snippetTag}
                icon={copiedTag ? <Check className="size-4 text-emerald-600" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                onClick={handleCopyTag}
              >
                Copiar tag HTML
              </Button>
              <Button
                variant="secondary"
                disabled={!activeKey}
                icon={<Download className="size-4" aria-hidden />}
                onClick={handleDownloadHtml}
              >
                Baixar HTML de teste
              </Button>
            </div>

            {activeKey && (
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
                <KeyValue
                  items={[
                    ['Origem pública', <code className="font-mono text-xs">{origin || '—'}</code>],
                    ['Script incorporado', <code className="font-mono text-xs">/api/public/webrtc/widget.js</code>],
                    [
                      'Tag HTML',
                      <code className="block break-all font-mono text-xs text-slate-800">{snippetTag}</code>,
                    ],
                  ]}
                />
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
