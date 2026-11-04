import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Cable,
  CheckCircle2,
  ChevronDown,
  Globe,
  KeyRound,
  Mail,
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  Radio,
  RefreshCw,
  Save,
  Server,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Zap,
} from 'lucide-react';
import {
  CHANNEL_LABEL,
  DEFAULT_CHANNEL_ENDPOINTS,
  type ChannelEndpointConfig,
  type ChannelType,
} from '@voll/shared';
import { ApiError, errorMessage, get, patch, post } from '../lib/api';
import type { Connection, Simulation, Tabulation } from '../lib/types';
import { fmtDateTime, fmtMoney } from '../lib/format';
import { useAuth } from '../lib/auth';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Empty,
  ErrorState,
  Field,
  InfoTooltip,
  Input,
  Loading,
  Modal,
  PageHeader,
  Select,
  TableWrap,
  Tabs,
  useToast,
  ViewModeToggle,
  type ViewMode,
} from '../components/ui';

export const PROVIDER_LABEL: Record<string, string> = {
  VOICE_APP: 'Voice-App IA (FreeSWITCH + Tronco Direct Call)',
  API_TRIGGER: 'API de Gatilhos & Webhooks Voll Connect',
  META_CLOUD: 'Meta Cloud API Oficial (WhatsApp)',
  SIP_TRUNK: 'Tronco SIP Direto (PABX / IP)',
  TWILIO: 'Twilio (Voice / SMS)',
  SENDGRID: 'SendGrid (E-mail)',
  SIMULATED: 'Simulador Sandbox (Ambiente de Testes)',
};

export const PROVIDER_SHORT_LABEL: Record<string, string> = {
  VOICE_APP: 'Voice-App IA · Tronco Direct Call',
  API_TRIGGER: 'API de Gatilhos & Disparos Voll',
  META_CLOUD: 'Meta Cloud API Oficial',
  SIP_TRUNK: 'Tronco SIP Direto',
  TWILIO: 'Twilio',
  SENDGRID: 'SendGrid',
  SIMULATED: 'Simulador (Demo)',
};

export function ChannelsPage() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['connections'], queryFn: () => get<{ items: Connection[] }>('/connections') });
  const [edit, setEdit] = useState<Connection | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [activeTab, setActiveTab] = useState<'conexoes' | 'enderecos'>('conexoes');
  const canEdit = can('connections.write');

  return (
    <div className="space-y-4">
      <PageHeader
        title="Canais & Integrações"
        tooltip="Gerencie os canais de voz integrado ao voice-app, endpoints de disparo da Voll e parâmetros de conectividade."
        actions={
          activeTab === 'conexoes' ? (
            <div className="flex items-center gap-2.5">
              <ViewModeToggle value={viewMode} onChange={setViewMode} />
              {canEdit && (
                <Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setOpenNew(true)}>
                  Novo canal
                </Button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Badge tone="blue">Endereços de Produção & Gateways</Badge>
            </div>
          )
        }
      />

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as 'conexoes' | 'enderecos')}
        tabs={[
          {
            value: 'conexoes',
            label: (
              <span className="flex items-center gap-2">
                <Cable className="size-4" />
                <span>Conectores & Conexões</span>
              </span>
            ),
            content: (
              <div className="space-y-4 pt-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <h2 className="text-sm font-semibold text-slate-800">Conexões Operacionais & Canais Prioritários</h2>
                    <InfoTooltip content="Conexões ativas de discagem (Voice-App / Direct Call), APIs de gatilho Voll Connect e conectores." />
                  </div>
                  <span className="text-xs text-slate-400 italic">
                    Parâmetros avançados de simulação e resiliência acessíveis por canal
                  </span>
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
                      return (
                        <Card key={c.id} padded={false} className="flex flex-col justify-between overflow-hidden border-slate-200 shadow-xs">
                          {/* Header do Card */}
                          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 p-4">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm text-slate-900 truncate">{c.name}</span>
                                <Badge tone="gray">{CHANNEL_LABEL[c.channelType]}</Badge>
                                {c.provider === 'VOICE_APP' ? (
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
                                {c.active ? <Badge tone="green">Ativa</Badge> : <Badge tone="gray">Inativa</Badge>}
                              </div>
                              <span className="text-[11px] text-slate-500">
                                Provedor: {PROVIDER_SHORT_LABEL[c.provider] || c.provider}
                                {c.tariffUpdatedAt ? ` · atualizado em ${fmtDateTime(c.tariffUpdatedAt)}` : ''}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {canEdit && (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  icon={<Pencil className="size-3.5" />}
                                  onClick={() => setEdit(c)}
                                >
                                  Editar canal
                                </Button>
                              )}
                            </div>
                          </div>

                          {/* Corpo do Card com blocos encadeados */}
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
                                    <span className="text-slate-500"> · {CHANNEL_LABEL[c.channelType]}</span>
                                    <span className="block text-slate-500">
                                      {PROVIDER_SHORT_LABEL[c.provider] || c.provider}
                                    </span>
                                  </span>
                                </li>
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
                                <li className="flex items-center gap-2">
                                  <ArrowRight className="size-4 text-slate-400" aria-hidden />
                                  {!isSimulated ? (
                                    <span className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs">
                                      <strong>3. Endpoint &amp; Origem</strong>
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
                                        ⚙️ Parâmetros avançados
                                      </span>
                                    </span>
                                  )}
                                </li>
                              </ol>
                            </div>

                            {/* Barra inferior do Card */}
                            <div className="pt-2.5 flex items-center justify-between border-t border-slate-100">
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
                              </div>

                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() => setEdit(c)}
                                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:text-brand-800 bg-brand-50/80 hover:bg-brand-100/90 px-2.5 py-1 rounded-md border border-brand-200/80 transition"
                                >
                                  <SlidersHorizontal className="size-3 text-brand-600" />
                                  <span>Parâmetros avançados</span>
                                </button>
                              )}
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
                            <th>Tarifa por tentativa</th>
                            <th>Situação</th>
                            <th className="text-right">Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {q.data!.items.map((c) => {
                            const isSim = c.provider === 'SIMULATED';
                            return (
                              <tr key={c.id} className="hover:bg-slate-50/80 transition">
                                <td className="font-medium">
                                  <div className="flex items-center gap-2">
                                    <span>{c.name}</span>
                                    {!isSim ? (
                                      <Badge tone="green">Produção</Badge>
                                    ) : (
                                      <Badge tone="amber">Sandbox</Badge>
                                    )}
                                  </div>
                                </td>
                                <td>{CHANNEL_LABEL[c.channelType]}</td>
                                <td>
                                  <span className="text-xs font-semibold text-slate-700">
                                    {PROVIDER_SHORT_LABEL[c.provider] || c.provider}
                                  </span>
                                </td>
                                <td className="text-xs font-mono text-slate-600">
                                  {c.endpointUrl ? (
                                    <span className="truncate max-w-[200px] block" title={c.endpointUrl}>
                                      {c.endpointUrl}
                                    </span>
                                  ) : isSim ? (
                                    <span className="text-slate-400 italic">Simulador integrado</span>
                                  ) : (
                                    <span className="text-slate-400">Padrão Workspace</span>
                                  )}
                                  {c.callerId && <div className="text-[11px] text-slate-400 font-sans">BINA: {c.callerId}</div>}
                                </td>
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
                                <td>{c.active ? <Badge tone="green">Ativa</Badge> : <Badge tone="gray">Inativa</Badge>}</td>
                                <td className="text-right">
                                  {canEdit && (
                                    <div className="flex items-center justify-end gap-1.5">
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        icon={<SlidersHorizontal className="size-3.5" />}
                                        onClick={() => setEdit(c)}
                                        title="Configurar canal e parâmetros avançados"
                                      >
                                        Parâmetros avançados
                                      </Button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </TableWrap>
                  </Card>
                )}
              </div>
            ),
          },
          {
            value: 'enderecos',
            label: (
              <span className="flex items-center gap-2">
                <Server className="size-4" />
                <span>Configurar Endereços Técnicos</span>
              </span>
            ),
            content: <TechnicalEndpointsTab canEdit={canEdit} />,
          },
        ]}
      />

      {edit && <EditConnection c={edit} onClose={() => setEdit(null)} />}
      <NewConnectionDialog open={openNew} onOpenChange={setOpenNew} />
    </div>
  );
}

function TechnicalEndpointsTab({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ['technical-endpoints'],
    queryFn: () => get<{ data: ChannelEndpointConfig }>('/channels/technical-endpoints'),
  });

  const [form, setForm] = useState<ChannelEndpointConfig>(DEFAULT_CHANNEL_ENDPOINTS);
  const [testingChannel, setTestingChannel] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { status: string; code: number; details: string; latencyMs: number }>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (q.data?.data) {
      setForm(q.data.data);
    }
  }, [q.data]);

  const handleTest = async (channelKey: 'whatsapp' | 'voice' | 'sms' | 'email' | 'rcs') => {
    setTestingChannel(channelKey);
    try {
      const res = await post<{ ok: boolean; status: string; code: number; details: string; latencyMs: number }>(
        '/channels/technical-endpoints/test',
        { channel: channelKey },
      );
      setTestResults((prev) => ({
        ...prev,
        [channelKey]: {
          status: res.status,
          code: res.code,
          details: res.details,
          latencyMs: res.latencyMs,
        },
      }));
      toast('success', `Teste de conectividade do canal ${channelKey.toUpperCase()} concluído com sucesso (${res.latencyMs}ms).`);
    } catch (err) {
      toast('error', `Falha ao testar conectividade: ${errorMessage(err)}`);
    } finally {
      setTestingChannel(null);
    }
  };

  const handleSaveAll = async () => {
    setIsSaving(true);
    try {
      await post('/channels/technical-endpoints', form);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('vc_channel_endpoints', JSON.stringify(form));
      }
      await qc.invalidateQueries({ queryKey: ['technical-endpoints'] });
      toast('success', 'Endereços técnicos dos canais salvos com sucesso!');
    } catch (err) {
      toast('error', `Erro ao salvar endereços técnicos: ${errorMessage(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (q.isLoading) return <Loading />;

  return (
    <div className="space-y-6 pt-1">
      {/* Barra de Ações do Topo */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
        <div className="flex items-center gap-2">
          <Server className="size-4.5 text-slate-700" />
          <span className="text-sm font-bold text-slate-800">Endereços de Gateways & Protocolos de Acionamento</span>
          <InfoTooltip content="Defina os hosts, URLs de API, endpoints de Webhook e portas de comunicação para cada canal de mensageria e voz." />
        </div>

        {canEdit && (
          <Button
            type="button"
            variant="primary"
            onClick={handleSaveAll}
            loading={isSaving}
            icon={<Save className="size-4" />}
          >
            Salvar Endereços Técnicos
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 1. WhatsApp Business Cloud API */}
        <Card
          title={
            <div className="flex items-center gap-2">
              <MessageSquare className="size-4.5 text-emerald-600" />
              <span>WhatsApp Business API</span>
            </div>
          }
          tooltip="Parâmetros técnicos para envio e recebimento de mensagens através da Cloud API oficial da Meta."
          actions={
            <div className="flex items-center gap-2">
              {testResults.whatsapp ? (
                <Badge tone="green" icon={<CheckCircle2 className="size-3" />}>
                  {testResults.whatsapp.latencyMs}ms
                </Badge>
              ) : (
                <Badge tone="gray">Pronto</Badge>
              )}
              <Button
                size="sm"
                variant="secondary"
                loading={testingChannel === 'whatsapp'}
                onClick={() => handleTest('whatsapp')}
                icon={<RefreshCw className={`size-3.5 ${testingChannel === 'whatsapp' ? 'animate-spin' : ''}`} />}
              >
                Testar
              </Button>
            </div>
          }
        >
          <div className="space-y-3.5">
            <Field
              label="URL Base da API (Graph API)"
              required
              tooltip="Endpoint raiz oficial da Graph API Meta (ex: https://graph.facebook.com/v19.0)."
            >
              {(ids) => (
                <Input
                  id={ids.id}
                  value={form.whatsapp.apiBaseUrl}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setForm({ ...form, whatsapp: { ...form.whatsapp, apiBaseUrl: e.target.value } })
                  }
                  className="font-mono text-xs"
                />
              )}
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="Phone Number ID"
                required
                tooltip="Identificador exclusivo do número de telefone registrado na Meta Business Platform."
              >
                {(ids) => (
                  <Input
                    id={ids.id}
                    value={form.whatsapp.phoneNumberId}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setForm({ ...form, whatsapp: { ...form.whatsapp, phoneNumberId: e.target.value } })
                    }
                    className="font-mono text-xs"
                  />
                )}
              </Field>

              <Field
                label="WABA ID (Business Account)"
                required
                tooltip="ID da conta empresarial WhatsApp Business associada aos templates."
              >
                {(ids) => (
                  <Input
                    id={ids.id}
                    value={form.whatsapp.wabaId}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setForm({ ...form, whatsapp: { ...form.whatsapp, wabaId: e.target.value } })
                    }
                    className="font-mono text-xs"
                  />
                )}
              </Field>
            </div>

            <Field
              label="URL de Webhook (Status e Mensagens)"
              required
              tooltip="Endereço HTTPS público onde a Meta envia confirmações de entrega, leitura e respostas dos clientes."
            >
              {(ids) => (
                <Input
                  id={ids.id}
                  value={form.whatsapp.webhookUrl}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setForm({ ...form, whatsapp: { ...form.whatsapp, webhookUrl: e.target.value } })
                  }
                  className="font-mono text-xs"
                />
              )}
            </Field>

            <Field
              label="Verify Token do Webhook"
              tooltip="Token de desafio definido na Meta para validar a autenticidade das notificações push."
            >
              {(ids) => (
                <Input
                  id={ids.id}
                  type="password"
                  value={form.whatsapp.verifyToken}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setForm({ ...form, whatsapp: { ...form.whatsapp, verifyToken: e.target.value } })
                  }
                  className="font-mono text-xs"
                />
              )}
            </Field>
          </div>
        </Card>

        {/* 2. Voz & Telefonia IP (SIP Trunk & WebRTC) */}
        <Card
          title={
            <div className="flex items-center gap-2">
              <Phone className="size-4.5 text-blue-600" />
              <span>Telefonia IP / Discador de Voz</span>
            </div>
          }
          tooltip="Endereços de troncos SIP, sinalização WebRTC, portas e callbacks de bilhetagem do discador."
          actions={
            <div className="flex items-center gap-2">
              {testResults.voice ? (
                <Badge tone="green" icon={<CheckCircle2 className="size-3" />}>
                  {testResults.voice.latencyMs}ms
                </Badge>
              ) : (
                <Badge tone="gray">Pronto</Badge>
              )}
              <Button
                size="sm"
                variant="secondary"
                loading={testingChannel === 'voice'}
                onClick={() => handleTest('voice')}
                icon={<RefreshCw className={`size-3.5 ${testingChannel === 'voice' ? 'animate-spin' : ''}`} />}
              >
                Testar
              </Button>
            </div>
          }
        >
          <div className="space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <Field
                  label="Host / Servidor SIP Primário"
                  required
                  tooltip="Endereço FQDN ou IP do servidor PBX/SBC para envio de chamadas via discador preditivo."
                >
                  {(ids) => (
                    <Input
                      id={ids.id}
                      value={form.voice.sipServer}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setForm({ ...form, voice: { ...form.voice, sipServer: e.target.value } })
                      }
                      className="font-mono text-xs"
                    />
                  )}
                </Field>
              </div>

              <Field
                label="Porta SIP"
                required
                tooltip="Porta padrão de sinalização SIP (5060 para UDP/TCP, 5061 para TLS criptografado)."
              >
                {(ids) => (
                  <Input
                    id={ids.id}
                    type="number"
                    value={form.voice.sipPort}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setForm({ ...form, voice: { ...form.voice, sipPort: Number(e.target.value) } })
                    }
                    className="font-mono text-xs"
                  />
                )}
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="Transporte SIP"
                required
                tooltip="Protocolo de transporte para controle e sinalização das chamadas telefônicas."
              >
                {(ids) => (
                  <Select
                    id={ids.id}
                    value={form.voice.sipTransport}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        voice: { ...form.voice, sipTransport: e.target.value as 'UDP' | 'TCP' | 'TLS' },
                      })
                    }
                    className="text-xs"
                  >
                    <option value="TLS">TLS (Criptografado · Recomendado)</option>
                    <option value="TCP">TCP</option>
                    <option value="UDP">UDP</option>
                  </Select>
                )}
              </Field>

              <Field
                label="BINA Padrão (Caller ID)"
                tooltip="Número de telefone apresentado na tela do destinatário (com código de área)."
              >
                {(ids) => (
                  <Input
                    id={ids.id}
                    value={form.voice.defaultCallerId}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setForm({ ...form, voice: { ...form.voice, defaultCallerId: e.target.value } })
                    }
                    className="font-mono text-xs"
                  />
                )}
              </Field>
            </div>

            <Field
              label="Gateway WebRTC (WSS)"
              tooltip="Endereço seguro WebSocket (wss://) para conexão de softphone direto no navegador do operador."
            >
              {(ids) => (
                <Input
                  id={ids.id}
                  value={form.voice.webrtcGatewayUrl}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setForm({ ...form, voice: { ...form.voice, webrtcGatewayUrl: e.target.value } })
                  }
                  className="font-mono text-xs"
                />
              )}
            </Field>

            <Field
              label="Webhook de Bilhetagem / CDR"
              tooltip="Endpoint HTTP onde o PABX envia relatórios de desfecho de chamadas, duração e tarifação."
            >
              {(ids) => (
                <Input
                  id={ids.id}
                  value={form.voice.cdrWebhookUrl}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setForm({ ...form, voice: { ...form.voice, cdrWebhookUrl: e.target.value } })
                  }
                  className="font-mono text-xs"
                />
              )}
            </Field>

            <div className="pt-2 border-t border-slate-100">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Integração Discador de Voz IA (Voice-App)
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="URL da API do Voice-App"
                required
                tooltip="Endpoint HTTP onde o servidor Fastify/Node do discador de IA escuta ordens de originação de chamadas (ex: http://127.0.0.1:5050)."
              >
                {(ids) => (
                  <Input
                    id={ids.id}
                    value={form.voice.voiceAppBaseUrl}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setForm({ ...form, voice: { ...form.voice, voiceAppBaseUrl: e.target.value } })
                    }
                    className="font-mono text-xs"
                  />
                )}
              </Field>

              <Field
                label="Bearer Token do Voice-App"
                tooltip="Token secreto para autenticação mútua de chamadas entre o Voll Connect e o voice-app."
              >
                {(ids) => (
                  <Input
                    id={ids.id}
                    type="password"
                    placeholder="••••••••••••••••••••••••"
                    value={form.voice.voiceAppToken}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setForm({ ...form, voice: { ...form.voice, voiceAppToken: e.target.value } })
                    }
                    className="font-mono text-xs"
                  />
                )}
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="Cota Simultânea por Workspace"
                required
                tooltip="Limite de chamadas ativas simultâneas alocadas para este cliente/workspace (fair-sharing)."
              >
                {(ids) => (
                  <Input
                    id={ids.id}
                    type="number"
                    min={1}
                    value={form.voice.maxConcurrentPerWorkspace}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        voice: { ...form.voice, maxConcurrentPerWorkspace: Math.max(1, Number(e.target.value)) },
                      })
                    }
                    className="font-mono text-xs"
                  />
                )}
              </Field>

              <Field
                label="Capacidade Global do Pool"
                required
                tooltip="Capacidade física máxima de canais do tronco SIP/FreeSWITCH em operação."
              >
                {(ids) => (
                  <Input
                    id={ids.id}
                    type="number"
                    min={1}
                    value={form.voice.maxConcurrent}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        voice: { ...form.voice, maxConcurrent: Math.max(1, Number(e.target.value)) },
                      })
                    }
                    className="font-mono text-xs"
                  />
                )}
              </Field>
            </div>
          </div>
        </Card>

        {/* 3. Gateway SMS */}
        <Card
          title={
            <div className="flex items-center gap-2">
              <Smartphone className="size-4.5 text-amber-600" />
              <span>Gateway SMS (SMPP / REST)</span>
            </div>
          }
          tooltip="Endereços de host e portas para disparo de mensagens de texto SMS em massa."
          actions={
            <div className="flex items-center gap-2">
              {testResults.sms ? (
                <Badge tone="green" icon={<CheckCircle2 className="size-3" />}>
                  {testResults.sms.latencyMs}ms
                </Badge>
              ) : (
                <Badge tone="gray">Pronto</Badge>
              )}
              <Button
                size="sm"
                variant="secondary"
                loading={testingChannel === 'sms'}
                onClick={() => handleTest('sms')}
                icon={<RefreshCw className={`size-3.5 ${testingChannel === 'sms' ? 'animate-spin' : ''}`} />}
              >
                Testar
              </Button>
            </div>
          }
        >
          <div className="space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <Field
                  label="Host SMPP / Servidor SMS"
                  required
                  tooltip="Endereço do servidor da operadora ou agregador SMPP (ex: smpp.operadora.com)."
                >
                  {(ids) => (
                    <Input
                      id={ids.id}
                      value={form.sms.smppHost}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setForm({ ...form, sms: { ...form.sms, smppHost: e.target.value } })
                      }
                      className="font-mono text-xs"
                    />
                  )}
                </Field>
              </div>

              <Field
                label="Porta SMPP"
                required
                tooltip="Porta TCP de conexão SMPP (comum: 2775)."
              >
                {(ids) => (
                  <Input
                    id={ids.id}
                    type="number"
                    value={form.sms.smppPort}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setForm({ ...form, sms: { ...form.sms, smppPort: Number(e.target.value) } })
                    }
                    className="font-mono text-xs"
                  />
                )}
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="Shortcode / Remetente (Sender ID)"
                required
                tooltip="Número curto homologado ou identificador do remetente exibido para o cliente final."
              >
                {(ids) => (
                  <Input
                    id={ids.id}
                    value={form.sms.defaultSenderId}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setForm({ ...form, sms: { ...form.sms, defaultSenderId: e.target.value } })
                    }
                    className="font-mono text-xs"
                  />
                )}
              </Field>

              <Field
                label="Tipo de Conexão"
                tooltip="Protocolo utilizado para empacotamento das mensagens (SMPP binário ou API REST)."
              >
                {(ids) => (
                  <Input
                    id={ids.id}
                    value={form.sms.systemType}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setForm({ ...form, sms: { ...form.sms, systemType: e.target.value } })
                    }
                    className="font-mono text-xs"
                  />
                )}
              </Field>
            </div>

            <Field
              label="URL de Callback / Webhook de DLR"
              required
              tooltip="Endereço para recebimento de recibos de entrega (Delivery Receipts / DLR) da operadora."
            >
              {(ids) => (
                <Input
                  id={ids.id}
                  value={form.sms.dlrWebhookUrl}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setForm({ ...form, sms: { ...form.sms, dlrWebhookUrl: e.target.value } })
                  }
                  className="font-mono text-xs"
                />
              )}
            </Field>
          </div>
        </Card>

        {/* 4. E-mail Transacional */}
        <Card
          title={
            <div className="flex items-center gap-2">
              <Mail className="size-4.5 text-purple-600" />
              <span>E-mail Transacional (SMTP / API)</span>
            </div>
          }
          tooltip="Servidores SMTP, portas com TLS e webhooks de eventos de entrega e abertura de e-mails."
          actions={
            <div className="flex items-center gap-2">
              {testResults.email ? (
                <Badge tone="green" icon={<CheckCircle2 className="size-3" />}>
                  {testResults.email.latencyMs}ms
                </Badge>
              ) : (
                <Badge tone="gray">Pronto</Badge>
              )}
              <Button
                size="sm"
                variant="secondary"
                loading={testingChannel === 'email'}
                onClick={() => handleTest('email')}
                icon={<RefreshCw className={`size-3.5 ${testingChannel === 'email' ? 'animate-spin' : ''}`} />}
              >
                Testar
              </Button>
            </div>
          }
        >
          <div className="space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <Field
                  label="Host do Servidor SMTP"
                  required
                  tooltip="Endereço de saída do servidor SMTP (ex: smtp.sendgrid.net ou smtp.mailgun.org)."
                >
                  {(ids) => (
                    <Input
                      id={ids.id}
                      value={form.email.smtpHost}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setForm({ ...form, email: { ...form.email, smtpHost: e.target.value } })
                      }
                      className="font-mono text-xs"
                    />
                  )}
                </Field>
              </div>

              <Field
                label="Porta SMTP"
                required
                tooltip="Porta TCP recomendada (587 para STARTTLS, 465 para SSL/TLS)."
              >
                {(ids) => (
                  <Input
                    id={ids.id}
                    type="number"
                    value={form.email.smtpPort}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setForm({ ...form, email: { ...form.email, smtpPort: Number(e.target.value) } })
                    }
                    className="font-mono text-xs"
                  />
                )}
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="E-mail Remetente (From)"
                required
                tooltip="Endereço de e-mail autenticado com SPF/DKIM configurados no DNS."
              >
                {(ids) => (
                  <Input
                    id={ids.id}
                    type="email"
                    value={form.email.fromAddress}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setForm({ ...form, email: { ...form.email, fromAddress: e.target.value } })
                    }
                    className="font-mono text-xs"
                  />
                )}
              </Field>

              <Field
                label="Nome de Exibição"
                tooltip="Nome amigável apresentado no leitor de e-mail do destinatário."
              >
                {(ids) => (
                  <Input
                    id={ids.id}
                    value={form.email.fromName}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setForm({ ...form, email: { ...form.email, fromName: e.target.value } })
                    }
                    className="font-mono text-xs"
                  />
                )}
              </Field>
            </div>

            <Field
              label="Webhook de Eventos (Bounce e Abertura)"
              tooltip="URL HTTPS para recepção de notificações de entrega, abertura, cliques e erros de caixa postal."
            >
              {(ids) => (
                <Input
                  id={ids.id}
                  value={form.email.eventsWebhookUrl}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setForm({ ...form, email: { ...form.email, eventsWebhookUrl: e.target.value } })
                  }
                  className="font-mono text-xs"
                />
              )}
            </Field>
          </div>
        </Card>

        {/* 5. RCS Business Messaging */}
        <Card
          title={
            <div className="flex items-center gap-2">
              <Globe className="size-4.5 text-cyan-600" />
              <span>RCS Business Messaging (Google RBM)</span>
            </div>
          }
          tooltip="Endpoints e credenciais técnicas para envio de mensagens interativas ricas via protocolo RCS."
          actions={
            <div className="flex items-center gap-2">
              {testResults.rcs ? (
                <Badge tone="green" icon={<CheckCircle2 className="size-3" />}>
                  {testResults.rcs.latencyMs}ms
                </Badge>
              ) : (
                <Badge tone="gray">Pronto</Badge>
              )}
              <Button
                size="sm"
                variant="secondary"
                loading={testingChannel === 'rcs'}
                onClick={() => handleTest('rcs')}
                icon={<RefreshCw className={`size-3.5 ${testingChannel === 'rcs' ? 'animate-spin' : ''}`} />}
              >
                Testar
              </Button>
            </div>
          }
          className="lg:col-span-2"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field
              label="Endpoint API Google RBM"
              required
              tooltip="URL base da API Google Rich Business Messaging (v1)."
            >
              {(ids) => (
                <Input
                  id={ids.id}
                  value={form.rcs.rbmApiUrl}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setForm({ ...form, rcs: { ...form.rcs, rbmApiUrl: e.target.value } })
                  }
                  className="font-mono text-xs"
                />
              )}
            </Field>

            <Field
              label="Identificador do Agente RBM"
              required
              tooltip="E-mail ou ID do agente verificado no console Google RBM."
            >
              {(ids) => (
                <Input
                  id={ids.id}
                  value={form.rcs.agentId}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setForm({ ...form, rcs: { ...form.rcs, agentId: e.target.value } })
                  }
                  className="font-mono text-xs"
                />
              )}
            </Field>

            <Field
              label="URL de Webhook RCS"
              required
              tooltip="Endpoint onde chegam as confirmações de leitura e toques em botões interativos do RCS."
            >
              {(ids) => (
                <Input
                  id={ids.id}
                  value={form.rcs.webhookUrl}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setForm({ ...form, rcs: { ...form.rcs, webhookUrl: e.target.value } })
                  }
                  className="font-mono text-xs"
                />
              )}
            </Field>
          </div>
        </Card>
      </div>
    </div>
  );
}

function NewConnectionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('Discador IA · Tronco Direct Call');
  const [channelType, setChannelType] = useState<ChannelType>('VOICE');
  const [provider, setProvider] = useState('VOICE_APP');
  const [endpointUrl, setEndpointUrl] = useState('http://127.0.0.1:5050/v1/calls');
  const [callerId, setCallerId] = useState('+551140030000');
  const [authToken, setAuthToken] = useState('');
  const [tariff, setTariff] = useState('0.08');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [minDelay, setMinDelay] = useState(2);
  const [maxDelay, setMaxDelay] = useState(8);
  const [duplicateRate, setDuplicateRate] = useState(0.1);
  const [noReturnRate, setNoReturnRate] = useState(0.05);
  const [err, setErr] = useState<string | null>(null);

  const handleProviderChange = (newProv: string) => {
    setProvider(newProv);
    if (newProv === 'VOICE_APP') {
      setName('Discador IA · Tronco Direct Call');
      setChannelType('VOICE');
      setEndpointUrl('http://127.0.0.1:5050/v1/calls');
      setCallerId('+551140030000');
      setTariff('0.08');
    } else if (newProv === 'API_TRIGGER') {
      setName('API de Gatilhos & Disparos Voll Connect');
      setChannelType('VOICE');
      setEndpointUrl('https://api.voll.solutions/v1/campaigns/trigger');
      setCallerId('');
      setTariff('0.00');
    } else if (newProv === 'META_CLOUD') {
      setName('WhatsApp Oficial Meta Cloud');
      setChannelType('WHATSAPP');
      setEndpointUrl('https://graph.facebook.com/v21.0/messages');
      setCallerId('+5511980000000');
      setTariff('0.05');
    } else if (newProv === 'SIP_TRUNK') {
      setName('Tronco SIP Direto Direct Call');
      setChannelType('VOICE');
      setEndpointUrl('sip.voip.vollconnect.com.br:5060');
      setCallerId('+551140030000');
      setTariff('0.06');
    } else if (newProv === 'SIMULATED') {
      setName('Canal Simulado (Sandbox)');
      setEndpointUrl('');
      setCallerId('');
      setTariff('0.05');
    }
  };

  const m = useMutation({
    mutationFn: () =>
      post<Connection>('/connections', {
        name: name.trim(),
        channelType,
        provider: provider.trim() || 'VOICE_APP',
        endpointUrl: endpointUrl.trim() || null,
        callerId: callerId.trim() || null,
        authToken: authToken.trim() || null,
        tariff: tariff === '' ? null : Number(tariff),
        simulation:
          provider === 'SIMULATED' || showAdvanced
            ? {
                outcomes: { NO_ANSWER: 3, BUSY: 1, CPC_NO_DEAL: 2, CONVERSION: 1.5, OPT_OUT: 0.3, RESULT_UNKNOWN: 0.2 },
                minDelaySeconds: minDelay,
                maxDelaySeconds: maxDelay,
                duplicateRate,
                noReturnRate,
              }
            : null,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['connections'] });
      toast('success', `Canal "${res.name}" cadastrado com sucesso.`);
      setName('Discador IA · Tronco Direct Call');
      setChannelType('VOICE');
      setProvider('VOICE_APP');
      setTariff('0.08');
      setErr(null);
      onOpenChange(false);
    },
    onError: (e) => setErr(errorMessage(e)),
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Nova Conexão ou Canal de API"
      description="Cadastre um canal de voz integrado ao voice-app, API de gatilhos do Voll Connect ou conector oficial."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            variant="primary"
            loading={m.isPending}
            onClick={() => {
              if (!name.trim()) return setErr('Informe o nome da conexão');
              m.mutate();
            }}
          >
            Cadastrar canal
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {err && <div className="text-xs text-red-600 bg-red-50 p-2.5 rounded-lg border border-red-200">{err}</div>}

        <fieldset className="space-y-3.5 rounded-xl border border-slate-200/90 bg-slate-50/40 p-4">
          <legend className="px-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">Identificação &amp; Provedor</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Nome da conexão" required>
              {(p) => <Input id={p.id} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Discador IA · Tronco Direct Call" />}
            </Field>
            <Field label="Provedor do conector" required>
              {(p) => (
                <Select id={p.id} value={provider} onChange={(e) => handleProviderChange(e.target.value)}>
                  <option value="VOICE_APP">Voice-App IA (FreeSWITCH + Tronco Direct Call)</option>
                  <option value="API_TRIGGER">API de Gatilhos &amp; Webhooks Voll Connect</option>
                  <option value="META_CLOUD">Meta Cloud API Oficial (WhatsApp)</option>
                  <option value="SIP_TRUNK">Tronco SIP Direto (PABX / IP)</option>
                  <option value="SIMULATED">Simulado (Ambiente Sandbox de Demonstração)</option>
                  <option value="TWILIO">Twilio Voice / SMS</option>
                  <option value="SENDGRID">SendGrid E-mail</option>
                </Select>
              )}
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Tipo do canal" required>
              {(p) => (
                <Select id={p.id} value={channelType} onChange={(e) => setChannelType(e.target.value as ChannelType)}>
                  <option value="VOICE">Discador (Voz)</option>
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="SMS">SMS / RCS</option>
                  <option value="EMAIL">E-mail</option>
                </Select>
              )}
            </Field>
            <Field label="Tarifa de referência por tentativa (R$)" tooltip="Custo estimado por envio para fins de cálculo de CPC. Deixe em branco se for desconhecido ou 0 para gratuito.">
              {(p) => (
                <Input
                  id={p.id}
                  type="number"
                  step="0.0001"
                  min="0"
                  value={tariff}
                  onChange={(e) => setTariff(e.target.value)}
                  placeholder="0,0800"
                />
              )}
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-3.5 rounded-xl border border-slate-200/90 bg-white p-4">
          <legend className="px-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">Conexão de API &amp; Gateway Técnico</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="URL do Endpoint / API Base" hint="Ex: http://127.0.0.1:5050/v1/calls ou https://api.voll.solutions/v1/trigger">
              {(p) => (
                <Input
                  id={p.id}
                  value={endpointUrl}
                  onChange={(e) => setEndpointUrl(e.target.value)}
                  placeholder="http://127.0.0.1:5050/v1/calls"
                />
              )}
            </Field>
            <Field label="Caller ID / BINA de Origem" hint="Número exibido no identificador de chamadas">
              {(p) => (
                <Input
                  id={p.id}
                  value={callerId}
                  onChange={(e) => setCallerId(e.target.value)}
                  placeholder="+551140030000"
                />
              )}
            </Field>
          </div>
          <Field label="Token / Chave de Autenticação (Opcional)" hint="Deixe vazio para usar a credencial técnica configurada no workspace.">
            {(p) => (
              <Input
                id={p.id}
                type="password"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                placeholder="Bearer token de serviço ou API Key"
              />
            )}
          </Field>
        </fieldset>

        {/* Botão de Parâmetros Avançados */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-slate-100/80 p-3.5 transition text-left"
          >
            <div className="flex items-center gap-2.5">
              <SlidersHorizontal className="size-4 text-brand-600" />
              <div>
                <div className="font-bold text-sm text-slate-800">Parâmetros avançados</div>
                <div className="text-xs text-slate-500">Simulação de webhooks, latências, duplicidades e resiliência</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {showAdvanced ? (
                <Badge tone="brand">Expandido</Badge>
              ) : provider === 'SIMULATED' ? (
                <Badge tone="amber">Sandbox</Badge>
              ) : (
                <Badge tone="gray">Opcional</Badge>
              )}
              <ChevronDown className={`size-4 text-slate-500 transition-transform duration-200 ${showAdvanced ? 'rotate-180' : ''}`} />
            </div>
          </button>

          {showAdvanced && (
            <div className="mt-3 space-y-4 rounded-xl border border-slate-200 bg-white p-4">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800">Latência e confiabilidade de entrega</span>
                  <span className="text-[11px] text-slate-500">Simulação de atrasos, duplicidades e timeouts</span>
                </div>
                <div className="grid gap-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Atraso mínimo (s)">
                    {(p) => <Input id={p.id} type="number" min={0} value={minDelay} onChange={(e) => setMinDelay(Number(e.target.value))} />}
                  </Field>
                  <Field label="Atraso máximo (s)">
                    {(p) => <Input id={p.id} type="number" min={0} value={maxDelay} onChange={(e) => setMaxDelay(Number(e.target.value))} />}
                  </Field>
                  <Field label="Webhook duplicado (0–1)">
                    {(p) => (
                      <Input id={p.id} type="number" step="0.05" min={0} max={1} value={duplicateRate} onChange={(e) => setDuplicateRate(Number(e.target.value))} />
                    )}
                  </Field>
                  <Field label="Taxa sem retorno (0–1)">
                    {(p) => (
                      <Input id={p.id} type="number" step="0.05" min={0} max={1} value={noReturnRate} onChange={(e) => setNoReturnRate(Number(e.target.value))} />
                    )}
                  </Field>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function EditConnection({ c, onClose }: { c: Connection; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const tabs = useQuery({ queryKey: ['tabulations'], queryFn: () => get<{ items: Tabulation[] }>('/tabulations') });
  const [name, setName] = useState(c.name);
  const [provider, setProvider] = useState(c.provider);
  const [endpointUrl, setEndpointUrl] = useState(c.endpointUrl || '');
  const [callerId, setCallerId] = useState(c.callerId || '');
  const [authToken, setAuthToken] = useState(c.authToken || '');
  const [tariff, setTariff] = useState(c.tariff === null ? '' : String(c.tariff).replace('.', ','));
  const [active, setActive] = useState(c.active);
  const [sim, setSim] = useState<Simulation | null>(c.simulation ?? null);
  const [showAdvanced, setShowAdvanced] = useState(c.provider === 'SIMULATED');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const m = useMutation({
    mutationFn: (body: unknown) => patch(`/connections/${c.id}`, body),
    onSuccess: () => {
      toast('success', 'Conexão atualizada com sucesso.');
      qc.invalidateQueries({ queryKey: ['connections'] });
      onClose();
    },
    onError: (e) => setErrors(e instanceof ApiError && Object.keys(e.fieldErrors).length ? e.fieldErrors : { form: errorMessage(e) }),
  });

  function save() {
    const e: Record<string, string> = {};
    let t: number | null = null;
    if (tariff.trim() !== '') {
      const norm = tariff.replace(/\./g, '').replace(',', '.');
      if (!/^\d+(\.\d{1,4})?$/.test(norm)) e.tariff = 'Valor não negativo com até 4 casas decimais (ex.: 0,0850)';
      else t = Number(norm);
    }
    if (!name.trim()) e.name = 'Informe o nome da conexão';
    if (sim && sim.minDelaySeconds > sim.maxDelaySeconds) e['simulation.maxDelaySeconds'] = 'Deve ser maior ou igual ao mínimo';
    setErrors(e);
    if (Object.keys(e).length) return;
    m.mutate({
      name: name.trim(),
      provider,
      endpointUrl: endpointUrl.trim() || null,
      callerId: callerId.trim() || null,
      authToken: authToken.trim() || null,
      tariff: t,
      active,
      simulation: sim,
    });
  }

  const outcomeCodes = sim ? Object.keys(sim.outcomes) : [];
  const tabName = (code: string) => {
    if (code === 'RESULT_UNKNOWN') return 'Resultado inconclusivo';
    return tabs.data?.items.find((t) => t.code === code)?.name ?? code;
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      wide
      title={`Configurar ${c.name}`}
      description={`Canal ${CHANNEL_LABEL[c.channelType]} · Provedor ${PROVIDER_SHORT_LABEL[c.provider] || c.provider}`}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={m.isPending} onClick={save}>
            Salvar alterações
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {errors.form && <Alert tone="error">{errors.form}</Alert>}

        <fieldset className="space-y-3.5 rounded-xl border border-slate-200/90 bg-slate-50/40 p-4">
          <legend className="px-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">Identificação &amp; Tarifação</legend>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <Field label="Nome da conexão" required error={errors.name}>
              {(p) => <Input id={p.id} value={name} aria-invalid={p.invalid} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <Field label="Provedor do conector" required>
              {(p) => (
                <Select id={p.id} value={provider} onChange={(e) => setProvider(e.target.value)}>
                  <option value="VOICE_APP">Voice-App IA (Tronco Direct Call / FreeSWITCH)</option>
                  <option value="API_TRIGGER">API de Gatilhos &amp; Webhooks Voll Connect</option>
                  <option value="META_CLOUD">Meta Cloud API Oficial (WhatsApp)</option>
                  <option value="SIP_TRUNK">Tronco SIP Direto (PABX / IP)</option>
                  <option value="SIMULATED">Simulado (Ambiente Sandbox de Demonstração)</option>
                  <option value="TWILIO">Twilio Voice / SMS</option>
                  <option value="SENDGRID">SendGrid E-mail</option>
                </Select>
              )}
            </Field>
          </div>

          <div className="grid items-start gap-4 sm:grid-cols-2">
            <Field label="Tarifa por tentativa enviada (R$)" error={errors.tariff} hint="Vazio = desconhecida · 0 = gratuita · até 4 casas decimais">
              {(p) => (
                <Input
                  id={p.id}
                  inputMode="decimal"
                  placeholder="desconhecida"
                  value={tariff}
                  aria-invalid={p.invalid}
                  aria-describedby={p.describedBy}
                  onChange={(e) => setTariff(e.target.value)}
                />
              )}
            </Field>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 h-[58px] self-end">
              <div>
                <div className="text-sm font-medium text-slate-800">Disponibilidade</div>
                <div className="text-xs text-slate-500">Permite despachar tentativas por este canal</div>
              </div>
              <Checkbox label="Conexão ativa" checked={active} onChange={(e) => setActive(e.target.checked)} />
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-3.5 rounded-xl border border-slate-200/90 bg-white p-4">
          <legend className="px-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">Conexão de API &amp; Gateway Técnico</legend>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <Field label="URL do Endpoint / API Base" hint="Ex: http://127.0.0.1:5050/v1/calls ou https://api.voll.solutions/v1/trigger">
              {(p) => (
                <Input
                  id={p.id}
                  value={endpointUrl}
                  onChange={(e) => setEndpointUrl(e.target.value)}
                  placeholder="http://127.0.0.1:5050/v1/calls"
                />
              )}
            </Field>
            <Field label="Caller ID / BINA de Origem" hint="Número exibido no identificador de chamadas ou remetente">
              {(p) => (
                <Input
                  id={p.id}
                  value={callerId}
                  onChange={(e) => setCallerId(e.target.value)}
                  placeholder="+551140030000"
                />
              )}
            </Field>
          </div>
          <Field label="Token / Chave de Autenticação (Bearer / Header)" hint="Opcional. Se vazio, utiliza a credencial técnica global do workspace.">
            {(p) => (
              <Input
                id={p.id}
                type="password"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                placeholder="••••••••••••••••••••••••••••••••"
              />
            )}
          </Field>
        </fieldset>

        {/* Botão de Parâmetros Avançados com seção retrátil */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-slate-100/80 p-3.5 transition text-left"
          >
            <div className="flex items-center gap-2.5">
              <SlidersHorizontal className="size-4 text-brand-600" />
              <div>
                <div className="font-bold text-sm text-slate-800">Parâmetros avançados</div>
                <div className="text-xs text-slate-500">Simulação de webhooks, latências, duplicidades e resiliência</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {sim ? (
                <Badge tone="amber">Simulação ativa</Badge>
              ) : (
                <Badge tone="gray">Sem simulação</Badge>
              )}
              <ChevronDown className={`size-4 text-slate-500 transition-transform duration-200 ${showAdvanced ? 'rotate-180' : ''}`} />
            </div>
          </button>

          {showAdvanced && (
            <div className="mt-3 space-y-4 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <span className="text-xs font-semibold text-slate-800">Modo de Testes e Simulação de Entrega</span>
                  <p className="text-[11px] text-slate-500">Útil para testar tolerância a falhas, reconciliação e atrasos de rede.</p>
                </div>
                {sim ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSim(null)}
                    className="text-xs text-red-600 hover:text-red-700"
                  >
                    Desativar simulação
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setSim({
                        outcomes: { NO_ANSWER: 3, BUSY: 1, CPC_NO_DEAL: 2, CONVERSION: 1.5, OPT_OUT: 0.3, RESULT_UNKNOWN: 0.2 },
                        minDelaySeconds: 2,
                        maxDelaySeconds: 8,
                        duplicateRate: 0.1,
                        noReturnRate: 0.05,
                      })
                    }
                  >
                    Habilitar parâmetros de simulação
                  </Button>
                )}
              </div>

              {sim && (
                <div className="space-y-4">
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-800">Pesos relativos de resultado (Webhooks)</span>
                      <span className="text-[11px] text-slate-500">Distribuição de probabilidade na demonstração</span>
                    </div>
                    <div className="grid gap-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3 sm:grid-cols-3">
                      {outcomeCodes.map((code) => (
                        <Field key={code} label={tabName(code)}>
                          {(p) => (
                            <Input
                              id={p.id}
                              type="number"
                              step="0.1"
                              min={0}
                              value={sim.outcomes[code]}
                              onChange={(e) => setSim({ ...sim, outcomes: { ...sim.outcomes, [code]: Math.max(0, Number(e.target.value)) } })}
                            />
                          )}
                        </Field>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-800">Latência e confiabilidade de entrega</span>
                      <span className="text-[11px] text-slate-500">Simulação de atrasos, duplicidades e timeouts</span>
                    </div>
                    <div className="grid gap-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Field label="Atraso mínimo (s)">
                        {(p) => <Input id={p.id} type="number" min={0} value={sim.minDelaySeconds} onChange={(e) => setSim({ ...sim, minDelaySeconds: Number(e.target.value) })} />}
                      </Field>
                      <Field label="Atraso máximo (s)" error={errors['simulation.maxDelaySeconds']}>
                        {(p) => (
                          <Input
                            id={p.id}
                            type="number"
                            min={0}
                            aria-invalid={p.invalid}
                            value={sim.maxDelaySeconds}
                            onChange={(e) => setSim({ ...sim, maxDelaySeconds: Number(e.target.value) })}
                          />
                        )}
                      </Field>
                      <Field label="Webhook duplicado (0–1)">
                        {(p) => (
                          <Input id={p.id} type="number" step="0.05" min={0} max={1} value={sim.duplicateRate} onChange={(e) => setSim({ ...sim, duplicateRate: Number(e.target.value) })} />
                        )}
                      </Field>
                      <Field label="Taxa sem retorno (0–1)">
                        {(p) => (
                          <Input id={p.id} type="number" step="0.05" min={0} max={1} value={sim.noReturnRate} onChange={(e) => setSim({ ...sim, noReturnRate: Number(e.target.value) })} />
                        )}
                      </Field>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
