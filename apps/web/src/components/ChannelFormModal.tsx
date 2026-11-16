import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, RefreshCw, ShieldCheck, Wifi } from 'lucide-react';
import { useState } from 'react';
import {
  CONNECTION_CHANNEL_LABEL,
  CONNECTION_CHANNEL_TYPES,
  DEFAULT_CHANNEL_ENDPOINTS,
  WEBRTC_MODES,
  WEBRTC_MODE_LABEL,
  type ChannelTechnicalOverrides,
  type ConnectionChannelType,
  type WebRtcMode,
} from '@voll/shared';
import { ApiError, errorMessage, patch, post, get } from '../lib/api';
import { useExperienceMode } from '../lib/experience-mode';
import type { Connection, ConnectionTestResult, Simulation, Tabulation } from '../lib/types';
import { Alert, Badge, Button, Checkbox, Field, Input, Modal, Select, useToast } from './ui';

type Props = {
  open: boolean;
  connection: Connection | null;
  isSuper: boolean;
  tenants: { id: string; name: string; voice?: string }[];
  onClose: () => void;
};

const PROVIDER_OPTIONS: { value: string; label: string }[] = [
  { value: 'VOICE_APP', label: 'Voice-App IA (Discador / Gateway Próprio)' },
  { value: 'SIP_TRUNK', label: 'Tronco SIP Direto (Operadora / Direct Call)' },
  { value: 'WEBRTC_NATIVE', label: 'WebRTC Nativo (Web Widget & WhatsApp Calling)' },
  { value: 'META_CLOUD', label: 'Meta Cloud API (WhatsApp Oficial)' },
  { value: 'API_TRIGGER', label: 'API / Webhook HTTP de Acionamento' },
  { value: 'SMPP', label: 'Gateway SMPP (SMS Corporativo)' },
  { value: 'SMTP', label: 'Relay SMTP (E-mail Transacional)' },
  { value: 'SIMULATED', label: 'Simulador Integrado (Sandbox)' },
];

const DEFAULT_SIM: Simulation = {
  outcomes: { NO_ANSWER: 3, BUSY: 1, CPC_NO_DEAL: 2, CONVERSION: 1.5, OPT_OUT: 0.3, RESULT_UNKNOWN: 0.2 },
  minDelaySeconds: 2,
  maxDelaySeconds: 8,
  duplicateRate: 0.1,
  noReturnRate: 0.05,
};

function parseAllowedOriginsInput(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

export function ChannelFormModal({ open, connection, isSuper, tenants, onClose }: Props) {
  const isEdit = Boolean(connection);
  const qc = useQueryClient();
  const toast = useToast();
  const { isAtLeast } = useExperienceMode();
  const isAdvancedMode = isAtLeast('advanced');

  const tabsQ = useQuery({
    queryKey: ['tabulations'],
    queryFn: () => get<{ items: Tabulation[] }>('/tabulations'),
    enabled: open && isEdit,
  });

  const [name, setName] = useState(connection?.name ?? 'Discador IA · Tronco Direct Call');
  const [channelType, setChannelType] = useState<ConnectionChannelType | 'RCS'>(connection?.channelType ?? 'VOICE');
  const [provider, setProvider] = useState(connection?.provider ?? 'VOICE_APP');
  const [active, setActive] = useState(connection?.active ?? true);
  const [tenantId, setTenantId] = useState(connection?.tenantId ?? (isEdit ? '' : tenants[0]?.id ?? ''));
  const [callerId, setCallerId] = useState(connection?.callerId ?? (isEdit ? '' : '+5511989785888'));
  const [endpointUrl, setEndpointUrl] = useState(
    connection?.endpointUrl ?? (isEdit ? '' : 'http://192.168.15.36:8090/v1/calls'),
  );
  const [authToken, setAuthToken] = useState('');
  const [tariff, setTariff] = useState(
    connection?.tariff !== undefined && connection?.tariff !== null
      ? String(connection.tariff).replace('.', ',')
      : isEdit
        ? ''
        : '0,08',
  );

  // WebRTC & WhatsApp
  const [webrtcMode, setWebrtcMode] = useState<WebRtcMode>(connection?.webrtcMode ?? 'BOTH');
  const [allowedOriginsText, setAllowedOriginsText] = useState((connection?.allowedOrigins ?? []).join(', '));
  const [whatsappPhoneNumberId, setWhatsappPhoneNumberId] = useState(connection?.whatsappPhoneNumberId ?? '');
  const [whatsappBusinessAccountId, setWhatsappBusinessAccountId] = useState(connection?.whatsappBusinessAccountId ?? '');
  const [whatsappVerifyToken, setWhatsappVerifyToken] = useState(connection?.whatsappVerifyToken ?? '');
  const [whatsappAppSecret, setWhatsappAppSecret] = useState('');
  const [whatsappAccessToken, setWhatsappAccessToken] = useState('');
  const [rotateWidgetKey, setRotateWidgetKey] = useState(false);

  // Protocol-specific technical overrides
  const initTech = connection?.technical;
  const [waApiBaseUrl, setWaApiBaseUrl] = useState(initTech?.whatsapp?.apiBaseUrl ?? DEFAULT_CHANNEL_ENDPOINTS.whatsapp.apiBaseUrl);
  const [waApiVersion, setWaApiVersion] = useState(initTech?.whatsapp?.apiVersion ?? DEFAULT_CHANNEL_ENDPOINTS.whatsapp.apiVersion);
  const [waWebhookUrl, setWaWebhookUrl] = useState(initTech?.whatsapp?.webhookUrl ?? DEFAULT_CHANNEL_ENDPOINTS.whatsapp.webhookUrl);

  const [voiceAppBaseUrl, setVoiceAppBaseUrl] = useState(initTech?.voice?.voiceAppBaseUrl ?? '');
  const [voiceAppToken, setVoiceAppToken] = useState('');
  const [webrtcGatewayUrl, setWebrtcGatewayUrl] = useState(initTech?.voice?.webrtcGatewayUrl ?? DEFAULT_CHANNEL_ENDPOINTS.voice.webrtcGatewayUrl);
  const [cdrWebhookUrl, setCdrWebhookUrl] = useState(initTech?.voice?.cdrWebhookUrl ?? DEFAULT_CHANNEL_ENDPOINTS.voice.cdrWebhookUrl);
  const [maxConcurrent, setMaxConcurrent] = useState(initTech?.voice?.maxConcurrent ?? DEFAULT_CHANNEL_ENDPOINTS.voice.maxConcurrent);
  const [maxConcurrentPerWorkspace, setMaxConcurrentPerWorkspace] = useState(
    initTech?.voice?.maxConcurrentPerWorkspace ?? DEFAULT_CHANNEL_ENDPOINTS.voice.maxConcurrentPerWorkspace,
  );
  const [sipServer, setSipServer] = useState(initTech?.voice?.sipServer ?? DEFAULT_CHANNEL_ENDPOINTS.voice.sipServer);
  const [sipPort, setSipPort] = useState(initTech?.voice?.sipPort ?? DEFAULT_CHANNEL_ENDPOINTS.voice.sipPort);
  const [sipTransport, setSipTransport] = useState<'UDP' | 'TCP' | 'TLS'>(initTech?.voice?.sipTransport ?? DEFAULT_CHANNEL_ENDPOINTS.voice.sipTransport);

  const [smppHost, setSmppHost] = useState(initTech?.sms?.smppHost ?? DEFAULT_CHANNEL_ENDPOINTS.sms.smppHost);
  const [smppPort, setSmppPort] = useState(initTech?.sms?.smppPort ?? DEFAULT_CHANNEL_ENDPOINTS.sms.smppPort);
  const [smsSystemType, setSmsSystemType] = useState(initTech?.sms?.systemType ?? DEFAULT_CHANNEL_ENDPOINTS.sms.systemType);
  const [smsDlrWebhookUrl, setSmsDlrWebhookUrl] = useState(initTech?.sms?.dlrWebhookUrl ?? DEFAULT_CHANNEL_ENDPOINTS.sms.dlrWebhookUrl);
  const [smsSenderId, setSmsSenderId] = useState(initTech?.sms?.defaultSenderId ?? DEFAULT_CHANNEL_ENDPOINTS.sms.defaultSenderId);

  const [smtpHost, setSmtpHost] = useState(initTech?.email?.smtpHost ?? DEFAULT_CHANNEL_ENDPOINTS.email.smtpHost);
  const [smtpPort, setSmtpPort] = useState(initTech?.email?.smtpPort ?? DEFAULT_CHANNEL_ENDPOINTS.email.smtpPort);
  const [smtpSecurity, setSmtpSecurity] = useState<'STARTTLS' | 'SSL' | 'TLS'>(
    initTech?.email?.smtpSecurity ?? DEFAULT_CHANNEL_ENDPOINTS.email.smtpSecurity,
  );
  const [smtpUser, setSmtpUser] = useState(initTech?.email?.smtpUser ?? '');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [fromAddress, setFromAddress] = useState(initTech?.email?.fromAddress ?? DEFAULT_CHANNEL_ENDPOINTS.email.fromAddress);
  const [fromName, setFromName] = useState(initTech?.email?.fromName ?? DEFAULT_CHANNEL_ENDPOINTS.email.fromName);
  const [emailEventsWebhookUrl, setEmailEventsWebhookUrl] = useState(
    initTech?.email?.eventsWebhookUrl ?? DEFAULT_CHANNEL_ENDPOINTS.email.eventsWebhookUrl,
  );

  const [rbmApiUrl, setRbmApiUrl] = useState(initTech?.rcs?.rbmApiUrl ?? DEFAULT_CHANNEL_ENDPOINTS.rcs.rbmApiUrl);
  const [rcsAgentId, setRcsAgentId] = useState(initTech?.rcs?.agentId ?? DEFAULT_CHANNEL_ENDPOINTS.rcs.agentId);
  const [rcsWebhookUrl, setRcsWebhookUrl] = useState(initTech?.rcs?.webhookUrl ?? DEFAULT_CHANNEL_ENDPOINTS.rcs.webhookUrl);

  const [sim, setSim] = useState<Simulation>(connection?.simulation ?? DEFAULT_SIM);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(isAdvancedMode);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  const isWebRtc = channelType === 'WEBRTC' || provider === 'WEBRTC_NATIVE';
  const isVoiceOrWebRtc = channelType === 'VOICE' || isWebRtc;
  const isSimulated = provider === 'SIMULATED';

  const handleProviderPreset = (nextProv: string) => {
    setProvider(nextProv);
    if (isEdit) return;
    if (nextProv === 'WEBRTC_NATIVE') {
      setName('Canal WebRTC · Web & WhatsApp Calling');
      setChannelType('WEBRTC');
      setEndpointUrl('');
      setCallerId('');
      setTariff('');
    } else if (nextProv === 'VOICE_APP') {
      setName('Discador IA · Tronco Direct Call');
      setChannelType('VOICE');
      setEndpointUrl('http://192.168.15.36:8090/v1/calls');
      setCallerId('+5511989785888');
      setTariff('0,08');
    } else if (nextProv === 'META_CLOUD') {
      setName('WhatsApp Oficial Meta Cloud');
      setChannelType('WHATSAPP');
      setEndpointUrl('https://graph.facebook.com/v21.0/messages');
      setCallerId('+5511980000000');
      setTariff('0,05');
    } else if (nextProv === 'SIP_TRUNK') {
      setName('Tronco SIP Direto');
      setChannelType('VOICE');
      setEndpointUrl('sip.voip.vollconnect.com.br:5060');
      setCallerId('+551140030000');
      setTariff('0,06');
    } else if (nextProv === 'SMPP') {
      setName('Gateway SMS Corporativo');
      setChannelType('SMS');
      setEndpointUrl('');
      setTariff('0,04');
    } else if (nextProv === 'SMTP') {
      setName('Relay E-mail Transacional');
      setChannelType('EMAIL');
      setEndpointUrl('');
      setTariff('0,01');
    } else if (nextProv === 'SIMULATED') {
      setName('Canal Simulado (Sandbox)');
      if (channelType === 'WEBRTC') setChannelType('VOICE');
      setEndpointUrl('');
      setCallerId('');
      setTariff('0,05');
    }
  };

  function buildTechnicalPayload(): ChannelTechnicalOverrides {
    if (channelType === 'WHATSAPP') {
      return {
        whatsapp: {
          apiBaseUrl: waApiBaseUrl.trim() || undefined,
          apiVersion: waApiVersion.trim() || undefined,
          webhookUrl: waWebhookUrl.trim() || undefined,
        },
      };
    }
    if (channelType === 'VOICE' || isWebRtc) {
      return {
        voice: {
          voiceAppBaseUrl: voiceAppBaseUrl.trim() || undefined,
          ...(voiceAppToken.trim() ? { voiceAppToken: voiceAppToken.trim() } : {}),
          webrtcGatewayUrl: webrtcGatewayUrl.trim() || undefined,
          cdrWebhookUrl: cdrWebhookUrl.trim() || undefined,
          maxConcurrent: Number(maxConcurrent) || 30,
          maxConcurrentPerWorkspace: Number(maxConcurrentPerWorkspace) || 10,
          sipServer: sipServer.trim() || undefined,
          sipPort: Number(sipPort) || 5060,
          sipTransport,
        },
      };
    }
    if (channelType === 'SMS') {
      return {
        sms: {
          smppHost: smppHost.trim() || undefined,
          smppPort: Number(smppPort) || 2775,
          systemType: smsSystemType.trim() || undefined,
          dlrWebhookUrl: smsDlrWebhookUrl.trim() || undefined,
          defaultSenderId: smsSenderId.trim() || undefined,
        },
      };
    }
    if (channelType === 'EMAIL') {
      return {
        email: {
          smtpHost: smtpHost.trim() || undefined,
          smtpPort: Number(smtpPort) || 587,
          smtpSecurity,
          smtpUser: smtpUser.trim() || undefined,
          ...(smtpPassword.trim() ? { smtpPassword: smtpPassword.trim() } : {}),
          fromAddress: fromAddress.trim() || undefined,
          fromName: fromName.trim() || undefined,
          eventsWebhookUrl: emailEventsWebhookUrl.trim() || undefined,
        },
      };
    }
    return {
      rcs: {
        rbmApiUrl: rbmApiUrl.trim() || undefined,
        agentId: rcsAgentId.trim() || undefined,
        webhookUrl: rcsWebhookUrl.trim() || undefined,
      },
    };
  }

  const testM = useMutation({
    mutationFn: () => {
      const payload = {
        channelType,
        provider,
        endpointUrl: endpointUrl.trim() || null,
        authToken: authToken.trim() || null,
        technical: buildTechnicalPayload(),
      };
      return isEdit && connection
        ? post<ConnectionTestResult>(`/connections/${connection.id}/test`, payload)
        : post<ConnectionTestResult>('/connections/test', payload);
    },
    onSuccess: (res) => {
      setTestResult(res);
      toast(res.ok ? 'success' : 'error', `${res.status}: ${res.details}`);
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const saveM = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEdit && connection
        ? patch<Connection>(`/connections/${connection.id}`, payload)
        : post<Connection>('/connections', payload),
    onSuccess: () => {
      toast('success', isEdit ? 'Canal atualizado com sucesso.' : 'Canal cadastrado com sucesso.');
      qc.invalidateQueries({ queryKey: ['connections'] });
      onClose();
    },
    onError: (e) => {
      setErrors(e instanceof ApiError && Object.keys(e.fieldErrors).length ? e.fieldErrors : { form: errorMessage(e) });
    },
  });

  function handleSave() {
    const nextErrors: Record<string, string> = {};
    if (!name.trim()) nextErrors.name = 'Informe o nome do canal';
    let parsedTariff: number | null = null;
    if (isSuper && tariff.trim() !== '') {
      const norm = tariff.replace(/\./g, '').replace(',', '.');
      if (!/^\d+(\.\d{1,4})?$/.test(norm)) {
        nextErrors.tariff = 'Informe um valor não negativo com até 4 casas decimais';
      } else {
        parsedTariff = Number(norm);
      }
    }
    if (sim.minDelaySeconds > sim.maxDelaySeconds) {
      nextErrors['simulation.maxDelaySeconds'] = 'Deve ser maior ou igual ao mínimo';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    const payload: Record<string, unknown> = {
      name: name.trim(),
      ...(!isEdit ? { channelType } : {}),
      provider: isWebRtc ? 'WEBRTC_NATIVE' : provider,
      active,
      ...(isVoiceOrWebRtc ? { tenantId: tenantId || null } : {}),
      ...(!isWebRtc ? { callerId: callerId.trim() || null } : {}),
      endpointUrl: endpointUrl.trim() || null,
      ...(authToken.trim() ? { authToken: authToken.trim() } : {}),
      ...(isSuper ? { tariff: parsedTariff } : {}),
      ...(isWebRtc
        ? {
            webrtcMode,
            allowedOrigins: parseAllowedOriginsInput(allowedOriginsText),
            ...(isEdit && rotateWidgetKey ? { rotateWidgetKey: true } : {}),
          }
        : {}),
      ...(isWebRtc || channelType === 'WHATSAPP'
        ? {
            whatsappPhoneNumberId: whatsappPhoneNumberId.trim() || null,
            whatsappBusinessAccountId: whatsappBusinessAccountId.trim() || null,
            whatsappVerifyToken: whatsappVerifyToken.trim() || null,
            ...(whatsappAppSecret.trim() ? { whatsappAppSecret: whatsappAppSecret.trim() } : {}),
            ...(whatsappAccessToken.trim() ? { whatsappAccessToken: whatsappAccessToken.trim() } : {}),
          }
        : {}),
      technical: buildTechnicalPayload(),
      ...(isSimulated ? { simulation: sim } : {}),
    };

    saveM.mutate(payload);
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={isEdit && connection ? `Configurar canal · ${connection.name}` : 'Novo canal'}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={saveM.isPending} onClick={handleSave}>
            {isEdit ? 'Salvar alterações' : 'Criar canal'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {errors.form && <Alert tone="error">{errors.form}</Alert>}

        {/* Bloco 1: Configurações Básicas (sempre visível) */}
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-600">Configurações Básicas</span>
            <Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} label="Canal ativo para uso" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome do canal" required error={errors.name}>
              {(p) => <Input id={p.id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Discador IA Principal" />}
            </Field>
            <Field label="Tipo de canal" required tooltip="Define o protocolo operacional deste canal.">
              {(p) => (
                <Select
                  id={p.id}
                  disabled={isEdit}
                  value={channelType}
                  onChange={(e) => setChannelType(e.target.value as ConnectionChannelType)}
                >
                  {CONNECTION_CHANNEL_TYPES.map((ct) => (
                    <option key={ct} value={ct}>
                      {CONNECTION_CHANNEL_LABEL[ct]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Provedor / Conector" tooltip="Origem de acionamento ou gateway utilizado por este canal.">
              {(p) => (
                <Select id={p.id} value={provider} onChange={(e) => handleProviderPreset(e.target.value)}>
                  {PROVIDER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {isVoiceOrWebRtc ? (
              <Field
                label="Agente de Voz padrão"
                tooltip="Usado como fallback quando nenhuma Rota de Entrada ou Campanha sobrescrever o agente."
              >
                {(p) => (
                  <Select id={p.id} value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
                    <option value="">Sem agente padrão (usa rotas ou padrão do workspace)</option>
                    {tenants.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} {t.voice ? `(${t.voice})` : ''}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : (
              <Field label="Identificador / Remetente (BINA)" tooltip="Número ou identificador padrão enviado nas comunicações.">
                {(p) => <Input id={p.id} value={callerId} onChange={(e) => setCallerId(e.target.value)} placeholder="+5511999999999" />}
              </Field>
            )}
          </div>

          {isVoiceOrWebRtc && !tenantId && (
            <Alert tone="warn">
              Canal sem agente padrão definido. Para atender chamadas, vincule um Agente de Voz ou configure uma Rota de Entrada em Telefonia → Rotas.
            </Alert>
          )}

          {isVoiceOrWebRtc && !isWebRtc && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="BINA Padrão (Caller ID)" tooltip="Número exibido ao destinatário nas chamadas de saída.">
                {(p) => <Input id={p.id} value={callerId} onChange={(e) => setCallerId(e.target.value)} placeholder="+551140030000" />}
              </Field>
              {isSuper && (
                <Field label="Tarifa por tentativa (R$)" error={errors.tariff} tooltip="Custo unitário aplicado a acionamentos por este canal.">
                  {(p) => <Input id={p.id} value={tariff} onChange={(e) => setTariff(e.target.value)} placeholder="0,0800" />}
                </Field>
              )}
            </div>
          )}
        </div>

        {/* Bloco 2: Configurações Avançadas & Endereços Técnicos (Revelação Progressiva 2A) */}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50/70 px-4 py-3 border-b border-slate-100">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-2 text-left text-xs font-bold uppercase tracking-wider text-slate-700 hover:text-brand-700"
            >
              {showAdvanced ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              <span>Configurações Avançadas &amp; Endereços Técnicos</span>
              <Badge tone="gray">{(CONNECTION_CHANNEL_LABEL as Record<string, string>)[channelType] ?? channelType}</Badge>
            </button>

            <Button
              type="button"
              size="sm"
              variant="secondary"
              icon={<Wifi className="size-3.5" />}
              loading={testM.isPending}
              onClick={() => testM.mutate()}
            >
              Testar conectividade
            </Button>
          </div>

          {testResult && (
            <div className="px-4 pt-3">
              <Alert tone={testResult.ok ? 'success' : 'error'}>
                <strong>{testResult.status}</strong> ({testResult.latencyMs}ms · HTTP {testResult.code}) — {testResult.details}
              </Alert>
            </div>
          )}

          {showAdvanced && (
            <div className="space-y-4 p-4">
              {!isSimulated && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="URL do Endpoint / API" tooltip="Endereço HTTP/WSS principal do conector ou gateway deste canal.">
                    {(p) => (
                      <Input
                        id={p.id}
                        value={endpointUrl}
                        onChange={(e) => setEndpointUrl(e.target.value)}
                        placeholder="https://..."
                      />
                    )}
                  </Field>
                  <Field
                    label="Token / Segredo de Autenticação"
                    tooltip="Deixe em branco na edição para preservar o segredo já armazenado."
                  >
                    {(p) => (
                      <Input
                        id={p.id}
                        type="password"
                        value={authToken}
                        onChange={(e) => setAuthToken(e.target.value)}
                        placeholder={connection?.hasAuthToken ? `${connection.authTokenMasked ?? '••••'} (preservado)` : 'Bearer token ou API key'}
                      />
                    )}
                  </Field>
                </div>
              )}

              {isSuper && (!isVoiceOrWebRtc || isWebRtc) && (
                <Field label="Tarifa por tentativa (R$)" error={errors.tariff}>
                  {(p) => <Input id={p.id} value={tariff} onChange={(e) => setTariff(e.target.value)} placeholder="0,0500" />}
                </Field>
              )}

              {/* Parâmetros específicos: VOICE / WEBRTC */}
              {isVoiceOrWebRtc && (
                <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/40 p-3">
                  <div className="text-xs font-semibold text-slate-700">Parâmetros de Telefonia &amp; Gateway</div>
                  {isWebRtc && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Modo WebRTC" tooltip="Define se este canal atende navegador (Web Widget), WhatsApp Calling ou ambos.">
                        {(p) => (
                          <Select id={p.id} value={webrtcMode} onChange={(e) => setWebrtcMode(e.target.value as WebRtcMode)}>
                            {WEBRTC_MODES.map((mode) => (
                              <option key={mode} value={mode}>
                                {WEBRTC_MODE_LABEL[mode]}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                      <Field label="Origens Permitidas (CORS)" tooltip="Domínios autorizados a incorporar o Web Widget (separados por vírgula).">
                        {(p) => (
                          <Input
                            id={p.id}
                            value={allowedOriginsText}
                            onChange={(e) => setAllowedOriginsText(e.target.value)}
                            placeholder="https://app.empresa.com.br, https://site.com.br"
                          />
                        )}
                      </Field>
                    </div>
                  )}

                  {isEdit && isWebRtc && connection?.publicWidgetKey && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                      <span className="font-mono text-slate-600">Chave Widget: {connection.publicWidgetKey}</span>
                      <Checkbox checked={rotateWidgetKey} onChange={(e) => setRotateWidgetKey(e.target.checked)} label="Rotacionar chave ao salvar" />
                    </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="URL da API do Voice-App">
                      {(p) => (
                        <Input
                          id={p.id}
                          value={voiceAppBaseUrl}
                          onChange={(e) => setVoiceAppBaseUrl(e.target.value)}
                          placeholder="http://127.0.0.1:8090"
                        />
                      )}
                    </Field>
                    <Field label="Bearer Token do Voice-App" tooltip="Preservado se deixado vazio durante edição.">
                      {(p) => (
                        <Input
                          id={p.id}
                          type="password"
                          value={voiceAppToken}
                          onChange={(e) => setVoiceAppToken(e.target.value)}
                          placeholder={connection?.hasVoiceAppToken ? `${connection.voiceAppTokenMasked ?? '••••'} (preservado)` : 'Token do gateway'}
                        />
                      )}
                    </Field>
                    <Field label="Gateway WebRTC (WSS)">
                      {(p) => <Input id={p.id} value={webrtcGatewayUrl} onChange={(e) => setWebrtcGatewayUrl(e.target.value)} />}
                    </Field>
                    <Field label="Webhook de Bilhetagem / CDR">
                      {(p) => <Input id={p.id} value={cdrWebhookUrl} onChange={(e) => setCdrWebhookUrl(e.target.value)} />}
                    </Field>
                    <Field label="Cota Simultânea por Workspace">
                      {(p) => (
                        <Input
                          id={p.id}
                          type="number"
                          min={1}
                          value={maxConcurrentPerWorkspace}
                          onChange={(e) => setMaxConcurrentPerWorkspace(Number(e.target.value) || 1)}
                        />
                      )}
                    </Field>
                    <Field label="Capacidade Global do Pool">
                      {(p) => (
                        <Input
                          id={p.id}
                          type="number"
                          min={1}
                          value={maxConcurrent}
                          onChange={(e) => setMaxConcurrent(Number(e.target.value) || 1)}
                        />
                      )}
                    </Field>
                  </div>

                  {!isWebRtc && (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field label="Servidor SIP">
                        {(p) => <Input id={p.id} value={sipServer} onChange={(e) => setSipServer(e.target.value)} />}
                      </Field>
                      <Field label="Porta SIP">
                        {(p) => (
                          <Input id={p.id} type="number" value={sipPort} onChange={(e) => setSipPort(Number(e.target.value) || 5060)} />
                        )}
                      </Field>
                      <Field label="Transporte SIP">
                        {(p) => (
                          <Select id={p.id} value={sipTransport} onChange={(e) => setSipTransport(e.target.value as 'UDP' | 'TCP' | 'TLS')}>
                            <option value="TLS">TLS</option>
                            <option value="UDP">UDP</option>
                            <option value="TCP">TCP</option>
                          </Select>
                        )}
                      </Field>
                    </div>
                  )}
                </div>
              )}

              {/* Parâmetros específicos: WHATSAPP & WEBRTC WhatsApp Calling */}
              {(channelType === 'WHATSAPP' || (isWebRtc && webrtcMode !== 'WEB')) && (
                <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/40 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                    <ShieldCheck className="size-3.5 text-emerald-600" />
                    <span>Meta WhatsApp Business / Calling</span>
                  </div>
                  {channelType === 'WHATSAPP' && (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field label="URL Base da API (Graph API)">
                        {(p) => <Input id={p.id} value={waApiBaseUrl} onChange={(e) => setWaApiBaseUrl(e.target.value)} />}
                      </Field>
                      <Field label="Versão da API">
                        {(p) => <Input id={p.id} value={waApiVersion} onChange={(e) => setWaApiVersion(e.target.value)} />}
                      </Field>
                      <Field label="URL de Webhook">
                        {(p) => <Input id={p.id} value={waWebhookUrl} onChange={(e) => setWaWebhookUrl(e.target.value)} />}
                      </Field>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Phone Number ID">
                      {(p) => <Input id={p.id} value={whatsappPhoneNumberId} onChange={(e) => setWhatsappPhoneNumberId(e.target.value)} />}
                    </Field>
                    <Field label="WABA ID (Business Account)">
                      {(p) => (
                        <Input id={p.id} value={whatsappBusinessAccountId} onChange={(e) => setWhatsappBusinessAccountId(e.target.value)} />
                      )}
                    </Field>
                    <Field label="Verify Token do Webhook">
                      {(p) => <Input id={p.id} value={whatsappVerifyToken} onChange={(e) => setWhatsappVerifyToken(e.target.value)} />}
                    </Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="App Secret (Meta)" tooltip="Preservado se mantido em branco na edição.">
                      {(p) => (
                        <Input
                          id={p.id}
                          type="password"
                          value={whatsappAppSecret}
                          onChange={(e) => setWhatsappAppSecret(e.target.value)}
                          placeholder={connection?.hasWhatsappAppSecret ? `${connection.whatsappAppSecretMasked ?? '••••'} (preservado)` : 'App Secret'}
                        />
                      )}
                    </Field>
                    <Field label="Access Token (Meta)" tooltip="Preservado se mantido em branco na edição.">
                      {(p) => (
                        <Input
                          id={p.id}
                          type="password"
                          value={whatsappAccessToken}
                          onChange={(e) => setWhatsappAccessToken(e.target.value)}
                          placeholder={connection?.hasWhatsappAccessToken ? `${connection.whatsappAccessTokenMasked ?? '••••'} (preservado)` : 'Access Token permanente'}
                        />
                      )}
                    </Field>
                  </div>
                </div>
              )}

              {/* Parâmetros específicos: SMS */}
              {channelType === 'SMS' && (
                <div className="grid gap-3 sm:grid-cols-2 rounded-lg border border-slate-200 bg-slate-50/40 p-3">
                  <Field label="Host SMPP / Gateway">
                    {(p) => <Input id={p.id} value={smppHost} onChange={(e) => setSmppHost(e.target.value)} />}
                  </Field>
                  <Field label="Porta SMPP">
                    {(p) => <Input id={p.id} type="number" value={smppPort} onChange={(e) => setSmppPort(Number(e.target.value) || 2775)} />}
                  </Field>
                  <Field label="System Type">
                    {(p) => <Input id={p.id} value={smsSystemType} onChange={(e) => setSmsSystemType(e.target.value)} />}
                  </Field>
                  <Field label="Remetente Padrão (Sender ID)">
                    {(p) => <Input id={p.id} value={smsSenderId} onChange={(e) => setSmsSenderId(e.target.value)} />}
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Webhook de DLR / Entrega">
                      {(p) => <Input id={p.id} value={smsDlrWebhookUrl} onChange={(e) => setSmsDlrWebhookUrl(e.target.value)} />}
                    </Field>
                  </div>
                </div>
              )}

              {/* Parâmetros específicos: EMAIL */}
              {channelType === 'EMAIL' && (
                <div className="grid gap-3 sm:grid-cols-3 rounded-lg border border-slate-200 bg-slate-50/40 p-3">
                  <Field label="Host SMTP">
                    {(p) => <Input id={p.id} value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />}
                  </Field>
                  <Field label="Porta SMTP">
                    {(p) => <Input id={p.id} type="number" value={smtpPort} onChange={(e) => setSmtpPort(Number(e.target.value) || 587)} />}
                  </Field>
                  <Field label="Segurança SMTP">
                    {(p) => (
                      <Select id={p.id} value={smtpSecurity} onChange={(e) => setSmtpSecurity(e.target.value as 'STARTTLS' | 'SSL' | 'TLS')}>
                        <option value="STARTTLS">STARTTLS</option>
                        <option value="SSL">SSL</option>
                        <option value="TLS">TLS</option>
                      </Select>
                    )}
                  </Field>
                  <Field label="Usuário SMTP">
                    {(p) => <Input id={p.id} value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} />}
                  </Field>
                  <Field label="Senha SMTP" tooltip="Preservada se mantida em branco na edição.">
                    {(p) => (
                      <Input
                        id={p.id}
                        type="password"
                        value={smtpPassword}
                        onChange={(e) => setSmtpPassword(e.target.value)}
                        placeholder={connection?.hasSmtpPassword ? `${connection.smtpPasswordMasked ?? '••••'} (preservada)` : 'Senha SMTP'}
                      />
                    )}
                  </Field>
                  <Field label="E-mail Remetente">
                    {(p) => <Input id={p.id} value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} />}
                  </Field>
                  <Field label="Nome do Remetente">
                    {(p) => <Input id={p.id} value={fromName} onChange={(e) => setFromName(e.target.value)} />}
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Webhook de Eventos (Bounce / Abertura)">
                      {(p) => <Input id={p.id} value={emailEventsWebhookUrl} onChange={(e) => setEmailEventsWebhookUrl(e.target.value)} />}
                    </Field>
                  </div>
                </div>
              )}

              {/* Simulação (Sandbox) */}
              {isSimulated && (
                <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                    <RefreshCw className="size-3.5" />
                    <span>Parâmetros do Simulador (Sandbox)</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <Field label="Delay mínimo (s)">
                      {(p) => (
                        <Input
                          id={p.id}
                          type="number"
                          min={0}
                          value={sim.minDelaySeconds}
                          onChange={(e) => setSim({ ...sim, minDelaySeconds: Number(e.target.value) || 0 })}
                        />
                      )}
                    </Field>
                    <Field label="Delay máximo (s)" error={errors['simulation.maxDelaySeconds']}>
                      {(p) => (
                        <Input
                          id={p.id}
                          type="number"
                          min={0}
                          value={sim.maxDelaySeconds}
                          onChange={(e) => setSim({ ...sim, maxDelaySeconds: Number(e.target.value) || 0 })}
                        />
                      )}
                    </Field>
                    <Field label="Duplicidade (0-1)">
                      {(p) => (
                        <Input
                          id={p.id}
                          type="number"
                          step="0.05"
                          min={0}
                          max={1}
                          value={sim.duplicateRate}
                          onChange={(e) => setSim({ ...sim, duplicateRate: Number(e.target.value) || 0 })}
                        />
                      )}
                    </Field>
                    <Field label="Sem retorno (0-1)">
                      {(p) => (
                        <Input
                          id={p.id}
                          type="number"
                          step="0.05"
                          min={0}
                          max={1}
                          value={sim.noReturnRate}
                          onChange={(e) => setSim({ ...sim, noReturnRate: Number(e.target.value) || 0 })}
                        />
                      )}
                    </Field>
                  </div>
                  {isEdit && (tabsQ.data?.items?.length ?? 0) > 0 && (
                    <div className="grid gap-2 sm:grid-cols-3 pt-1">
                      {tabsQ.data!.items.slice(0, 6).map((tab) => (
                        <Field key={tab.code} label={`Peso ${tab.name || tab.code}`}>
                          {(p) => (
                            <Input
                              id={p.id}
                              type="number"
                              step="0.5"
                              min={0}
                              value={sim.outcomes[tab.code] ?? 0}
                              onChange={(e) =>
                                setSim({
                                  ...sim,
                                  outcomes: { ...sim.outcomes, [tab.code]: Number(e.target.value) || 0 },
                                })
                              }
                            />
                          )}
                        </Field>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
