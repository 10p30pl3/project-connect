import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Bot,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Radio,
  Route,
  SlidersHorizontal,
  Trash2,
  Zap,
} from 'lucide-react';
import {
  CONNECTION_CHANNEL_LABEL,
  WEBRTC_MODE_LABEL,
  isSuperAdminRole,
} from '@voll/shared';
import { del, errorMessage, get, patch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useExperienceMode } from '../lib/experience-mode';
import { fmtDateTime, fmtMoney } from '../lib/format';
import type { Connection } from '../lib/types';
import { ChannelFormModal } from '../components/ChannelFormModal';
import { SetupIndicator, useTelephonySetupStatus } from '../components/TelephonySetupGuide';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Empty,
  ErrorState,
  Field,
  InfoTooltip,
  Loading,
  Modal,
  PageHeader,
  Select,
  TableWrap,
  ViewModeToggle,
  useToast,
  type ViewMode,
} from '../components/ui';

export const PROVIDER_LABEL: Record<string, string> = {
  VOICE_APP: 'Voice-App IA (FreeSWITCH + Tronco Direct Call)',
  WEBRTC_NATIVE: 'WebRTC Nativo (Web Widget & WhatsApp Calling)',
  API_TRIGGER: 'API de Gatilhos & Webhooks Voll Plan',
  META_CLOUD: 'Meta Cloud API Oficial (WhatsApp)',
  SIP_TRUNK: 'Tronco SIP Direto (PABX / IP)',
  SMPP: 'Gateway SMPP (SMS Corporativo)',
  SMTP: 'Relay SMTP (E-mail Transacional)',
  RBM: 'Google RBM (RCS Corporativo)',
  TWILIO: 'Twilio (Voice / SMS)',
  SENDGRID: 'SendGrid (E-mail)',
  SIMULATED: 'Simulador Sandbox (Ambiente de Testes)',
};

export const PROVIDER_SHORT_LABEL: Record<string, string> = {
  VOICE_APP: 'Voice-App IA · Tronco Direct Call',
  WEBRTC_NATIVE: 'WebRTC Nativo · Web & WhatsApp Calling',
  API_TRIGGER: 'API de Gatilhos & Disparos Voll',
  META_CLOUD: 'Meta Cloud API Oficial',
  SIP_TRUNK: 'Tronco SIP Direto',
  SMPP: 'Gateway SMPP',
  SMTP: 'Relay SMTP',
  RBM: 'Google RBM',
  TWILIO: 'Twilio',
  SENDGRID: 'SendGrid',
  SIMULATED: 'Simulador (Demo)',
};

function supportsVoiceAgent(c: Connection): boolean {
  return c.provider === 'VOICE_APP' || c.channelType === 'WEBRTC' || c.provider === 'WEBRTC_NATIVE';
}

function isWebRtcConnection(c: Connection): boolean {
  return c.channelType === 'WEBRTC' || c.provider === 'WEBRTC_NATIVE';
}

export function ChannelsPage() {
  const { me, can } = useAuth();
  const { isAtLeast } = useExperienceMode();
  const isAdvanced = isAtLeast('advanced');
  const isSuper = isSuperAdminRole(me?.role);
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['connections'], queryFn: () => get<{ items: Connection[] }>('/connections') });
  const tenantsQ = useQuery({
    queryKey: ['telephony', 'tenants'],
    queryFn: () => get<{ tenants: { id: string; name: string; voice?: string }[] }>('/telephony/tenants'),
    retry: false,
  });
  const setupQ = useTelephonySetupStatus();
  const [edit, setEdit] = useState<Connection | null>(null);
  const [deletingConn, setDeletingConn] = useState<Connection | null>(null);
  const [agentFor, setAgentFor] = useState<Connection | null>(null);
  const [openNew, setOpenNew] = useState(false);

  const deleteConnM = useMutation({
    mutationFn: (id: string) => del<{ deleted: boolean; id: string }>(`/connections/${id}`),
    onSuccess: () => {
      toast('success', 'Canal excluído com sucesso.');
      setDeletingConn(null);
      qc.invalidateQueries({ queryKey: ['connections'] });
    },
    onError: (e) => {
      toast('error', errorMessage(e));
    },
  });

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem('channels_view_mode');
      return saved === 'list' ? 'list' : 'cards';
    } catch {
      return 'cards';
    }
  });
  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('channels_view_mode', mode);
    } catch {}
  };
  const canEdit = can('connections.write');

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      patch<Connection>(`/connections/${id}`, { active }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['connections'] });
      toast('success', `Canal "${updated.name}" ${updated.active ? 'habilitado' : 'desabilitado'} com sucesso.`);
    },
    onError: (e) => {
      toast('error', `Erro ao alterar situação do canal: ${errorMessage(e)}`);
    },
  });

  const handleToggleActive = (c: Connection) => {
    if (!canEdit || toggleActiveMutation.isPending) return;
    toggleActiveMutation.mutate({ id: c.id, active: !c.active });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Canais & Integrações"
        tooltip="Gerencie todos os canais (Voz, WebRTC, WhatsApp, SMS, E-mail e RCS) do básico ao avançado, com endereços técnicos e teste de conectividade integrados."
        actions={
          <div className="flex items-center gap-2.5">
            <SetupIndicator />
            <ViewModeToggle value={viewMode} onChange={handleViewModeChange} />
            {canEdit && (
              <Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setOpenNew(true)}>
                Novo canal
              </Button>
            )}
          </div>
        }
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-semibold text-slate-800">Canais Operacionais &amp; Endereços Técnicos</h2>
          <InfoTooltip content="Cada canal reúne configurações básicas, parâmetros avançados de protocolo, credenciais protegidas e teste direto de conectividade." />
        </div>
      </div>

      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data!.items.length === 0 ? (
        <Empty title="Nenhum canal cadastrado" />
      ) : viewMode === 'cards' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {q.data!.items.map((c) => {
            const sim = c.simulation;
            const isSimulated = c.provider === 'SIMULATED';
            const coverageWarning = setupQ.data?.warnings.find(
              (w) => w.code === 'channel_without_coverage' && w.resourceId === c.id,
            );
            return (
              <Card key={c.id} padded={false} className="flex flex-col justify-between overflow-hidden border-slate-200 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-slate-900 truncate">{c.name}</span>
                      <Badge tone="gray">{CONNECTION_CHANNEL_LABEL[c.channelType]}</Badge>
                      {isWebRtcConnection(c) ? (
                        <Badge tone="brand">
                          <Radio className="size-3 mr-1 inline" aria-hidden />
                          {WEBRTC_MODE_LABEL[c.webrtcMode ?? 'BOTH']}
                        </Badge>
                      ) : c.provider === 'VOICE_APP' ? (
                        <Badge tone="blue">Voice-App IA</Badge>
                      ) : c.provider === 'API_TRIGGER' ? (
                        <Badge tone="brand">Gatilho API</Badge>
                      ) : c.provider === 'META_CLOUD' ? (
                        <Badge tone="green">Meta Oficial</Badge>
                      ) : isSimulated ? (
                        <Badge tone="amber">Sandbox</Badge>
                      ) : (
                        <Badge tone="blue">{c.provider}</Badge>
                      )}
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() => handleToggleActive(c)}
                          disabled={toggleActiveMutation.isPending}
                          className="inline-flex items-center gap-1.5 focus:outline-hidden disabled:opacity-50 cursor-pointer"
                          title={c.active ? 'Clique para desabilitar este canal' : 'Clique para habilitar este canal'}
                        >
                          <span
                            className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                              c.active ? 'bg-emerald-600' : 'bg-slate-300'
                            }`}
                          >
                            <span
                              className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                                c.active ? 'translate-x-3' : 'translate-x-0'
                              }`}
                            />
                          </span>
                          {c.active ? <Badge tone="green">Ativa</Badge> : <Badge tone="gray">Inativa</Badge>}
                        </button>
                      ) : (
                        c.active ? <Badge tone="green">Ativa</Badge> : <Badge tone="gray">Inativa</Badge>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-500">
                      Provedor: {PROVIDER_SHORT_LABEL[c.provider] || c.provider}
                      {supportsVoiceAgent(c) && (
                        <>
                          {' · '}Agente padrão:{' '}
                          <strong>
                            {tenantsQ.data?.tenants.find((t) => t.id === c.tenantId)?.name ??
                              c.tenantId ??
                              'Padrão do workspace'}
                          </strong>
                        </>
                      )}
                      {isSuper && c.tariffUpdatedAt ? ` · atualizado em ${fmtDateTime(c.tariffUpdatedAt)}` : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {canEdit && (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={c.active ? <PowerOff className="size-3.5 text-slate-400" /> : <Power className="size-3.5 text-emerald-600" />}
                          onClick={() => handleToggleActive(c)}
                          disabled={toggleActiveMutation.isPending}
                          title={c.active ? 'Desabilitar este canal' : 'Habilitar este canal'}
                        >
                          {c.active ? 'Desabilitar' : 'Habilitar'}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<Pencil className="size-3.5" />}
                          onClick={() => setEdit(c)}
                        >
                          Editar canal
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:bg-red-50 hover:text-red-700"
                          icon={<Trash2 className="size-3.5" />}
                          onClick={() => setDeletingConn(c)}
                          title="Excluir canal"
                          aria-label="Excluir canal"
                        />
                      </>
                    )}
                  </div>
                </div>

                <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                  <div
                    onClick={() => canEdit && setEdit(c)}
                    className={canEdit ? 'cursor-pointer group/steps rounded-lg p-1 -m-1 hover:bg-slate-50/80 transition' : ''}
                    title={canEdit ? 'Clique para configurar este canal e parâmetros avançados' : undefined}
                  >
                    <ol className="flex flex-wrap items-center gap-2" aria-label="Parâmetros do canal">
                      <li className="flex items-center gap-2">
                        <span className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs">
                          <strong>1. Canal &amp; Conector</strong>
                          <span className="text-slate-500"> · {CONNECTION_CHANNEL_LABEL[c.channelType]}</span>
                          <span className="block text-slate-500">
                            {PROVIDER_SHORT_LABEL[c.provider] || c.provider}
                          </span>
                        </span>
                      </li>
                      {isSuper && (
                        <li className="flex items-center gap-2">
                          <ArrowRight className="size-4 text-slate-400" aria-hidden />
                          <span className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs">
                            <strong>2. Tarifa por Tentativa</strong>
                            <span className="text-slate-500">
                              {' '}
                              · {c.tariff === null ? 'Desconhecida' : c.tariff === 0 ? 'Gratuito (R$ 0,00)' : fmtMoney(c.tariff, 4)}
                            </span>
                            <span className="block text-slate-500">
                              {c.tariffUpdatedAt ? `Desde ${fmtDateTime(c.tariffUpdatedAt)}` : 'Valor de referência'}
                            </span>
                          </span>
                        </li>
                      )}
                      <li className="flex items-center gap-2">
                        <ArrowRight className="size-4 text-slate-400" aria-hidden />
                        {isWebRtcConnection(c) ? (
                          <span className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs">
                            <strong>{isSuper ? '3.' : '2.'} Atendimento &amp; TLS</strong>
                            <span className="text-slate-500 block">
                              {WEBRTC_MODE_LABEL[c.webrtcMode ?? 'BOTH']}
                            </span>
                            <span className="block text-slate-500">
                              {typeof window !== 'undefined' &&
                              (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
                                ? 'HTTPS Pronto (Microfone)'
                                : 'Requer HTTPS (Microfone)'}
                            </span>
                          </span>
                        ) : !isSimulated ? (
                          <span className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs">
                            <strong>{isSuper ? '3.' : '2.'} Endpoint &amp; Origem</strong>
                            <span className="text-slate-500 block truncate max-w-[210px]" title={c.endpointUrl || 'Padrão do Workspace'}>
                              {c.endpointUrl || 'Padrão do Workspace'}
                            </span>
                            <span className="block text-slate-500">
                              {c.callerId ? `BINA: ${c.callerId}` : 'BINA automática'}
                            </span>
                          </span>
                        ) : (
                          <span className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs">
                            <strong>3. Modo Sandbox</strong>
                            <span className="text-slate-500 block">
                              Latência: {sim ? `${sim.minDelaySeconds}s–${sim.maxDelaySeconds}s` : 'Padrão'}
                            </span>
                            <span className="block text-slate-400 text-[11px]">
                              Parâmetros configuráveis
                            </span>
                          </span>
                        )}
                      </li>
                    </ol>
                  </div>

                  {isWebRtcConnection(c) && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {(c.webrtcMode ?? 'BOTH') !== 'WHATSAPP_CALLING' && (
                        <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              <span>Web Widget</span>
                              <InfoTooltip content="Incorpore este script no seu site externo. Visitantes conectam usando a chave pública exclusiva deste canal sem precisar de login." />
                            </div>
                            <code className="block truncate font-mono text-xs text-slate-800">
                              {c.publicWidgetKey || 'chave-pendente'}
                            </code>
                          </div>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              const origin = typeof window !== 'undefined' ? window.location.origin : '';
                              const tag = `<script src="${origin}/api/public/webrtc/widget.js" data-widget-key="${c.publicWidgetKey ?? ''}"></script>`;
                              navigator.clipboard?.writeText(tag);
                              toast('info', 'Snippet do Web Widget copiado.');
                            }}
                          >
                            Copiar tag
                          </Button>
                        </div>
                      )}

                      {(c.webrtcMode ?? 'BOTH') !== 'WEB' && (
                        <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              <span>WhatsApp Calling</span>
                              <InfoTooltip content="Configure a URL do webhook e o Verify Token no Meta Business Suite (campo calls) para receber ligações de voz no agente vinculado." />
                            </div>
                            <span className="text-xs font-medium text-slate-700 truncate block">
                              {c.whatsappPhoneNumberId && c.hasWhatsappAppSecret && c.hasWhatsappAccessToken
                                ? `Número Meta ${c.whatsappPhoneNumberId}`
                                : 'Credenciais Meta pendentes'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                const origin = typeof window !== 'undefined' ? window.location.origin : '';
                                navigator.clipboard?.writeText(`${origin}/api/webhooks/whatsapp-calling/${c.id}`);
                                toast('info', 'URL do webhook WhatsApp Calling copiada.');
                              }}
                            >
                              Webhook
                            </Button>
                            {c.whatsappVerifyToken && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  navigator.clipboard?.writeText(c.whatsappVerifyToken || '');
                                  toast('info', 'Verify Token copiado.');
                                }}
                              >
                                Token
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="pt-2.5 flex items-center justify-between gap-2 flex-wrap border-t border-slate-100">
                    <div className="flex items-center gap-1.5 text-xs">
                      {!isSimulated ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <Zap className="size-3 text-emerald-600" />
                          Conexão Operacional Ativa
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                          Ambiente Simulado (Sandbox)
                        </span>
                      )}
                      {coverageWarning && (
                        <span className="inline-flex items-center gap-1 ml-1">
                          <Badge tone="amber">Sem cobertura de agente/rota</Badge>
                          <InfoTooltip content={coverageWarning.message} />
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {supportsVoiceAgent(c) && (
                        <button
                          type="button"
                          onClick={() => setAgentFor(c)}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:text-brand-800 bg-brand-50/80 hover:bg-brand-100/90 px-2.5 py-1 rounded-md border border-brand-200/80 transition"
                        >
                          <Bot className="size-3 text-brand-600" />
                          <span>Agente de voz</span>
                        </button>
                      )}
                      {isAdvanced && supportsVoiceAgent(c) && (
                        <Link
                          to={`/rotas?connectionId=${encodeURIComponent(c.id)}`}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200 transition"
                        >
                          <Route className="size-3 text-slate-600" />
                          <span>Rotas</span>
                        </Link>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setEdit(c)}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:text-brand-800 bg-brand-50/80 hover:bg-brand-100/90 px-2.5 py-1 rounded-md border border-brand-200/80 transition"
                        >
                          <SlidersHorizontal className="size-3 text-brand-600" />
                          <span>Configurar</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card padded={false}>
          <TableWrap label="Conexões">
            <table className="data">
              <thead>
                <tr>
                  <th>Conexão</th>
                  <th>Canal</th>
                  <th>Provedor &amp; Tipo</th>
                  <th>Endpoint &amp; BINA</th>
                  {isSuper && <th>Tarifa por tentativa</th>}
                  <th>Situação</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {q.data!.items.map((c) => {
                  const isSim = c.provider === 'SIMULATED';
                  return (
                    <tr key={c.id}>
                      <td className="font-medium text-slate-900">{c.name}</td>
                      <td>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge tone="gray">{CONNECTION_CHANNEL_LABEL[c.channelType]}</Badge>
                          {isWebRtcConnection(c) && (
                            <Badge tone="brand">
                              <Radio className="size-3 mr-1 inline" aria-hidden />
                              {c.webrtcMode === 'WEB'
                                ? 'Web Widget'
                                : c.webrtcMode === 'WHATSAPP_CALLING'
                                  ? 'WhatsApp'
                                  : 'Web + WA'}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className="text-xs font-semibold text-slate-700">
                          {PROVIDER_SHORT_LABEL[c.provider] || c.provider}
                        </span>
                      </td>
                      <td className="text-xs font-mono text-slate-600">
                        {isWebRtcConnection(c) ? (
                          <span className="text-slate-600">
                            Widget: {c.publicWidgetKey ? `${c.publicWidgetKey.slice(0, 12)}…` : 'auto'}
                          </span>
                        ) : c.endpointUrl ? (
                          <span className="truncate max-w-[200px] block" title={c.endpointUrl}>
                            {c.endpointUrl}
                          </span>
                        ) : isSim ? (
                          <span className="text-slate-400 italic">Simulador integrado</span>
                        ) : (
                          <span className="text-slate-400">Padrão Workspace</span>
                        )}
                        {c.callerId && <div className="text-[11px] text-slate-400 font-sans">BINA: {c.callerId}</div>}
                        {supportsVoiceAgent(c) && (
                          <div className="text-[11px] text-brand-700 font-sans">
                            Agente padrão: {tenantsQ.data?.tenants.find((t) => t.id === c.tenantId)?.name ?? c.tenantId ?? 'Fallback do workspace'}
                          </div>
                        )}
                      </td>
                      {isSuper && (
                        <td>
                          {c.tariff === null ? (
                            <span className="text-slate-500">desconhecida</span>
                          ) : c.tariff === 0 ? (
                            <span className="text-emerald-600 font-medium">Gratuita</span>
                          ) : (
                            fmtMoney(c.tariff, 4)
                          )}
                          {c.tariffUpdatedAt && <div className="text-xs text-slate-500">desde {fmtDateTime(c.tariffUpdatedAt)}</div>}
                        </td>
                      )}
                      <td>
                        {canEdit ? (
                          <button
                            type="button"
                            onClick={() => handleToggleActive(c)}
                            disabled={toggleActiveMutation.isPending}
                            className="group inline-flex items-center gap-2 text-left focus:outline-hidden disabled:opacity-50 cursor-pointer"
                            title={c.active ? 'Clique para desabilitar este canal' : 'Clique para habilitar este canal'}
                          >
                            <span
                              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                                c.active ? 'bg-emerald-600' : 'bg-slate-300'
                              }`}
                            >
                              <span
                                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                                  c.active ? 'translate-x-4' : 'translate-x-0'
                                }`}
                              />
                            </span>
                            {c.active ? <Badge tone="green">Ativa</Badge> : <Badge tone="gray">Inativa</Badge>}
                          </button>
                        ) : (
                          c.active ? <Badge tone="green">Ativa</Badge> : <Badge tone="gray">Inativa</Badge>
                        )}
                      </td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          {supportsVoiceAgent(c) && (
                            <Button size="sm" variant="secondary" icon={<Bot className="size-3.5" />} onClick={() => setAgentFor(c)}>
                              Agente de voz
                            </Button>
                          )}
                          {isAdvanced && supportsVoiceAgent(c) && (
                            <Link
                              to={`/rotas?connectionId=${encodeURIComponent(c.id)}`}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              <Route className="size-3.5 text-slate-500" />
                              Rotas
                            </Link>
                          )}
                          {canEdit && (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                icon={c.active ? <PowerOff className="size-3.5 text-slate-400" /> : <Power className="size-3.5 text-emerald-600" />}
                                onClick={() => handleToggleActive(c)}
                                disabled={toggleActiveMutation.isPending}
                                title={c.active ? 'Desabilitar este canal' : 'Habilitar este canal'}
                              >
                                {c.active ? 'Desabilitar' : 'Habilitar'}
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                icon={<SlidersHorizontal className="size-3.5" />}
                                onClick={() => setEdit(c)}
                                title="Configurar canal"
                              >
                                Configurar
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-red-600 hover:bg-red-50 hover:text-red-700"
                                icon={<Trash2 className="size-3.5" />}
                                onClick={() => setDeletingConn(c)}
                                title="Excluir canal"
                                aria-label="Excluir canal"
                              />
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}

      {edit && (
        <ChannelFormModal
          key={edit.id}
          open
          connection={edit}
          isSuper={isSuper}
          tenants={tenantsQ.data?.tenants ?? []}
          onClose={() => setEdit(null)}
        />
      )}
      {openNew && (
        <ChannelFormModal
          key="new"
          open
          connection={null}
          isSuper={isSuper}
          tenants={tenantsQ.data?.tenants ?? []}
          onClose={() => setOpenNew(false)}
        />
      )}
      {agentFor && (
        <BindVoiceAgentModal
          connection={agentFor}
          tenants={tenantsQ.data?.tenants ?? []}
          canEdit={canEdit}
          onClose={() => setAgentFor(null)}
        />
      )}
      <ConfirmDialog
        open={Boolean(deletingConn)}
        onOpenChange={(o) => !o && setDeletingConn(null)}
        title={`Excluir canal "${deletingConn?.name}"?`}
        confirmLabel="Excluir"
        danger
        loading={deleteConnM.isPending}
        onConfirm={() => deletingConn && deleteConnM.mutate(deletingConn.id)}
      >
        <p className="text-sm text-slate-600">
          Conexões em uso por jornadas ou com histórico de tentativas não podem ser excluídas (use Desabilitar nesse caso).
        </p>
      </ConfirmDialog>
    </div>
  );
}

function BindVoiceAgentModal({
  connection,
  tenants,
  canEdit,
  onClose,
}: {
  connection: Connection;
  tenants: { id: string; name: string; voice?: string }[];
  canEdit: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [tenantId, setTenantId] = useState(connection.tenantId || '');

  const saveM = useMutation({
    mutationFn: () => patch(`/connections/${connection.id}`, { tenantId: tenantId || null }),
    onSuccess: () => {
      toast('success', 'Agente de voz vinculado ao canal com sucesso.');
      qc.invalidateQueries({ queryKey: ['connections'] });
      onClose();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Agente de Voz padrão · ${connection.name}`}
      description="Os Agentes de Voz são reutilizáveis entre Canais, Rotas e Campanhas."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
          {canEdit && (
            <Button variant="primary" loading={saveM.isPending} onClick={() => saveM.mutate()}>
              Salvar vínculo
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Agente padrão (fallback) deste canal" tooltip="Usado quando nenhuma Rota de Entrada ou Campanha sobrescrever o atendimento.">
          {(p) => (
            <Select id={p.id} disabled={!canEdit} value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
              <option value="">Sem agente padrão (usa rotas ou padrão do workspace)</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.voice ? `(${t.voice})` : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
          <span>Quer criar ou editar o prompt, voz ou filtros deste agente?</span>
          <Link to="/agentes-de-voz" className="font-semibold text-brand-700 hover:underline whitespace-nowrap">
            Abrir Agentes de Voz →
          </Link>
        </div>
      </div>
    </Modal>
  );
}
