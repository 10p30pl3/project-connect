import { useEffect, useState } from 'react';
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
  Sparkles,
  Trash2,
  XCircle,
  Database,
} from 'lucide-react';
import { errorMessage, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  InfoTooltip,
  Input,
  Modal,
  PageHeader,
  Select,
  useToast,
} from '../components/ui';

type AiStatusResponse = {
  configured: boolean;
  provider: 'OPENAI' | 'LOCAL_ASSISTANT';
  model: string;
};

type AiConfigResponse = AiStatusResponse & {
  orgId?: string;
  maskedApiKey?: string;
};

type AiTestResponse = {
  ok: boolean;
  status?: number;
  latencyMs?: number;
  model?: string;
  message: string;
};

export function SystemPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canControlSystem = can('control.write');

  const [showKey, setShowKey] = useState(false);
  const [apiKey, setApiKey] = useState<string>('');
  const [model, setModel] = useState<string>('gpt-4o-mini');
  const [orgId, setOrgId] = useState<string>('');

  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [isSeedingDemo, setIsSeedingDemo] = useState(false);
  const [testResult, setTestResult] = useState<AiTestResponse | null>(null);

  // Consulta do status atual e configuração persistida no PostgreSQL
  const statusQ = useQuery({
    queryKey: ['ai-status'],
    queryFn: () => get<AiStatusResponse>('/ai/status'),
  });

  const configQ = useQuery({
    queryKey: ['ai-config'],
    queryFn: () => get<AiConfigResponse>('/ai/config'),
  });

  useEffect(() => {
    if (!configQ.data) return;
    if (configQ.data.model) setModel(configQ.data.model);
    if (typeof configQ.data.orgId === 'string') setOrgId(configQ.data.orgId);
  }, [configQ.data]);

  const isConfigured = Boolean(apiKey.trim() || configQ.data?.configured || statusQ.data?.configured);
  const activeModel = configQ.data?.model || statusQ.data?.model || model;

  // Salvar token e parâmetros no PostgreSQL
  const handleSave = async () => {
    setIsSaving(true);
    try {
      const cleanKey = apiKey.trim();
      const cleanModel = model.trim() || 'gpt-4o-mini';
      const cleanOrg = orgId.trim();

      const res = await post<AiConfigResponse>('/ai/config', {
        ...(cleanKey ? { apiKey: cleanKey } : {}),
        model: cleanModel,
        orgId: cleanOrg,
      });

      setApiKey('');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['ai-status'] }),
        qc.invalidateQueries({ queryKey: ['ai-config'] }),
      ]);

      toast(
        'success',
        res.configured
          ? `Configuração da OpenAI e modelo (${cleanModel}) salvos no banco PostgreSQL!`
          : `Preferências (${cleanModel}) salvas. Sem chave ativa: usando assistente local.`,
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
    if (!keyToTest && !configQ.data?.configured) {
      toast('info', 'Informe o token da OpenAI para realizar o teste de conectividade.');
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const res = await post<AiTestResponse>('/ai/test', {
        ...(keyToTest ? { apiKey: keyToTest } : {}),
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
      await post('/ai/config', {
        apiKey: '',
        model: model || 'gpt-4o-mini',
        orgId,
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['ai-status'] }),
        qc.invalidateQueries({ queryKey: ['ai-config'] }),
      ]);
      toast('info', 'Token da OpenAI removido do banco. O sistema agora utiliza o assistente local integrado.');
    } catch (err) {
      toast('error', `Falha ao remover chave: ${errorMessage(err)}`);
    }
  };

  const handleResetToZero = () => {
    setResetConfirmText('');
    setConfirmResetOpen(true);
  };

  const executeResetToZero = async () => {
    if (resetConfirmText.trim().toUpperCase() !== 'ZERAR') return;
    setIsResetting(true);
    try {
      await post('/system/reset');
      await qc.invalidateQueries();
      setConfirmResetOpen(false);
      setResetConfirmText('');
      toast('success', 'Base de dados zerada com sucesso! Recursos de Telefonia e Agentes IA foram preservados.');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setIsResetting(false);
    }
  };

  const handleSeedDemo = async () => {
    setIsSeedingDemo(true);
    try {
      await post('/system/seed-demo');
      await qc.invalidateQueries();
      toast('success', 'Dados de exemplo (1.000 contatos) carregados com sucesso.');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setIsSeedingDemo(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        title="Sistema"
        tooltip="Configurações gerais da plataforma, credenciais da OpenAI API e parâmetros operacionais do Voll Plan."
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
            tooltip="Configure a chave de API da OpenAI para habilitar o motor GPT na criação interativa e estruturação inteligente de campanhas omnichannel."
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
            <div className="space-y-4">
              {/* Campo API Key / Token */}
              <Field
                label="OpenAI API Token"
                tooltip={
                  configQ.data?.maskedApiKey
                    ? `Chave atual salva no banco PostgreSQL: ${configQ.data.maskedApiKey}. Preencha apenas se desejar substituir.`
                    : "Chave secreta iniciada com 'sk-...'. Persistida no banco PostgreSQL do servidor para acionamento das rotas de inteligência artificial."
                }
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
                      placeholder={configQ.data?.maskedApiKey ? `Configurada (${configQ.data.maskedApiKey}) — digite para alterar` : 'sk-proj-...'}
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
                  tooltip="Modelo GPT utilizado pelo assistente interativo para interpretar objetivos, canais recomendados e regras de negócio da campanha."
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
                  label="Organization / Project ID"
                  tooltip="Identificador corporativo opcional (org-... ou proj-...) para contas OpenAI com múltiplos projetos ou equipes."
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
              {!canControlSystem && (
                <Alert tone="warn" title="Somente leitura">
                  Seu perfil não tem permissão para alterar tokens da OpenAI ou zerar dados do sistema.
                </Alert>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="primary"
                    onClick={handleSave}
                    loading={isSaving}
                    disabled={!canControlSystem}
                    icon={<Sparkles className="size-4" />}
                  >
                    Salvar Configurações
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleTestConnection}
                    loading={isTesting}
                    disabled={!canControlSystem || !apiKey.trim()}
                    icon={<RefreshCw className={`size-4 ${isTesting ? 'animate-spin' : ''}`} />}
                  >
                    Testar Conexão
                  </Button>
                </div>

                {apiKey && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={!canControlSystem}
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

          {/* Gerenciamento da Base de Dados (Zerar ou Seed Demo) */}
          <Card
            title={
              <div className="flex items-center gap-2">
                <Database className="size-5 text-slate-700" />
                <span>Gerenciamento da Base de Dados</span>
              </div>
            }
            tooltip="Controle do estado dos dados do workspace: comece com a base zerada para importar seus próprios arquivos ou recarregue a base de demonstração."
          >
            <div className="space-y-3 text-sm">
              <p className="text-slate-600">
                Gerencie o estado da base entre ambiente limpo para testes reais (preservando Telefonia e Agentes de IA) e dados de exemplo.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button
                  type="button"
                  variant="danger"
                  onClick={handleResetToZero}
                  loading={isResetting}
                  disabled={!canControlSystem}
                  icon={<Trash2 className="size-4" />}
                >
                  Zerar base de dados (Preservar Telefonia & IA)
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleSeedDemo}
                  loading={isSeedingDemo}
                  disabled={!canControlSystem}
                  icon={<RefreshCw className={`size-4 ${isSeedingDemo ? 'animate-spin' : ''}`} />}
                >
                  Carregar dados de exemplo (1.000 contatos)
                </Button>
              </div>
            </div>
          </Card>

          <Modal
            open={confirmResetOpen}
            onOpenChange={(o) => {
              if (!isResetting) setConfirmResetOpen(o);
            }}
            title="Zerar Base de Dados Operacional"
            footer={
              <>
                <Button
                  variant="secondary"
                  disabled={isResetting}
                  onClick={() => setConfirmResetOpen(false)}
                >
                  Cancelar
                </Button>
                <Button
                  variant="danger"
                  loading={isResetting}
                  disabled={resetConfirmText.trim().toUpperCase() !== 'ZERAR'}
                  onClick={executeResetToZero}
                >
                  Confirmar Reset Definitivo
                </Button>
              </>
            }
          >
            <div className="space-y-3 text-xs text-slate-600">
              <Alert tone="error" title="Atenção: operação irreversível">
                Todos os <strong>contatos, mailings, listas, campanhas, jornadas, estratégias e tentativas</strong> deste workspace serão apagados permanentemente. Recursos de <strong>Telefonia, Troncos, Ramais, Rotas, Billing e Agentes de IA</strong> serão preservados.
              </Alert>
              <Field label='Digite "ZERAR" para confirmar'>
                {(f) => (
                  <Input
                    id={f.id}
                    placeholder="ZERAR"
                    value={resetConfirmText}
                    onChange={(e) => setResetConfirmText(e.target.value)}
                    autoFocus
                  />
                )}
              </Field>
            </div>
          </Modal>
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
            tooltip="Informações de versão do núcleo Voll Plan, fuso horário operacional e motor de inteligência artificial em execução."
          >
            <ul className="divide-y divide-slate-100 text-sm">
              <li className="py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-1 text-slate-600">
                  <span>Core Plan</span>
                  <InfoTooltip content="Versão estável do microsserviço de orquestração de campanhas e contatos." />
                </div>
                <span className="font-mono text-xs font-semibold text-slate-800">v2.4.0-omnichannel</span>
              </li>
              <li className="py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-1 text-slate-600">
                  <span>Ambiente</span>
                  <InfoTooltip content="Modo de execução do sistema com conectores operacionais." />
                </div>
                <Badge tone="blue">Operacional / Demonstração</Badge>
              </li>
              <li className="py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-1 text-slate-600">
                  <span>Fuso Horário Padrão</span>
                  <InfoTooltip content="Fuso horário de referência para cálculo das janelas operacionais de disparo." />
                </div>
                <span className="text-xs font-medium text-slate-700">America/Sao_Paulo (UTC-3)</span>
              </li>
              <li className="py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-1 text-slate-600">
                  <span>Motor de IA Ativo</span>
                  <InfoTooltip content="Indica se as respostas interativas utilizam OpenAI GPT ou o Assistente Voll Integrado." />
                </div>
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
        </div>
      </div>
    </div>
  );
}
