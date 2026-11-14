import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Cpu,
  Edit,
  FlaskConical,
  Network,
  Play,
  Plus,
  Power,
  RefreshCw,
  Route,
  Sliders,
  Trash2,
} from 'lucide-react';
import { isSuperAdminRole } from '@voll/shared';
import { del, errorMessage, get, post, put } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDateTime } from '../../lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Empty,
  Field,
  Input,
  Loading,
  Modal,
  Select,
  Stat,
  TableWrap,
  Tabs,
  Textarea,
  useToast,
} from '../../components/ui';
import {
  GatewayError,
  type AiProvider,
  type AiStatementItem,
  type InboundRoute,
  type OutboundRoute,
  type ProviderItem,
  type TenantConfig,
  type TrunkItem,
  type VoiceFeature,
} from './types';

function TrunksAndProvidersPanel() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canManage = can('connections.write');
  const canGlobalTrunks = can('telephony.globalTrunks');

  const [editingTrunk, setEditingTrunk] = useState<any>(null);
  const [editingProv, setEditingProv] = useState<any>(null);
  const [deletingTrunk, setDeletingTrunk] = useState<TrunkItem | null>(null);
  const [deletingProv, setDeletingProv] = useState<ProviderItem | null>(null);

  const trunksQ = useQuery({
    queryKey: ['telephony', 'trunks'],
    queryFn: () => get<{ trunks: TrunkItem[] }>('/telephony/trunks'),
    refetchInterval: 10000,
    retry: false,
  });

  const providersQ = useQuery({
    queryKey: ['telephony', 'providers'],
    queryFn: () => get<{ providers: ProviderItem[] }>('/telephony/providers'),
    retry: false,
  });

  const saveTrunkM = useMutation({
    mutationFn: (payload: any) => post('/telephony/trunks', payload),
    onSuccess: () => {
      toast('success', 'Tronco SIP aplicado no FreeSWITCH!');
      setEditingTrunk(null);
      qc.invalidateQueries({ queryKey: ['telephony', 'trunks'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const trunkActionM = useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: 'register' | 'toggle' | 'delete'; body?: unknown }) => {
      if (action === 'delete') return del(`/telephony/trunks/${encodeURIComponent(id)}`);
      return post(`/telephony/trunks/${encodeURIComponent(id)}/${action}`, body ?? {});
    },
    onSuccess: (_r, vars) => {
      toast('success', `Ação "${vars.action}" executada no tronco ${vars.id}.`);
      qc.invalidateQueries({ queryKey: ['telephony', 'trunks'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const saveProvM = useMutation({
    mutationFn: (payload: any) => post('/telephony/providers', payload),
    onSuccess: () => {
      toast('success', 'Provedor salvo com sucesso.');
      setEditingProv(null);
      qc.invalidateQueries({ queryKey: ['telephony', 'providers'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const delProvM = useMutation({
    mutationFn: (id: string) => del(`/telephony/providers/${encodeURIComponent(id)}`),
    onSuccess: () => {
      toast('success', 'Provedor excluído.');
      qc.invalidateQueries({ queryKey: ['telephony', 'providers'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  if (trunksQ.isLoading) return <Loading />;
  if (trunksQ.error) return <GatewayError error={trunksQ.error} onRetry={() => trunksQ.refetch()} />;

  const trunks = trunksQ.data?.trunks ?? [];
  const providers = providersQ.data?.providers ?? [];
  const sipProviders = providers.filter((p) => !p.type || p.type === 'sip');

  return (
    <div className="space-y-6">
      <Card
        title="Troncos SIP (Sofia Gateways)"
        tooltip="Troncos conectados ao FreeSWITCH local para recepção de DIDs e disparo PSTN."
        actions={
          canManage && (
            <Button
              size="sm"
              variant="primary"
              icon={<Plus className="size-3.5" aria-hidden />}
              onClick={() =>
                setEditingTrunk({
                  isNew: true,
                  id: '',
                  name: '',
                  providerId: sipProviders[0]?.id || '',
                  proxy: '',
                  port: 5060,
                  register: true,
                  username: '',
                  password: '',
                  direction: 'both',
                  maxChannels: 30,
                  pingFreq: 25,
                  codecs: 'PCMU,PCMA',
                })
              }
            >
              Novo Tronco SIP
            </Button>
          )
        }
        padded={false}
      >
        {!trunks.length ? (
          <div className="p-6"><Empty title="Nenhum tronco SIP configurado" /></div>
        ) : (
          <TableWrap label="Troncos SIP">
            <table className="data w-full">
              <thead>
                <tr>
                  <th>Tronco / ID</th>
                  <th>Proxy SIP</th>
                  <th>Usuário / Registro</th>
                  <th>Status Sofia</th>
                  <th>Capacidade</th>
                  <th>Estado</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {trunks.map((t) => {
                  const liveState = String(t.live?.state || t.live?.status || '');
                  const reged = liveState.toUpperCase().includes('REGED') || liveState.toUpperCase().includes('UP');
                  return (
                    <tr key={t.id}>
                      <td>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-xs text-slate-900">{t.name || t.id}</span>
                          <Badge tone={t.isGlobalDefault ? 'brand' : 'gray'}>
                            {t.isGlobalDefault ? 'Padrão Global' : 'BYOK Empresa'}
                          </Badge>
                        </div>
                        <div className="font-mono text-[11px] text-slate-500">{t.id}</div>
                      </td>
                      <td className="font-mono text-xs">{t.proxy || t.realm || '—'}:{t.port ?? 5060}</td>
                      <td className="text-xs">
                        <div>{t.username || 'IP Auth'}</div>
                        <div className="text-[11px] text-slate-500">{t.register ? 'REGISTER' : 'Sem registro'} · {t.direction || 'both'}</div>
                      </td>
                      <td>
                        <Badge tone={reged ? 'green' : liveState ? 'amber' : 'gray'}>
                          {liveState || 'Desconhecido'}
                        </Badge>
                        {t.live?.pingMs != null && (
                          <div className="mt-0.5 font-mono text-[10px] text-slate-500">Ping: {t.live.pingMs}ms</div>
                        )}
                      </td>
                      <td className="text-xs tabular-nums">
                        {t.live?.calls != null ? `${t.live.calls} / ` : ''}
                        {t.maxChannels ?? 30} canais
                      </td>
                      <td>
                        <Badge tone={t.active !== false ? 'green' : 'red'}>
                          {t.active !== false ? 'Ativo' : 'Pausado'}
                        </Badge>
                      </td>
                      <td className="text-right whitespace-nowrap">
                        {t.readOnly ? (
                          <Badge tone="gray">Somente Leitura</Badge>
                        ) : canManage ? (
                          <div className="inline-flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="secondary"
                              title="Forçar registro Sofia"
                              onClick={() => trunkActionM.mutate({ id: t.id, action: 'register' })}
                            >
                              Registrar
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={<Power className="size-3.5" aria-hidden />}
                              onClick={() => trunkActionM.mutate({ id: t.id, action: 'toggle', body: { active: t.active === false } })}
                            />
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={<Edit className="size-3.5" aria-hidden />}
                              onClick={() =>
                                setEditingTrunk({
                                  isNew: false,
                                  id: t.id,
                                  name: t.name || t.id,
                                  providerId: t.providerId || '',
                                  proxy: t.proxy || t.realm || '',
                                  port: t.port ?? 5060,
                                  register: Boolean(t.register),
                                  username: t.username || '',
                                  password: '',
                                  direction: t.direction || 'both',
                                  maxChannels: t.maxChannels ?? 30,
                                  pingFreq: t.pingFreq ?? 25,
                                  codecs: t.codecs || '',
                                  isGlobalDefault: Boolean(t.isGlobalDefault),
                                })
                              }
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-red-600 hover:bg-red-50"
                              icon={<Trash2 className="size-3.5" aria-hidden />}
                              onClick={() => setDeletingTrunk(t)}
                            />
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      {/* Provedores */}
      <Card
        title="Provedores de Sinalização"
        actions={
          canGlobalTrunks && !providersQ.error && (
            <Button
              size="sm"
              variant="secondary"
              icon={<Plus className="size-3.5" aria-hidden />}
              onClick={() => setEditingProv({ isNew: true, id: '', name: '', type: 'sip', url: '', method: 'POST', from: '' })}
            >
              Novo Provedor
            </Button>
          )
        }
        padded={false}
      >
        {providersQ.error ? (
          <div className="p-4 text-xs text-slate-500">
            Provedores HTTP legados gerenciados via módulo Canais do Voll Plan ({errorMessage(providersQ.error)}).
          </div>
        ) : !providers.length ? (
          <div className="p-4 text-xs text-slate-500">Nenhum provedor cadastrado.</div>
        ) : (
          <TableWrap label="Provedores">
            <table className="data w-full">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Nome</th>
                  <th>Tipo</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => (
                  <tr key={p.id}>
                    <td className="font-mono text-xs">{p.id}</td>
                    <td className="text-xs font-medium">{p.name || p.id}</td>
                    <td><Badge tone="gray">{p.type || 'sip'}</Badge></td>
                    <td className="text-right">
                      {canGlobalTrunks && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:bg-red-50"
                          icon={<Trash2 className="size-3.5" aria-hidden />}
                          onClick={() => setDeletingProv(p)}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      {/* Modal Tronco */}
      <Modal
        open={!!editingTrunk}
        onOpenChange={(o) => !o && setEditingTrunk(null)}
        title={editingTrunk?.isNew ? 'Novo Tronco SIP' : `Editar Tronco: ${editingTrunk?.id}`}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditingTrunk(null)}>Cancelar</Button>
            <Button
              variant="primary"
              loading={saveTrunkM.isPending}
              disabled={!editingTrunk?.id?.trim() || !editingTrunk?.proxy?.trim()}
              onClick={() => {
                const payload: any = {
                  id: editingTrunk.id.trim().toLowerCase(),
                  name: editingTrunk.name.trim() || editingTrunk.id.trim(),
                  providerId: editingTrunk.providerId || undefined,
                  proxy: editingTrunk.proxy.trim(),
                  port: Number(editingTrunk.port) || 5060,
                  register: Boolean(editingTrunk.register),
                  username: editingTrunk.username.trim(),
                  direction: editingTrunk.direction,
                  maxChannels: Number(editingTrunk.maxChannels) || 30,
                  pingFreq: Number(editingTrunk.pingFreq) || 25,
                  codecs: editingTrunk.codecs.trim() || undefined,
                  isGlobalDefault: canGlobalTrunks ? Boolean(editingTrunk.isGlobalDefault) : false,
                };
                if (editingTrunk.password) payload.password = editingTrunk.password;
                saveTrunkM.mutate(payload);
              }}
            >
              Aplicar no FreeSWITCH
            </Button>
          </>
        }
      >
        {editingTrunk && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="ID" required>
                {(f) => (
                  <Input
                    id={f.id}
                    disabled={!editingTrunk.isNew}
                    value={editingTrunk.id}
                    onChange={(e) => setEditingTrunk({ ...editingTrunk, id: e.target.value })}
                    placeholder="directcall"
                  />
                )}
              </Field>
              <Field label="Nome" required>
                {(f) => (
                  <Input
                    id={f.id}
                    value={editingTrunk.name}
                    onChange={(e) => setEditingTrunk({ ...editingTrunk, name: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Direção">
                {(f) => (
                  <Select
                    id={f.id}
                    value={editingTrunk.direction}
                    onChange={(e) => setEditingTrunk({ ...editingTrunk, direction: e.target.value })}
                  >
                    <option value="both">Entrada e Saída</option>
                    <option value="outbound">Somente Saída</option>
                    <option value="inbound">Somente Entrada</option>
                  </Select>
                )}
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Proxy / Realm SIP" required>
                {(f) => (
                  <Input
                    id={f.id}
                    value={editingTrunk.proxy}
                    onChange={(e) => setEditingTrunk({ ...editingTrunk, proxy: e.target.value })}
                    placeholder="sip1.directdial.com.br"
                  />
                )}
              </Field>
              <Field label="Porta">
                {(f) => (
                  <Input
                    id={f.id}
                    type="number"
                    value={editingTrunk.port}
                    onChange={(e) => setEditingTrunk({ ...editingTrunk, port: Number(e.target.value) })}
                  />
                )}
              </Field>
              <Field label="Canais Máx.">
                {(f) => (
                  <Input
                    id={f.id}
                    type="number"
                    value={editingTrunk.maxChannels}
                    onChange={(e) => setEditingTrunk({ ...editingTrunk, maxChannels: Number(e.target.value) })}
                  />
                )}
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Codecs permitidos">
                {(f) => (
                  <Input
                    id={f.id}
                    value={editingTrunk.codecs}
                    onChange={(e) => setEditingTrunk({ ...editingTrunk, codecs: e.target.value })}
                    placeholder="PCMU,PCMA,OPUS"
                  />
                )}
              </Field>
              <Field label="Keepalive OPTIONS (s)">
                {(f) => (
                  <Input
                    id={f.id}
                    type="number"
                    value={editingTrunk.pingFreq}
                    onChange={(e) => setEditingTrunk({ ...editingTrunk, pingFreq: Number(e.target.value) })}
                  />
                )}
              </Field>
              <Field label="Provider ID (opcional)">
                {(f) => (
                  <Input
                    id={f.id}
                    value={editingTrunk.providerId}
                    onChange={(e) => setEditingTrunk({ ...editingTrunk, providerId: e.target.value })}
                    placeholder="directcall"
                  />
                )}
              </Field>
            </div>
            <Checkbox
              label="Autenticar com REGISTER (usuário/senha)"
              checked={editingTrunk.register}
              onChange={(e) => setEditingTrunk({ ...editingTrunk, register: e.target.checked })}
            />
            {canGlobalTrunks && (
              <Checkbox
                label="Compartilhar como Tronco Global Default para todas as empresas"
                checked={Boolean(editingTrunk.isGlobalDefault)}
                onChange={(e) => setEditingTrunk({ ...editingTrunk, isGlobalDefault: e.target.checked })}
              />
            )}
            {editingTrunk.register && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Usuário SIP">
                  {(f) => (
                    <Input
                      id={f.id}
                      value={editingTrunk.username}
                      onChange={(e) => setEditingTrunk({ ...editingTrunk, username: e.target.value })}
                    />
                  )}
                </Field>
                <Field label="Senha SIP (vazio = manter atual)">
                  {(f) => (
                    <Input
                      id={f.id}
                      type="password"
                      value={editingTrunk.password}
                      onChange={(e) => setEditingTrunk({ ...editingTrunk, password: e.target.value })}
                    />
                  )}
                </Field>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Modal Provedor */}
      <Modal
        open={!!editingProv}
        onOpenChange={(o) => !o && setEditingProv(null)}
        title="Novo Provedor"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditingProv(null)}>Cancelar</Button>
            <Button
              variant="primary"
              loading={saveProvM.isPending}
              disabled={!editingProv?.id?.trim()}
              onClick={() =>
                saveProvM.mutate({
                  id: editingProv.id.trim().toLowerCase(),
                  name: editingProv.name.trim() || editingProv.id.trim(),
                  type: editingProv.type || 'sip',
                })
              }
            >
              Salvar Provedor
            </Button>
          </>
        }
      >
        {editingProv && (
          <div className="space-y-3">
            <Field label="ID" required>
              {(f) => <Input id={f.id} value={editingProv.id} onChange={(e) => setEditingProv({ ...editingProv, id: e.target.value })} />}
            </Field>
            <Field label="Nome" required>
              {(f) => <Input id={f.id} value={editingProv.name} onChange={(e) => setEditingProv({ ...editingProv, name: e.target.value })} />}
            </Field>
            <Field label="Tipo">
              {(f) => (
                <Select id={f.id} value={editingProv.type} onChange={(e) => setEditingProv({ ...editingProv, type: e.target.value })}>
                  <option value="sip">SIP Trunk</option>
                  <option value="sms">HTTP SMS</option>
                  <option value="whatsapp">HTTP WhatsApp</option>
                </Select>
              )}
            </Field>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deletingTrunk}
        onOpenChange={(o) => !o && setDeletingTrunk(null)}
        title={`Remover tronco "${deletingTrunk?.name || deletingTrunk?.id}"?`}
        confirmLabel="Remover tronco"
        danger
        loading={trunkActionM.isPending}
        onConfirm={() => {
          if (!deletingTrunk) return;
          trunkActionM.mutate(
            { id: deletingTrunk.id, action: 'delete' },
            { onSettled: () => setDeletingTrunk(null) },
          );
        }}
      >
        Chamadas em andamento não são derrubadas, mas novas ligações PSTN vinculadas a este tronco deixarão de discar.
      </ConfirmDialog>

      <ConfirmDialog
        open={!!deletingProv}
        onOpenChange={(o) => !o && setDeletingProv(null)}
        title={`Remover provedor "${deletingProv?.name || deletingProv?.id}"?`}
        confirmLabel="Remover"
        danger
        loading={delProvM.isPending}
        onConfirm={() => {
          if (!deletingProv) return;
          delProvM.mutate(deletingProv.id, { onSettled: () => setDeletingProv(null) });
        }}
      >
        O provedor será removido da configuração de sinalização.
      </ConfirmDialog>
    </div>
  );
}

function InboundRoutesPanel() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canManage = can('connections.write');
  const canOperate = can('telephony.hangup');

  const [editing, setEditing] = useState<any>(null);
  const [deletingRoute, setDeletingRoute] = useState<InboundRoute | null>(null);
  const [simDid, setSimDid] = useState('');
  const [simCaller, setSimCaller] = useState('5511999998888');
  const [simTo, setSimTo] = useState('');
  const [simResult, setSimResult] = useState<any>(null);

  const routesQ = useQuery({ queryKey: ['telephony', 'routes'], queryFn: () => get<{ routes: InboundRoute[] }>('/telephony/routes'), retry: false });
  const tenantsQ = useQuery({ queryKey: ['telephony', 'tenants'], queryFn: () => get<{ tenants: TenantConfig[] }>('/telephony/tenants'), retry: false });
  const trunksQ = useQuery({ queryKey: ['telephony', 'trunks'], queryFn: () => get<{ trunks: TrunkItem[] }>('/telephony/trunks'), retry: false });

  const saveM = useMutation({
    mutationFn: (payload: any) => post('/telephony/routes', payload),
    onSuccess: () => {
      toast('success', 'Regra de entrada (DID) salva!');
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['telephony', 'routes'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const toggleM = useMutation({
    mutationFn: (r: InboundRoute) => put(`/telephony/routes/${encodeURIComponent(r.id)}`, { active: !r.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['telephony', 'routes'] }),
    onError: (e) => toast('error', errorMessage(e)),
  });

  const delM = useMutation({
    mutationFn: (id: string) => del(`/telephony/routes/${encodeURIComponent(id)}`),
    onSuccess: () => {
      toast('success', 'Regra excluída.');
      qc.invalidateQueries({ queryKey: ['telephony', 'routes'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const reorderM = useMutation({
    mutationFn: (ids: string[]) => post('/telephony/routes/reorder', { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['telephony', 'routes'] }),
    onError: (e) => toast('error', errorMessage(e)),
  });

  const simM = useMutation({
    mutationFn: () => post('/telephony/routes/simulate', { did: simDid.trim() || '*', callerId: simCaller.trim() }),
    onSuccess: (res) => setSimResult(res),
    onError: (e) => toast('error', errorMessage(e)),
  });

  const testCallM = useMutation({
    mutationFn: () =>
      post('/telephony/routes/test-call', {
        to: simTo.trim(),
        ...(simDid.startsWith('rule:') ? { ruleId: simDid.slice(5) } : { did: simDid.trim() || '*' }),
      }),
    onSuccess: () => toast('success', `Ligação de teste DID disparada para ${simTo.trim()}!`),
    onError: (e) => toast('error', errorMessage(e)),
  });

  if (routesQ.isLoading) return <Loading />;
  if (routesQ.error) return <GatewayError error={routesQ.error} onRetry={() => routesQ.refetch()} />;

  const routes = routesQ.data?.routes ?? [];
  const tenants = tenantsQ.data?.tenants ?? [];
  const trunks = trunksQ.data?.trunks ?? [];

  const move = (idx: number, dir: number) => {
    const ids = routes.map((r) => r.id);
    const target = idx + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[idx], ids[target]] = [ids[target], ids[idx]];
    reorderM.mutate(ids);
  };

  return (
    <div className="space-y-6">
      <Card
        title="Rotas de Entrada (Tronco + DID → Agente IA)"
        actions={
          canManage && (
            <Button
              size="sm"
              variant="primary"
              icon={<Plus className="size-3.5" aria-hidden />}
              onClick={() =>
                setEditing({
                  id: '',
                  name: '',
                  trunkId: trunks[0]?.id || '',
                  didPattern: '*',
                  callerPattern: '*',
                  tenantId: tenants[0]?.id || 'default',
                  maxChannels: '',
                  amdMode: 'tenant_default',
                  bargeinGraceSec: '',
                  recordingEnabled: 'tenant_default',
                  crosstalkFilterMode: 'tenant_default',
                  active: true,
                })
              }
            >
              Nova Regra DID
            </Button>
          )
        }
        padded={false}
      >
        {!routes.length ? (
          <div className="p-6"><Empty title="Nenhuma regra DID configurada" /></div>
        ) : (
          <TableWrap label="Rotas de entrada">
            <table className="data w-full">
              <thead>
                <tr>
                  <th>Ordem</th>
                  <th>Regra</th>
                  <th>DID / Caller ID</th>
                  <th>Tronco</th>
                  <th>Agente IA</th>
                  <th>Status</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((r, i) => (
                  <tr key={r.id}>
                    <td className="tabular-nums text-xs font-semibold">#{i + 1}</td>
                    <td className="text-xs font-semibold">{r.name || r.id}</td>
                    <td className="font-mono text-xs">
                      DID: {r.didPattern || '*'} · Origem: {r.callerPattern || '*'}
                    </td>
                    <td className="text-xs">{r.trunkId || 'Qualquer'}</td>
                    <td><Badge tone="brand">{r.tenantId || 'default'}</Badge></td>
                    <td><Badge tone={r.active !== false ? 'green' : 'red'}>{r.active !== false ? 'Ativa' : 'Inativa'}</Badge></td>
                    <td className="text-right whitespace-nowrap">
                      {canManage && (
                        <div className="inline-flex items-center gap-1">
                          <Button size="sm" variant="ghost" disabled={i === 0} icon={<ArrowUp className="size-3.5" aria-hidden />} onClick={() => move(i, -1)} />
                          <Button size="sm" variant="ghost" disabled={i === routes.length - 1} icon={<ArrowDown className="size-3.5" aria-hidden />} onClick={() => move(i, 1)} />
                          <Button size="sm" variant="secondary" icon={<Power className="size-3.5" aria-hidden />} onClick={() => toggleM.mutate(r)} />
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<Edit className="size-3.5" aria-hidden />}
                            onClick={() =>
                              setEditing({
                                id: r.id,
                                name: r.name || '',
                                trunkId: r.trunkId || '',
                                didPattern: r.didPattern || '*',
                                callerPattern: r.callerPattern || '*',
                                tenantId: r.tenantId || 'default',
                                maxChannels: r.maxChannels != null ? String(r.maxChannels) : '',
                                amdMode: r.amdMode || 'tenant_default',
                                bargeinGraceSec: r.bargeinGraceSec != null ? String(r.bargeinGraceSec) : '',
                                recordingEnabled: r.recordingEnabled || 'tenant_default',
                                crosstalkFilterMode: r.crosstalkFilterMode || 'tenant_default',
                                active: r.active !== false,
                              })
                            }
                          />
                          <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" icon={<Trash2 className="size-3.5" aria-hidden />} onClick={() => setDeletingRoute(r)} />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      {/* Simulador e Ligação de Teste */}
      <Card title="Simulador de Roteamento & Teste de Regra DID">
        <div className="grid gap-3 sm:grid-cols-4 items-end">
          <Field label="DID ou Prefixo">
            {(f) => (
              <Input id={f.id} value={simDid} onChange={(e) => setSimDid(e.target.value)} placeholder="5511989785888 ou rule:ID" />
            )}
          </Field>
          <Field label="Caller ID Simulado">
            {(f) => <Input id={f.id} value={simCaller} onChange={(e) => setSimCaller(e.target.value)} />}
          </Field>
          <Field label="Telefone para Ligação de Teste">
            {(f) => <Input id={f.id} value={simTo} onChange={(e) => setSimTo(e.target.value)} placeholder="5511999998888" />}
          </Field>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" loading={simM.isPending} onClick={() => simM.mutate()}>
              Simular (Dry-Run)
            </Button>
            {canOperate && (
              <Button size="sm" variant="primary" loading={testCallM.isPending} disabled={!simTo.trim()} onClick={() => testCallM.mutate()}>
                Testar Chamada
              </Button>
            )}
          </div>
        </div>
        {simResult && (
          <div className="mt-3 space-y-2">
            <div className="grid gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-xs sm:grid-cols-3">
              <div>
                <span className="text-slate-500">Regra aplicada:</span>{' '}
                <strong className="text-slate-900">{simResult.matchedRule?.name || simResult.matchedRule?.id || simResult.ruleId || 'Padrão / Nenhuma'}</strong>
              </div>
              <div>
                <span className="text-slate-500">Agente destino:</span>{' '}
                <strong className="text-brand-800">{simResult.resolvedTenantId || simResult.tenantId || 'default'}</strong>
              </div>
              <div>
                <span className="text-slate-500">Resultado:</span>{' '}
                <Badge tone={simResult.matched !== false ? 'green' : 'amber'}>
                  {simResult.matched !== false ? 'Roteamento Válido' : 'Sem correspondência'}
                </Badge>
              </div>
            </div>
            <details>
              <summary className="cursor-pointer text-[11px] font-medium text-slate-500 hover:text-slate-800">
                Ver resposta técnica JSON
              </summary>
              <pre className="mt-1.5 max-h-48 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-xs text-slate-100">
                {JSON.stringify(simResult, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </Card>

      <Modal
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing?.id ? 'Editar Regra DID' : 'Nova Regra DID'}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button
              variant="primary"
              loading={saveM.isPending}
              onClick={() =>
                saveM.mutate({
                  id: editing.id || undefined,
                  name: editing.name.trim() || 'Regra DID',
                  trunkId: editing.trunkId,
                  didPattern: editing.didPattern.trim() || '*',
                  callerPattern: editing.callerPattern.trim() || '*',
                  tenantId: editing.tenantId,
                  maxChannels: editing.maxChannels ? Number(editing.maxChannels) : null,
                  amdMode: editing.amdMode,
                  bargeinGraceSec: editing.bargeinGraceSec === '' ? null : Number(editing.bargeinGraceSec),
                  recordingEnabled: editing.recordingEnabled,
                  crosstalkFilterMode: editing.crosstalkFilterMode,
                  active: Boolean(editing.active),
                })
              }
            >
              Salvar Regra
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome da Regra">
                {(p) => <Input id={p.id} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />}
              </Field>
              <Field label="Agente Destino (Tenant)">
                {(p) => (
                  <Select id={p.id} value={editing.tenantId} onChange={(e) => setEditing({ ...editing, tenantId: e.target.value })}>
                    {tenants.map((t) => <option key={t.id} value={t.id}>{t.name || t.id}</option>)}
                  </Select>
                )}
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="DID Pattern">
                {(p) => <Input id={p.id} value={editing.didPattern} onChange={(e) => setEditing({ ...editing, didPattern: e.target.value })} />}
              </Field>
              <Field label="Caller Pattern">
                {(p) => <Input id={p.id} value={editing.callerPattern} onChange={(e) => setEditing({ ...editing, callerPattern: e.target.value })} />}
              </Field>
              <Field label="Tronco">
                {(p) => (
                  <Select id={p.id} value={editing.trunkId} onChange={(e) => setEditing({ ...editing, trunkId: e.target.value })}>
                    <option value="">Qualquer tronco</option>
                    {trunks.map((t) => <option key={t.id} value={t.id}>{t.name || t.id}</option>)}
                  </Select>
                )}
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="AMD">
                {(p) => (
                  <Select id={p.id} value={editing.amdMode} onChange={(e) => setEditing({ ...editing, amdMode: e.target.value })}>
                    <option value="tenant_default">Padrão do agente</option>
                    <option value="active">Ativo</option>
                    <option value="shadow">Shadow (apenas log)</option>
                    <option value="disabled">Desativado</option>
                  </Select>
                )}
              </Field>
              <Field label="Gravação">
                {(p) => (
                  <Select id={p.id} value={editing.recordingEnabled} onChange={(e) => setEditing({ ...editing, recordingEnabled: e.target.value })}>
                    <option value="tenant_default">Padrão do agente</option>
                    <option value="true">Forçar gravação</option>
                    <option value="false">Não gravar</option>
                  </Select>
                )}
              </Field>
              <Field label="Filtro Crosstalk">
                {(p) => (
                  <Select id={p.id} value={editing.crosstalkFilterMode} onChange={(e) => setEditing({ ...editing, crosstalkFilterMode: e.target.value })}>
                    <option value="tenant_default">Padrão do agente</option>
                    <option value="atual">DSP YIN F0</option>
                    <option value="wespeaker">WeSpeaker CAM++</option>
                    <option value="ecapa">ECAPA-TDNN</option>
                    <option value="none">Desligado</option>
                  </Select>
                )}
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Carência Saudação (s)" hint="Opcional — sobrescreve o padrão do agente nesta rota">
                {(p) => (
                  <Input
                    id={p.id}
                    type="number"
                    step="0.5"
                    placeholder="padrão do agente"
                    value={editing.bargeinGraceSec}
                    onChange={(e) => setEditing({ ...editing, bargeinGraceSec: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Máx. Canais Simultâneos na Rota" hint="Vazio = ilimitado">
                {(p) => (
                  <Input
                    id={p.id}
                    type="number"
                    placeholder="ilimitado"
                    value={editing.maxChannels}
                    onChange={(e) => setEditing({ ...editing, maxChannels: e.target.value })}
                  />
                )}
              </Field>
            </div>
            <Checkbox label="Regra ativa" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deletingRoute}
        onOpenChange={(o) => !o && setDeletingRoute(null)}
        title={`Excluir regra DID "${deletingRoute?.name || deletingRoute?.id}"?`}
        confirmLabel="Excluir"
        danger
        loading={delM.isPending}
        onConfirm={() => {
          if (!deletingRoute) return;
          delM.mutate(deletingRoute.id, { onSettled: () => setDeletingRoute(null) });
        }}
      >
        Chamadas recebidas passarão a cair na próxima regra correspondente da lista.
      </ConfirmDialog>
    </div>
  );
}

function OutboundRoutesPanel() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canManage = can('connections.write');
  const [editing, setEditing] = useState<any>(null);
  const [deletingRoute, setDeletingRoute] = useState<OutboundRoute | null>(null);
  const [regexTestNum, setRegexTestNum] = useState('5511999998888');

  const q = useQuery({ queryKey: ['telephony', 'outbound-routes'], queryFn: () => get<{ routes: OutboundRoute[] }>('/telephony/outbound-routes'), retry: false });
  const trunksQ = useQuery({ queryKey: ['telephony', 'trunks'], queryFn: () => get<{ trunks: TrunkItem[] }>('/telephony/trunks'), retry: false });

  const saveM = useMutation({
    mutationFn: (form: any) =>
      form.id
        ? put(`/telephony/outbound-routes/${encodeURIComponent(form.id)}`, form.payload)
        : post('/telephony/outbound-routes', form.payload),
    onSuccess: () => {
      toast('success', 'Rota de saída salva e dialplan FreeSWITCH sincronizado!');
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['telephony', 'outbound-routes'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const toggleM = useMutation({
    mutationFn: (id: string) => post(`/telephony/outbound-routes/${encodeURIComponent(id)}/toggle`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['telephony', 'outbound-routes'] }),
    onError: (e) => toast('error', errorMessage(e)),
  });

  const delM = useMutation({
    mutationFn: (id: string) => del(`/telephony/outbound-routes/${encodeURIComponent(id)}`),
    onSuccess: () => {
      toast('success', 'Rota de saída removida!');
      qc.invalidateQueries({ queryKey: ['telephony', 'outbound-routes'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const syncM = useMutation({
    mutationFn: () => post('/telephony/outbound-routes/sync', {}),
    onSuccess: () => toast('success', 'Dialplan de saída sincronizado no FreeSWITCH!'),
    onError: (e) => toast('error', errorMessage(e)),
  });

  const reorderM = useMutation({
    mutationFn: (ids: string[]) => post('/telephony/outbound-routes/reorder', { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['telephony', 'outbound-routes'] }),
    onError: (e) => toast('error', errorMessage(e)),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <GatewayError error={q.error} onRetry={() => q.refetch()} />;

  const routes = q.data?.routes ?? [];
  const trunks = trunksQ.data?.trunks ?? [];

  const move = (idx: number, dir: number) => {
    const ids = routes.map((r) => r.id);
    const target = idx + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[idx], ids[target]] = [ids[target], ids[idx]];
    reorderM.mutate(ids);
  };

  return (
    <div className="space-y-4">
      <Card
        title="Rotas de Saída PSTN (Dialplan FreeSWITCH)"
        actions={
          canManage && (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" loading={syncM.isPending} icon={<RefreshCw className="size-3.5" aria-hidden />} onClick={() => syncM.mutate()}>
                Sincronizar Dialplan
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon={<Plus className="size-3.5" aria-hidden />}
                onClick={() =>
                  setEditing({
                    id: '',
                    name: 'Rota PSTN',
                    trunkId: trunks[0]?.id || 'directcall',
                    pattern: '^(\\d{10,15})$',
                    prepend: '',
                    callerIdNumber: '5511989785888',
                    callerIdName: '5511989785888',
                    active: true,
                  })
                }
              >
                Nova Rota de Saída
              </Button>
            </div>
          )
        }
        padded={false}
      >
        {!routes.length ? (
          <div className="p-6"><Empty title="Nenhuma rota de saída configurada" /></div>
        ) : (
          <TableWrap label="Rotas de saída">
            <table className="data w-full">
              <thead>
                <tr>
                  <th>Ordem</th>
                  <th>Nome</th>
                  <th>Tronco</th>
                  <th>Regex Discagem</th>
                  <th>Caller ID</th>
                  <th>Status</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((r, i) => (
                  <tr key={r.id}>
                    <td className="tabular-nums text-xs font-semibold">#{i + 1}</td>
                    <td className="text-xs font-semibold">{r.name || r.id}</td>
                    <td><Badge tone="brand">{r.trunkId}</Badge></td>
                    <td className="font-mono text-xs">{r.pattern}{r.prepend ? ` (+${r.prepend})` : ''}</td>
                    <td className="font-mono text-xs">{r.callerIdNumber || '—'}</td>
                    <td><Badge tone={r.active !== false ? 'green' : 'red'}>{r.active !== false ? 'Ativa' : 'Inativa'}</Badge></td>
                    <td className="text-right whitespace-nowrap">
                      {canManage && (
                        <div className="inline-flex items-center gap-1">
                          <Button size="sm" variant="ghost" disabled={i === 0} icon={<ArrowUp className="size-3.5" aria-hidden />} onClick={() => move(i, -1)} />
                          <Button size="sm" variant="ghost" disabled={i === routes.length - 1} icon={<ArrowDown className="size-3.5" aria-hidden />} onClick={() => move(i, 1)} />
                          <Button size="sm" variant="secondary" icon={<Power className="size-3.5" aria-hidden />} onClick={() => toggleM.mutate(r.id)} />
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<Edit className="size-3.5" aria-hidden />}
                            onClick={() =>
                              setEditing({
                                id: r.id,
                                name: r.name || '',
                                trunkId: r.trunkId || '',
                                pattern: r.pattern || '^(\\d+)$',
                                prepend: r.prepend || '',
                                callerIdNumber: r.callerIdNumber || '',
                                callerIdName: r.callerIdName || '',
                                active: r.active !== false,
                              })
                            }
                          />
                          <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" icon={<Trash2 className="size-3.5" aria-hidden />} onClick={() => setDeletingRoute(r)} />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Modal
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing?.id ? 'Editar Rota de Saída' : 'Nova Rota de Saída'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button
              variant="primary"
              loading={saveM.isPending}
              onClick={() =>
                saveM.mutate({
                  id: editing.id,
                  payload: {
                    name: editing.name.trim() || 'Nova Rota PSTN',
                    trunkId: editing.trunkId,
                    pattern: editing.pattern.trim() || '^(\\d+)$',
                    prepend: editing.prepend.trim(),
                    callerIdNumber: editing.callerIdNumber.trim(),
                    callerIdName: editing.callerIdName.trim() || editing.callerIdNumber.trim(),
                    active: Boolean(editing.active),
                  },
                })
              }
            >
              Salvar Rota PSTN
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-3">
            <Field label="Nome">
              {(p) => <Input id={p.id} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />}
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tronco SIP">
                {(p) => (
                  <Select id={p.id} value={editing.trunkId} onChange={(e) => setEditing({ ...editing, trunkId: e.target.value })}>
                    {trunks.map((t) => <option key={t.id} value={t.id}>{t.name || t.id}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Pattern Regex">
                {(p) => <Input id={p.id} value={editing.pattern} onChange={(e) => setEditing({ ...editing, pattern: e.target.value })} />}
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Prefixo (Prepend)">
                {(p) => <Input id={p.id} value={editing.prepend} onChange={(e) => setEditing({ ...editing, prepend: e.target.value })} />}
              </Field>
              <Field label="Caller ID Número">
                {(p) => <Input id={p.id} value={editing.callerIdNumber} onChange={(e) => setEditing({ ...editing, callerIdNumber: e.target.value })} />}
              </Field>
              <Field label="Caller ID Nome">
                {(p) => <Input id={p.id} value={editing.callerIdName} onChange={(e) => setEditing({ ...editing, callerIdName: e.target.value })} />}
              </Field>
            </div>
            <Checkbox label="Rota ativa" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />

            {/* Validador Regex ao vivo */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                  Testador Regex em tempo real
                </span>
                {(() => {
                  try {
                    const re = new RegExp(editing.pattern || '^(\\d+)$');
                    const matched = re.test(regexTestNum.trim());
                    const finalDial = matched ? `${editing.prepend || ''}${regexTestNum.trim()}` : '—';
                    return (
                      <div className="flex items-center gap-2 text-xs">
                        <Badge tone={matched ? 'green' : 'red'}>
                          {matched ? `CASA → disca ${finalDial}` : 'NÃO CASA'}
                        </Badge>
                      </div>
                    );
                  } catch {
                    return <Badge tone="red">Regex inválida</Badge>;
                  }
                })()}
              </div>
              <Input
                value={regexTestNum}
                onChange={(e) => setRegexTestNum(e.target.value)}
                placeholder="Digite um número para testar a regex (ex: 5511999998888)"
                className="font-mono text-xs"
              />
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deletingRoute}
        onOpenChange={(o) => !o && setDeletingRoute(null)}
        title={`Remover rota de saída "${deletingRoute?.name || deletingRoute?.id}"?`}
        confirmLabel="Remover"
        danger
        loading={delM.isPending}
        onConfirm={() => {
          if (!deletingRoute) return;
          delM.mutate(deletingRoute.id, { onSettled: () => setDeletingRoute(null) });
        }}
      >
        O dialplan do FreeSWITCH será atualizado automaticamente após a remoção.
      </ConfirmDialog>
    </div>
  );
}

function AiProvidersAndCostsPanel() {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canManage = can('connections.write');
  const canSeeCosts = isSuperAdminRole(me?.role);

  const [editingProv, setEditingProv] = useState<any>(null);
  const [statementProvider, setStatementProvider] = useState<string>('openai');

  const provQ = useQuery({
    queryKey: ['telephony', 'ai-providers'],
    queryFn: () =>
      get<{
        viewMode?: string;
        providers: AiProvider[];
        monthCostTotalUsd?: number;
        monthCostTotalBrl?: number;
        monthDurationSec?: number;
        monthCallsCount?: number;
      }>('/telephony/ai-providers'),
    retry: false,
  });

  const statementQ = useQuery({
    queryKey: ['telephony', 'ai-statement', statementProvider],
    queryFn: () =>
      get<{ statement: AiStatementItem[]; summary?: any }>(
        `/telephony/ai-costs/statement?provider=${encodeURIComponent(statementProvider)}&limit=150`,
      ),
    enabled: canSeeCosts,
    retry: false,
  });

  const saveM = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => put(`/telephony/ai-providers/${encodeURIComponent(id)}`, payload),
    onSuccess: () => {
      toast('success', canSeeCosts ? 'Provedor de IA atualizado no gateway local!' : 'Credencial BYOK da empresa salva com criptografia AES-256.');
      setEditingProv(null);
      qc.invalidateQueries({ queryKey: ['telephony', 'ai-providers'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  if (provQ.isLoading) return <Loading />;
  if (provQ.error) return <GatewayError error={provQ.error} onRetry={() => provQ.refetch()} />;

  const providers = provQ.data?.providers ?? [];
  const statement = statementQ.data?.statement ?? [];
  const summary = statementQ.data?.summary ?? {};
  const mSec = provQ.data?.monthDurationSec ?? 0;
  const mFormatted = `${Math.floor(mSec / 60)}m ${String(mSec % 60).padStart(2, '0')}s`;

  return (
    <div className="space-y-6">
      {canSeeCosts ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Custo IA Mês (Total USD)" value={`US$ ${(provQ.data?.monthCostTotalUsd ?? 0).toFixed(4)}`} />
          <Stat label="Estimativa Mês (BRL)" value={`R$ ${(provQ.data?.monthCostTotalBrl ?? 0).toFixed(2)}`} />
          <Stat label="Requisições no Extrato" value={statement.length} />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Tempo de IA no Mês" value={mFormatted} hint="Somente tempo de atendimento" />
          <Stat label="Chamadas no Mês" value={provQ.data?.monthCallsCount ?? 0} />
          <Stat
            label="Modo de Credenciais"
            value={providers.some((p) => p.byokConfigured) ? 'BYOK Ativo' : 'Padrão Voll'}
            hint="Chaves próprias protegidas por AES-256"
          />
        </div>
      )}

      <Card title={canSeeCosts ? 'Motores & Credenciais de IA (Cluster Local)' : 'Motores & Chaves BYOK da Empresa'} padded={false}>
        <TableWrap label="Provedores de IA">
          <table className="data w-full">
            <thead>
              <tr>
                <th>Provedor</th>
                <th>Modelo / Voz Padrão</th>
                <th>Codec</th>
                {canSeeCosts ? (
                  <>
                    <th>Custo Mês</th>
                    <th>Acumulado</th>
                  </>
                ) : (
                  <th>Credencial BYOK</th>
                )}
                <th>Status</th>
                <th className="text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="font-semibold text-xs text-slate-900">{p.name || p.id}</div>
                    <div className="font-mono text-[11px] text-slate-500">{p.id}</div>
                  </td>
                  <td className="text-xs">{p.defaultModel || '—'} · {p.defaultVoice || '—'}</td>
                  <td className="font-mono text-xs">{p.audioCodec || 'g711_ulaw'}</td>
                  {canSeeCosts ? (
                    <>
                      <td className="tabular-nums text-xs">US$ {(p.monthUsd ?? 0).toFixed(4)}</td>
                      <td className="tabular-nums text-xs">US$ {(p.allTimeUsd ?? 0).toFixed(4)}</td>
                    </>
                  ) : (
                    <td className="text-xs">
                      {p.byokConfigured ? (
                        <Badge tone="green">BYOK ({p.maskedByokKey})</Badge>
                      ) : (
                        <Badge tone="gray">Padrão da Plataforma</Badge>
                      )}
                    </td>
                  )}
                  <td><Badge tone={p.active ? 'green' : 'gray'}>{p.active ? 'Ativo' : 'Inativo'}</Badge></td>
                  <td className="text-right whitespace-nowrap">
                    <div className="inline-flex gap-1">
                      {canSeeCosts && (
                        <Button size="sm" variant="secondary" onClick={() => setStatementProvider(p.id)}>
                          Ver Extrato
                        </Button>
                      )}
                      {canManage && (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<Edit className="size-3.5" aria-hidden />}
                          onClick={() =>
                            setEditingProv({
                              id: p.id,
                              active: p.active !== false,
                              apiKey: '',
                              defaultModel: p.defaultModel || '',
                              defaultVoice: p.defaultVoice || '',
                              audioCodec: p.audioCodec || 'g711_ulaw',
                              models: (p.models ?? []).join(', '),
                            })
                          }
                        >
                          {canSeeCosts ? 'Configurar' : 'Chave BYOK'}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      {canSeeCosts && (
        <Card
          title={`Extrato Detalhado de Uso (${statementProvider})`}
          actions={
            <div className="text-xs text-slate-500">
              Mês: <strong>US$ {(summary.monthUsd ?? 0).toFixed(4)}</strong>
            </div>
          }
          padded={false}
        >
          {!statement.length ? (
            <div className="p-6"><Empty title="Sem lançamentos no extrato para este provedor" /></div>
          ) : (
            <TableWrap label="Extrato de custos de IA">
              <table className="data w-full">
                <thead>
                  <tr>
                    <th>Data/Hora</th>
                    <th>Agente / Call-ID</th>
                    <th>Modelo</th>
                    <th>Tokens In/Out</th>
                    <th className="text-right">Custo (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.map((s, idx) => (
                    <tr key={idx}>
                      <td className="text-xs whitespace-nowrap">{fmtDateTime(s.at || s.timestamp)}</td>
                      <td className="font-mono text-xs">
                        {s.tenantId || 'default'} {s.callId ? `· ${s.callId.slice(0, 12)}` : ''}
                      </td>
                      <td className="text-xs">{s.model || '—'}</td>
                      <td className="tabular-nums text-xs">{s.inputTokens ?? 0} / {s.outputTokens ?? 0}</td>
                      <td className="text-right tabular-nums text-xs font-semibold">US$ {(s.costUsd ?? 0).toFixed(5)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      )}

      <Modal
        open={!!editingProv}
        onOpenChange={(o) => !o && setEditingProv(null)}
        title={`Configurar Provedor IA: ${editingProv?.id}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditingProv(null)}>Cancelar</Button>
            <Button
              variant="primary"
              loading={saveM.isPending}
              onClick={() => {
                const payload: any = {
                  active: Boolean(editingProv.active),
                  defaultModel: editingProv.defaultModel.trim(),
                  defaultVoice: editingProv.defaultVoice.trim(),
                  audioCodec: editingProv.audioCodec.trim() || 'g711_ulaw',
                  models: editingProv.models.split(',').map((s: string) => s.trim()).filter(Boolean),
                };
                if (editingProv.apiKey.trim()) payload.apiKey = editingProv.apiKey.trim();
                saveM.mutate({ id: editingProv.id, payload });
              }}
            >
              Salvar Configurações
            </Button>
          </>
        }
      >
        {editingProv && (
          <div className="space-y-3">
            <Checkbox label="Provedor ativo" checked={editingProv.active} onChange={(e) => setEditingProv({ ...editingProv, active: e.target.checked })} />
            <Field label={canSeeCosts ? 'Nova API Key Global (deixe em branco para manter)' : 'Sua API Key BYOK (criptografada AES-256-GCM)'}>
              {(p) => <Input id={p.id} type="password" value={editingProv.apiKey} onChange={(e) => setEditingProv({ ...editingProv, apiKey: e.target.value })} placeholder="sk-..." />}
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Modelo Padrão">
                {(p) => <Input id={p.id} value={editingProv.defaultModel} onChange={(e) => setEditingProv({ ...editingProv, defaultModel: e.target.value })} />}
              </Field>
              <Field label="Voz Padrão">
                {(p) => <Input id={p.id} value={editingProv.defaultVoice} onChange={(e) => setEditingProv({ ...editingProv, defaultVoice: e.target.value })} />}
              </Field>
              <Field label="Codec Áudio">
                {(p) => <Input id={p.id} value={editingProv.audioCodec} onChange={(e) => setEditingProv({ ...editingProv, audioCodec: e.target.value })} />}
              </Field>
            </div>
            <Field label="Modelos disponíveis (separados por vírgula)">
              {(p) => <Textarea id={p.id} rows={2} value={editingProv.models} onChange={(e) => setEditingProv({ ...editingProv, models: e.target.value })} />}
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

function VoiceFeaturesPanel() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canManage = can('connections.write');
  const canOperate = can('telephony.hangup');
  const [selectedFeature, setSelectedFeature] = useState<VoiceFeature | null>(null);

  const q = useQuery({
    queryKey: ['telephony', 'features'],
    queryFn: () => get<{ count: number; activeCount: number; testedAt?: string; totalDurationMs?: number; features: VoiceFeature[] }>('/telephony/features'),
    retry: false,
  });

  const xtalkQ = useQuery({
    queryKey: ['telephony', 'crosstalk-mode'],
    queryFn: () => get<{ mode: string }>('/telephony/features/crosstalk/mode'),
    retry: false,
  });

  const setModeM = useMutation({
    mutationFn: (mode: string) => post('/telephony/features/crosstalk/mode', { mode }),
    onSuccess: (_r, mode) => {
      toast('success', `Filtro de voz alterado para "${mode}" (próximas chamadas)!`);
      qc.invalidateQueries({ queryKey: ['telephony', 'crosstalk-mode'] });
      qc.invalidateQueries({ queryKey: ['telephony', 'features'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const testAllM = useMutation({
    mutationFn: () => post('/telephony/features/test', {}),
    onSuccess: () => {
      toast('success', 'Diagnóstico completo das 14 features concluído!');
      qc.invalidateQueries({ queryKey: ['telephony', 'features'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const testOneM = useMutation({
    mutationFn: (id: string) => post(`/telephony/features/${encodeURIComponent(id)}/test`, {}),
    onSuccess: (_r, id) => {
      toast('success', `Feature "${id}" testada!`);
      qc.invalidateQueries({ queryKey: ['telephony', 'features'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <GatewayError error={q.error} onRetry={() => q.refetch()} />;

  const features = q.data?.features ?? [];
  const activeMode = xtalkQ.data?.mode || 'atual';

  const modes = [
    { id: 'atual', label: 'DSP YIN F0 (Ultraleve)', desc: 'Detecção acústica de F0 + gate RMS' },
    { id: 'wespeaker', label: 'WeSpeaker CAM++', desc: 'Biometria neural estrita (512-dim)' },
    { id: 'ecapa', label: 'ECAPA-TDNN', desc: 'Biometria neural tolerante para ruído' },
    { id: 'none', label: 'Desligado', desc: 'Sem filtro de voz de fundo' },
  ];

  return (
    <div className="space-y-6">
      <Card title="Seletor Global de Filtro de Voz (Crosstalk Filter)">
        <div className="grid gap-3 sm:grid-cols-4">
          {modes.map((m) => {
            const selected = activeMode === m.id || (m.id === 'atual' && activeMode === 'dsp');
            return (
              <button
                key={m.id}
                type="button"
                disabled={!canManage || setModeM.isPending}
                onClick={() => setModeM.mutate(m.id)}
                className={`rounded-xl border p-3 text-left transition ${
                  selected ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">{m.label}</span>
                  {selected && <Badge tone="green">Ativo</Badge>}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">{m.desc}</p>
              </button>
            );
          })}
        </div>
      </Card>

      <Card
        title={`Pipeline Acústico & Controle (${q.data?.activeCount ?? 0}/${features.length} Features Ativas)`}
        actions={
          canOperate && (
            <Button size="sm" variant="primary" loading={testAllM.isPending} icon={<Play className="size-3.5" aria-hidden />} onClick={() => testAllM.mutate()}>
              Executar Diagnóstico Completo
            </Button>
          )
        }
        padded={false}
      >
        {q.data?.testedAt && (
          <div className="px-5 py-2.5 border-b border-slate-100">
            <Alert tone="info" title={`Último diagnóstico: ${fmtDateTime(q.data.testedAt)}`}>
              Tempo total de verificação em tempo real: {q.data.totalDurationMs ?? 0}ms.
            </Alert>
          </div>
        )}
        <TableWrap label="14 Features de Voz">
          <table className="data w-full">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Categoria</th>
                <th>Descrição</th>
                <th>Status</th>
                <th>Último Teste</th>
                <th className="text-right">Testar</th>
              </tr>
            </thead>
            <tbody>
              {features.map((f) => (
                <tr key={f.id}>
                  <td>
                    <div className="font-semibold text-xs text-slate-900">{f.name}</div>
                    <div className="font-mono text-[11px] text-slate-400">{f.id}</div>
                  </td>
                  <td><Badge tone="gray">{f.category || 'DSP'}</Badge></td>
                  <td className="text-xs text-slate-600 max-w-md">{f.description || f.details || '—'}</td>
                  <td><Badge tone={f.active ? 'green' : 'gray'}>{f.active ? 'Ativa' : 'Inativa'}</Badge></td>
                  <td className="text-xs">
                    {f.test ? (
                      <button
                        type="button"
                        onClick={() => setSelectedFeature(f)}
                        className="cursor-pointer hover:opacity-80"
                        title="Clique para inspecionar logs e detalhes do diagnóstico"
                      >
                        <Badge tone={f.test.passed ? 'green' : 'red'}>
                          {f.test.passed ? `OK (${f.test.latencyMs ?? 0}ms)` : 'Falhou'}
                        </Badge>
                      </button>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="text-right">
                    {canOperate && (
                      <Button size="sm" variant="secondary" loading={testOneM.isPending} onClick={() => testOneM.mutate(f.id)}>
                        Testar
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <Modal
        open={!!selectedFeature}
        onOpenChange={(o) => !o && setSelectedFeature(null)}
        title={selectedFeature ? `Diagnóstico: ${selectedFeature.name}` : 'Diagnóstico da Feature'}
        description={selectedFeature?.id}
      >
        {selectedFeature && (
          <div className="space-y-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={selectedFeature.test?.passed ? 'green' : 'red'}>
                {selectedFeature.test?.passed ? 'Teste Aprovado' : 'Falha Detectada'}
              </Badge>
              {selectedFeature.test?.latencyMs != null && (
                <Badge tone="gray">Latência: {selectedFeature.test.latencyMs}ms</Badge>
              )}
              {selectedFeature.test?.testedAt && (
                <span className="text-slate-500">Em {fmtDateTime(selectedFeature.test.testedAt)}</span>
              )}
            </div>
            {selectedFeature.test?.message && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 font-medium text-slate-800">
                {selectedFeature.test.message}
              </div>
            )}
            {(selectedFeature.test?.details || selectedFeature.details) && (
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-3 font-mono text-[11px] text-slate-100">
                {typeof (selectedFeature.test?.details ?? selectedFeature.details) === 'string'
                  ? (selectedFeature.test?.details ?? selectedFeature.details)
                  : JSON.stringify(selectedFeature.test?.details ?? selectedFeature.details, null, 2)}
              </pre>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

export function SettingsTabs() {
  const [subTab, setSubTab] = useState('trunks');

  return (
    <Tabs
      value={subTab}
      onValueChange={setSubTab}
      tabs={[
        { value: 'trunks', label: <span className="inline-flex items-center gap-1.5"><Network className="size-3.5" aria-hidden />Troncos SIP &amp; Provedores</span>, content: <TrunksAndProvidersPanel /> },
        { value: 'inbound', label: <span className="inline-flex items-center gap-1.5"><Route className="size-3.5" aria-hidden />Rotas de Entrada (DID)</span>, content: <InboundRoutesPanel /> },
        { value: 'outbound', label: <span className="inline-flex items-center gap-1.5"><Sliders className="size-3.5" aria-hidden />Rotas de Saída PSTN</span>, content: <OutboundRoutesPanel /> },
        { value: 'ai', label: <span className="inline-flex items-center gap-1.5"><Cpu className="size-3.5" aria-hidden />Provedor IA &amp; Custos</span>, content: <AiProvidersAndCostsPanel /> },
        { value: 'dsp', label: <span className="inline-flex items-center gap-1.5"><FlaskConical className="size-3.5" aria-hidden />Motores DSP &amp; 14 Features</span>, content: <VoiceFeaturesPanel /> },
      ]}
    />
  );
}
export { Activity };
