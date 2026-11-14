import { ApiError, errorMessage } from '../../lib/api';
import { Alert, Button } from '../../components/ui';

export type ClusterNode = {
  id?: string;
  host?: string;
  port?: number;
  connected?: boolean;
  healthy?: boolean;
  activeCalls?: number;
  url?: string;
};

export type GatewayStatus = {
  status?: string;
  uptimeSec?: number;
  activeCalls?: number;
  drachtioConnected?: boolean;
  freeSwitchCluster?: { totalNodes?: number; healthyNodes?: number; nodes?: ClusterNode[] };
  freeswitch?: { totalNodes?: number; healthyNodes?: number };
  whisperCluster?: { totalNodes?: number; healthyNodes?: number; nodes?: ClusterNode[] };
};

export type LiveCall = {
  callId: string;
  tenantId?: string;
  caller?: string;
  called?: string;
  direction?: string;
  startedAt?: string;
  maxDurationSec?: number;
  lineType?: string;
  deviceMode?: string;
  noiseProfile?: string;
  crosstalkMode?: string;
  isAgentTalking?: boolean;
  isMuted?: boolean;
  isHeld?: boolean;
  isRecording?: boolean;
  recordingPaused?: boolean;
  stsEngine?: string;
  attemptId?: string | null;
};

export type HistoryItem = {
  callId: string;
  tenantId?: string;
  caller?: string;
  called?: string;
  direction?: string;
  startedAt?: string;
  endedAt?: string;
  durationSec?: number;
  hangupReason?: string;
  tabulationCode?: string;
  costUsd?: number;
  recordingFile?: string | null;
  stsEngine?: string;
  amdResult?: string;
};

export type RecordingItem = {
  id: string;
  sizeBytes: number;
  createdAt: string;
  transcriptFile?: string | null;
};

export type TenantConfig = {
  id: string;
  name?: string;
  extension?: string | null;
  dids?: string[];
  instructions?: string;
  greetingInstructions?: string | null;
  stsEngine?: 'openai' | 'elevenlabs' | string;
  openaiPromptId?: string | null;
  voice?: string;
  openaiModel?: string;
  elevenlabsAgentId?: string | null;
  elevenlabsModel?: string;
  elevenlabsVoiceId?: string;
  maxConcurrentCalls?: number;
  maxCallsPerSecond?: number;
  maxDurationSec?: number;
  bargeinGraceSec?: number | null;
  bargeinLevel?: number | null;
  audioCodec?: string | null;
  dtmf?: { enabled?: boolean; debounceMs?: number } | null;
  active?: boolean;
  activeCalls?: number;
  amd?: { enabled?: boolean; mode?: string };
  stt?: { enabled?: boolean };
  crosstalkMode?: string;
  crosstalkFilter?: { mode?: string; ratio?: number; threshold?: number | null };
};

export type SipExtension = {
  id: string;
  name?: string;
  password?: string;
  effectiveCallerIdName?: string;
  context?: string;
  callgroup?: string;
  enabled?: boolean;
  registered?: boolean;
  registrationDetails?: {
    registered?: boolean;
    status?: string;
    ip?: string;
    port?: string | number;
    agent?: string;
  } | null;
};

export type SipConfig = {
  server?: string;
  domain?: string;
  port?: number | string;
  transport?: string;
};

export type TrunkItem = {
  id: string;
  name?: string;
  providerId?: string;
  proxy?: string;
  realm?: string;
  port?: number;
  register?: boolean;
  username?: string;
  direction?: string;
  maxChannels?: number;
  pingFreq?: number;
  codecs?: string;
  active?: boolean;
  ownerMode?: 'GLOBAL_DEFAULT' | 'TENANT_BYOK';
  isGlobalDefault?: boolean;
  readOnly?: boolean;
  live?: { state?: string; status?: string; pingMs?: number; calls?: number } | null;
};

export type ProviderItem = {
  id: string;
  name?: string;
  type?: string;
  http?: { url?: string; method?: string; headers?: Record<string, string>; bodyTemplate?: string; from?: string };
};

export type InboundRoute = {
  id: string;
  name?: string;
  trunkId?: string;
  didPattern?: string;
  callerPattern?: string;
  tenantId?: string;
  maxChannels?: number | null;
  amdMode?: string;
  bargeinGraceSec?: number | null;
  recordingEnabled?: string;
  crosstalkFilterMode?: string;
  active?: boolean;
};

export type OutboundRoute = {
  id: string;
  name?: string;
  trunkId?: string;
  pattern?: string;
  prepend?: string;
  callerIdNumber?: string;
  callerIdName?: string;
  active?: boolean;
};

export type AiProvider = {
  id: string;
  name?: string;
  active?: boolean;
  defaultModel?: string;
  defaultVoice?: string;
  audioCodec?: string;
  models?: string[];
  hasApiKey?: boolean;
  maskedApiKey?: string;
  byokConfigured?: boolean;
  maskedByokKey?: string;
  monthUsd?: number;
  allTimeUsd?: number;
  monthTokens?: number;
  monthCallsCount?: number;
};

export type AiStatementItem = {
  at?: string;
  timestamp?: string;
  provider?: string;
  model?: string;
  tenantId?: string;
  callId?: string;
  inputTokens?: number;
  outputTokens?: number;
  audioSeconds?: number;
  totalTokens?: number;
  costUsd?: number;
};

export type VoiceFeature = {
  id: string;
  name: string;
  category?: string;
  description?: string;
  active?: boolean;
  details?: string;
  test?: {
    passed?: boolean;
    latencyMs?: number;
    details?: string;
    message?: string;
    testedAt?: string;
  } | null;
};

export function fmtDuration(sec?: number | null): string {
  if (sec == null || Number.isNaN(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function elapsedSince(iso?: string): string {
  if (!iso) return '—';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  return fmtDuration(s);
}

export function fmtUptime(sec?: number | null): string {
  if (sec == null || Number.isNaN(sec)) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(sec % 60)}s`;
}

export function GatewayError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const notConfigured = error instanceof ApiError && error.status === 409;
  return (
    <Alert tone={notConfigured ? 'warn' : 'error'} title={notConfigured ? 'Gateway de voz não configurado' : 'Gateway de voz indisponível'}>
      <p>{errorMessage(error)}</p>
      {!notConfigured && (
        <Button size="sm" variant="secondary" className="mt-2" onClick={onRetry}>
          Tentar de novo
        </Button>
      )}
    </Alert>
  );
}
