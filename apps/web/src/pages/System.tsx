import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  XCircle,
  Cpu,
} from 'lucide-react';
import { get, post, errorMessage } from '../lib/api';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  useToast,
} from '../components/ui';

type AiStatusResponse = {
  configured: boolean;
  provider: 'OPENAI' | 'LOCAL_ASSISTANT';
  model: string;
};

type AiTestResponse = {
  ok: boolean;
  status?: number;
  latencyMs?: number;
  model?: string;
  message: string;
};

export function SystemPage() {
  const qc = useQueryClient();
  const toast = useToast();

  const [showKey, setShowKey] = useState(false);
  const [apiKey, setApiKey] = useState<string>(() => {
    try {
      return localStorage.getItem('vc_openai_api_key') ?? '';
    } catch {
      return '';
    }
  });

  const [model, setModel] = useState<string>(() => {
    try {
      return localStorage.getItem('vc_openai_model') || 'gpt-4o-mini';
    } catch {
      return 'gpt-4o-mini';
    }
  });

  const [orgId, setOrgId] = useState<string>(() => {
    try {
      return localStorage.getItem('vc_openai_org_id') ?? '';
    } catch {
      return '';
    }
  });

  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiTestResponse | null>(null);

  // Consulta do status atual do motor
  const statusQ = useQuery({
    queryKey: ['ai-status'],
    queryFn: () => get<AiStatusResponse>('/ai/status'),
  });

  const isConfigured = Boolean(apiKey.trim() || statusQ.data?.configured);
  const activeModel = statusQ.data?.model || model;

  // Salvar token e parâmetros
  const handleSave = async () => {
    setIsSaving(true);
    try {
      const cleanKey = apiKey.trim();
      const cleanModel = model.trim() || 'gpt-4o-mini';
      const cleanOrg = orgId.trim();

      localStorage.setItem('vc_openai_api_key', cleanKey);
      localStorage.setItem('vc_openai_model', cleanModel);
      if (cleanOrg) {
        localStorage.setItem('vc_openai_org_id', cleanOrg);
      } else {
        localStorage.removeItem('vc_openai_org_id');
      }

      await post('/ai/config', {
        apiKey: cleanKey,
        model: cleanModel,
      });

      await qc.invalidateQueries({ queryKey: ['ai-status'] });

      toast(
        'success',
        cleanKey
          ? `Token da OpenAI e modelo (${cleanModel}) salvos com sucesso!`
          : 'Token removido. Assistente utilizando o motor interativo padrão local.',
      );
    } catch (err) {
      toast('error', `Falha ao salvar configurações: ${errorMessage(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Testar conexão em tempo real
  const handleTestConnection = async () => {
    const keyToTest = apiKey.trim();
    if (!keyToTest) {
      toast('info', 'Informe o token da OpenAI para realizar o teste de conectividade.');
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const res = await post<AiTestResponse>('/ai/test', {
        apiKey: keyToTest,
        model: model.trim() || 'gpt-4o-mini',
      });
      setTestResult(res);

      if (res.ok) {
        toast('success', `Conexão bem-sucedida! Latência: ${res.latencyMs ?? 0}ms.`);
      } else {
        toast('error', res.message || 'Falha ao autenticar com a OpenAI.');
      }
    } catch (err) {
      const errRes: AiTestResponse = {
        ok: false,
        message: errorMessage(err),
      };
      setTestResult(errRes);
      toast('error', `Erro ao testar conexão: ${errorMessage(err)}`);
    } finally {
      setIsTesting(false);
    }
  };

  // Limpar chave / Restaurar padrão
  const handleClearKey = async () => {
    setApiKey('');
    setTestResult(null);
    try {
      localStorage.removeItem('vc_openai_api_key');
      localStorage.removeItem('vc_openai_org_id');
      await post('/ai/config', {
        apiKey: '',
        model: model || 'gpt-4o-mini',
      });
      await qc.invalidateQueries({ queryKey: ['ai-status'] });
      toast('info', 'Token da OpenAI removido. O sistema agora utiliza o assistente local integrado.');
    } catch (err) {
      toast('error', `Falha ao remover chave: ${errorMessage(err)}`);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        title="Sistema"
        subtitle="Configurações gerais da plataforma, credenciais da OpenAI API e parâmetros operacionais do Voll Connect."
      />

      {/* Grid Principal */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Coluna da Esquerda (2 cols): OpenAI API Token & Modelos */}
        <div className="space-y-6 lg:col-span-2">
          <Card
            title={
              <div className="flex items-center gap-2">
                <Sparkles className="size-5 text-brand-700" />
                <span>Integração com OpenAI API</span>
              </div>
            }
            actions={
              isConfigured ? (
                <Badge tone="green" icon={<CheckCircle2 className="size-3.5" />}>
                  OpenAI Ativa ({activeModel})
                </Badge>
              ) : (
                <Badge tone="gray">Assistente Local (Sem Token)</Badge>
              )
            }
          >
            <p className="text-sm text-slate-600">
              Configure sua chave de API pessoal ou corporativa da <strong>OpenAI</strong> para habilitar o
              motor GPT avançado na criação interativa e estruturação inteligente de campanhas omnichannel.
            </p>

            <div className="mt-5 space-y-4">
              {/* Campo API Key / Token */}
              <Field
                label="OpenAI API Token (Chave Secreta)"
                required
                hint="Sua chave inicia com 'sk-...' e é armazenada com segurança no navegador e repassada às rotas de IA."
                tooltip="Obtenha sua chave diretamente no painel da OpenAI em platform.openai.com"
              >
                {(ids) => (
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <KeyRound className="size-4 text-slate-400" />
                    </div>
                    <Input
                      id={ids.id}
                      aria-describedby={ids.describedBy}
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-proj-..."
                      className="pl-9 pr-24 font-mono text-sm"
                    />
                    <div className="absolute inset-y-0 right-0 flex items-center pr-1.5 gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowKey(!showKey)}
                        title={showKey ? 'Ocultar token' : 'Visualizar token'}
                        className="px-2 text-slate-500 hover:text-slate-800"
                      >
                        {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </Button>
                      {apiKey && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            navigator.clipboard.writeText(apiKey);
                            toast('info', 'Token copiado para a área de transferência.');
                          }}
                          title="Copiar token"
                          className="px-2 text-slate-500 hover:text-slate-800"
                        >
                          <Copy className="size-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </Field>

              {/* Modelo OpenAI */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label="Modelo da OpenAI"
                  required
                  hint="Modelo padrão utilizado para interpretação de objetivos e regras."
                >
                  {(ids) => (
                    <Select
                      id={ids.id}
                      aria-describedby={ids.describedBy}
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                    >
                      <option value="gpt-4o-mini">gpt-4o-mini (Recomendado · Rápido e econômico)</option>
                      <option value="gpt-4o">gpt-4o (Avançado · Alta capacidade de raciocínio)</option>
                      <option value="gpt-4.1-mini">gpt-4.1-mini (Nova geração ultra veloz)</option>
                      <option value="gpt-4.1">gpt-4.1 (Nova geração topo de linha)</option>
                    </Select>
                  )}
                </Field>

                <Field
                  label="Organization / Project ID (Opcional)"
                  hint="Necessário apenas para contas corporativas com multi-organizações."
                >
                  {(ids) => (
                    <Input
                      id={ids.id}
                      aria-describedby={ids.describedBy}
                      type="text"
                      value={orgId}
                      onChange={(e) => setOrgId(e.target.value)}
                      placeholder="org-... ou proj-..."
                      className="font-mono text-sm"
                    />
                  )}
                </Field>
              </div>

              {/* Resultado do Teste de Conexão */}
              {testResult && (
                <div
                  className={`flex items-start gap-3 rounded-lg border p-3.5 text-sm ${
                    testResult.ok
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                      : 'border-rose-200 bg-rose-50 text-rose-900'
                  }`}
                >
                  {testResult.ok ? (
                    <CheckCircle2 className="size-5 shrink-0 text-emerald-600 mt-0.5" />
                  ) : (
                    <XCircle className="size-5 shrink-0 text-rose-600 mt-0.5" />
                  )}
                  <div className="space-y-1">
                    <div className="font-semibold">
                      {testResult.ok ? 'Conexão com a OpenAI Validada!' : 'Falha na Conexão com a OpenAI'}
                    </div>
                    <div className="text-xs opacity-90">{testResult.message}</div>
                    {testResult.latencyMs !== undefined && (
                      <div className="text-xs font-mono opacity-80">
                        Latência de resposta: {testResult.latencyMs} ms · Modelo: {testResult.model || model}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Botões de Ação */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="primary"
                    onClick={handleSave}
                    loading={isSaving}
                    icon={<Sparkles className="size-4" />}
                  >
                    Salvar Configurações
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleTestConnection}
                    loading={isTesting}
                    disabled={!apiKey.trim()}
                    icon={<RefreshCw className={`size-4 ${isTesting ? 'animate-spin' : ''}`} />}
                  >
                    Testar Conexão
                  </Button>
                </div>

                {apiKey && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleClearKey}
                    className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                    icon={<Trash2 className="size-4" />}
                  >
                    Remover Token
                  </Button>
                )}
              </div>
            </div>
          </Card>

          {/* Card de Informações e Ajuda */}
          <Card
            title={
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-5 text-emerald-600" />
                <span>Privacidade, Segurança e Fallback Automático</span>
              </div>
            }
          >
            <div className="space-y-3 text-sm text-slate-600 leading-relaxed">
              <p>
                • <strong>Segurança do Token:</strong> Sua chave de API é enviada via TLS criptografada e nunca
                é compartilhada com outros clientes ou terceiros.
              </p>
              <p>
                • <strong>Fallback Automático Inteligente:</strong> Caso ocorra indisponibilidade temporária na
                OpenAI, limite de cota de requisições excedido ou falta de saldo, o sistema aciona de forma
                transparente o <strong>Assistente Interativo Integrado Voll Connect</strong>, garantindo que
                sua operação nunca pare.
              </p>
              <p>
                • <strong>Criação Interativa em Tempo Real:</strong> Com o token ativo, ao navegar para a tela de{' '}
                <a href="/campanhas/nova" className="font-medium text-brand-700 underline">
                  Nova Campanha
                </a>
                , o assistente extrai automaticamente regras de canais, filtros de CPC, ordenação de mailing e horários.
              </p>
            </div>
          </Card>
        </div>

        {/* Coluna da Direita (1 col): Status do Sistema e Conectividade */}
        <div className="space-y-6">
          <Card
            title={
              <div className="flex items-center gap-2">
                <Server className="size-5 text-slate-700" />
                <span>Status da Plataforma</span>
              </div>
            }
          >
            <ul className="divide-y divide-slate-100 text-sm">
              <li className="py-2.5 flex items-center justify-between">
                <span className="text-slate-600">Core Connect</span>
                <span className="font-mono text-xs font-semibold text-slate-800">v2.4.0-omnichannel</span>
              </li>
              <li className="py-2.5 flex items-center justify-between">
                <span className="text-slate-600">Ambiente</span>
                <Badge tone="blue">Operacional / Demonstração</Badge>
              </li>
              <li className="py-2.5 flex items-center justify-between">
                <span className="text-slate-600">Fuso Horário Padrão</span>
                <span className="text-xs font-medium text-slate-700">America/Sao_Paulo (UTC-3)</span>
              </li>
              <li className="py-2.5 flex items-center justify-between">
                <span className="text-slate-600">Motor de IA Ativo</span>
                <Badge tone={isConfigured ? 'green' : 'gray'}>
                  {isConfigured ? 'OpenAI GPT' : 'Motor Voll Integrado'}
                </Badge>
              </li>
            </ul>

            <div className="mt-4 pt-3 border-t border-slate-100">
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:text-brand-800 underline"
              >
                Gerenciar chaves na OpenAI
                <ExternalLink className="size-3" />
              </a>
            </div>
          </Card>

          <Card
            title={
              <div className="flex items-center gap-2">
                <Cpu className="size-5 text-slate-700" />
                <span>Conectores Operacionais</span>
              </div>
            }
          >
            <div className="space-y-2.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-600">WhatsApp Cloud API</span>
                <Badge tone="green">Ativo</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Discador Preditivo & SIP</span>
                <Badge tone="green">Ativo</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Gateway SMS</span>
                <Badge tone="green">Ativo</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">E-mail Transacional</span>
                <Badge tone="green">Ativo</Badge>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
