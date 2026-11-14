import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Edit, Eye, EyeOff, Phone, Plus, RefreshCw, Server, Trash2, Wand2 } from 'lucide-react';
import { del, errorMessage, get, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import {
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
  TableWrap,
  useToast,
} from '../../components/ui';
import { GatewayError, type SipConfig, type SipExtension, type TenantConfig } from './types';

type ExtForm = {
  id: string;
  name: string;
  password: string;
  effectiveCallerIdName: string;
  context: string;
  callgroup: string;
  enabled: boolean;
};

export function ExtensionsTab({ onDialExtension }: { onDialExtension?: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canManage = can('connections.write');
  const canOperate = can('telephony.hangup');

  const [revealedPwd, setRevealedPwd] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<{ isNew: boolean; form: ExtForm } | null>(null);
  const [deleting, setDeleting] = useState<SipExtension | null>(null);
  const [sipInfoOpen, setSipInfoOpen] = useState(false);

  const extQ = useQuery({
    queryKey: ['telephony', 'extensions'],
    queryFn: () => get<{ extensions: SipExtension[] }>('/telephony/extensions'),
    refetchInterval: 8000,
    retry: false,
  });

  const tenantsQ = useQuery({
    queryKey: ['telephony', 'tenants'],
    queryFn: () => get<{ count: number; tenants: TenantConfig[] }>('/telephony/tenants'),
    retry: false,
  });

  const sipConfQ = useQuery({
    queryKey: ['telephony', 'extensions-config'],
    queryFn: () => get<SipConfig>('/telephony/extensions/config'),
    enabled: sipInfoOpen,
    retry: false,
  });

  const saveM = useMutation({
    mutationFn: (form: ExtForm) => post('/telephony/extensions', form),
    onSuccess: (_res, form) => {
      toast('success', `Ramal ${form.id} salvo no diretório FreeSWITCH.`);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['telephony', 'extensions'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const delM = useMutation({
    mutationFn: (id: string) => del(`/telephony/extensions/${encodeURIComponent(id)}`),
    onSuccess: () => {
      toast('success', 'Ramal excluído.');
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['telephony', 'extensions'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const genRangeM = useMutation({
    mutationFn: () => post<{ ok?: boolean; count?: number }>('/telephony/extensions/generate-range', { start: 1000, end: 1010, password: '1234' }),
    onSuccess: (res) => {
      toast('success', `Lote gerado: ${res?.count ?? 11} ramais (1000–1010) sincronizados.`);
      qc.invalidateQueries({ queryKey: ['telephony', 'extensions'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const syncM = useMutation({
    mutationFn: () => post('/telephony/extensions/sync', {}),
    onSuccess: () => {
      toast('success', 'Diretório SIP sincronizado com o FreeSWITCH.');
      qc.invalidateQueries({ queryKey: ['telephony', 'extensions'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const testCallM = useMutation({
    mutationFn: (id: string) => post<{ ok?: boolean; message?: string }>(`/telephony/extensions/${encodeURIComponent(id)}/test-call`, { target: '&echo' }),
    onSuccess: (res, id) => {
      if (res?.ok === false) toast('error', res.message || `Falha ao chamar ramal ${id}.`);
      else toast('success', `Chamando ramal ${id} (Eco Loopback). Atenda no Softphone!`);
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  if (extQ.isLoading) return <Loading />;
  if (extQ.error) return <GatewayError error={extQ.error} onRetry={() => extQ.refetch()} />;

  const extensions = extQ.data?.extensions ?? [];
  const tenants = tenantsQ.data?.tenants ?? [];
  const onlineCount = extensions.filter((e) => e.registered).length;

  const openNewModal = () => {
    let nextId = 1000;
    const used = new Set(extensions.map((e) => Number(e.id)));
    while (used.has(nextId)) nextId++;
    setEditing({
      isNew: true,
      form: {
        id: String(nextId),
        name: `Ramal ${nextId}`,
        password: '1234',
        effectiveCallerIdName: `Ramal ${nextId}`,
        context: 'default',
        callgroup: 'default',
        enabled: true,
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Cards de Ramais dos Agentes IA e Utilitário *99 */}
      <Card
        title="Ramais dos Agentes de IA & Utilitários de Teste"
        tooltip="Disque estes ramais a partir de qualquer Softphone (Zoiper/MicroSIP) registrado nos ramais 1000–1010."
        actions={
          <Button size="sm" variant="secondary" icon={<Server className="size-3.5" aria-hidden />} onClick={() => setSipInfoOpen(true)}>
            Configuração Softphone
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tenants.map((t) => {
            const ext = t.extension || (t.id === 'default' ? '9000' : '—');
            return (
              <div key={t.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white font-mono text-sm font-bold text-slate-900">
                    {ext}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-bold text-slate-900">{t.name || t.id}</div>
                    <div className="text-[11px] text-slate-500">
                      {t.stsEngine === 'elevenlabs' ? 'ElevenLabs STS' : 'OpenAI Realtime'} · {t.stsEngine === 'elevenlabs' ? (t.elevenlabsVoiceId || 'Rachel') : (t.voice || 'marin')}
                    </div>
                  </div>
                </div>
                {onDialExtension && (
                  <Button size="sm" variant="secondary" icon={<Phone className="size-3.5" aria-hidden />} onClick={onDialExtension}>
                    Testar
                  </Button>
                )}
              </div>
            );
          })}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50/60 p-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-brand-300 bg-white font-mono text-sm font-bold text-brand-800">
                *99
              </span>
              <div>
                <div className="text-xs font-bold text-brand-950">Teste de Eco / Loopback</div>
                <div className="text-[11px] text-brand-800">Retorna seu próprio áudio SIP em tempo real</div>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Tabela de Ramais SIP Softphone */}
      <Card
        title={
          <div className="flex items-center gap-2">
            <span>Ramais SIP &amp; Softphones</span>
            <Badge tone={onlineCount > 0 ? 'green' : 'gray'}>{onlineCount}/{extensions.length} online</Badge>
          </div>
        }
        actions={
          canManage && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" loading={syncM.isPending} icon={<RefreshCw className="size-3.5" aria-hidden />} onClick={() => syncM.mutate()}>
                Sincronizar FreeSWITCH
              </Button>
              <Button size="sm" variant="secondary" loading={genRangeM.isPending} icon={<Wand2 className="size-3.5" aria-hidden />} onClick={() => genRangeM.mutate()}>
                Gerar 1000–1010
              </Button>
              <Button size="sm" variant="primary" icon={<Plus className="size-3.5" aria-hidden />} onClick={openNewModal}>
                Novo Ramal
              </Button>
            </div>
          )
        }
        padded={false}
      >
        {!extensions.length ? (
          <div className="p-6">
            <Empty title="Nenhum ramal SIP configurado">
              Clique em &ldquo;Gerar 1000–1010&rdquo; ou &ldquo;Novo Ramal&rdquo; para provisionar no FreeSWITCH.
            </Empty>
          </div>
        ) : (
          <TableWrap label="Ramais SIP">
            <table className="data w-full">
              <thead>
                <tr>
                  <th>Ramal</th>
                  <th>Nome / Caller ID</th>
                  <th>Contexto / Grupo</th>
                  <th>Status SIP</th>
                  <th>Senha SIP</th>
                  <th>Registro (IP:Porta)</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {extensions.map((ext) => {
                  const id = String(ext.id);
                  const reg = ext.registrationDetails;
                  const showPwd = canManage && !!revealedPwd[id];
                  const pwd = ext.password || '';
                  return (
                    <tr key={id}>
                      <td>
                        <span className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs font-bold text-slate-900">
                          {id}
                        </span>
                      </td>
                      <td>
                        <div className="text-xs font-semibold text-slate-900">{ext.name || `Ramal ${id}`}</div>
                        <div className="text-[11px] text-slate-500">{ext.effectiveCallerIdName || ext.name || id}</div>
                      </td>
                      <td className="text-xs text-slate-600">
                        <Badge tone="gray">{ext.context || 'default'}</Badge>
                        <span className="ml-1 text-[11px] text-slate-500">{ext.callgroup || 'default'}</span>
                      </td>
                      <td>
                        <Badge tone={ext.registered ? 'green' : 'gray'}>
                          {ext.registered ? 'Online' : 'Offline'}
                        </Badge>
                      </td>
                      <td>
                        <div className="inline-flex items-center gap-1 font-mono text-xs">
                          <span>{!canManage ? 'Restrito' : !pwd ? '—' : showPwd ? pwd : '••••••'}</span>
                          {canManage && pwd && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                icon={showPwd ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
                                onClick={() => setRevealedPwd((p) => ({ ...p, [id]: !p[id] }))}
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                icon={<Copy className="size-3.5" aria-hidden />}
                                onClick={() => {
                                  navigator.clipboard?.writeText(pwd);
                                  toast('info', `Senha do ramal ${id} copiada.`);
                                }}
                              />
                            </>
                          )}
                        </div>
                      </td>
                      <td className="text-xs text-slate-600">
                        {ext.registered && reg ? (
                          <div>
                            <div className="font-mono font-semibold text-slate-800">{reg.ip}:{reg.port}</div>
                            <div className="text-[11px] text-slate-500">{reg.agent || 'Softphone'}</div>
                          </div>
                        ) : (
                          <span className="text-slate-400">Aguardando registro</span>
                        )}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          {canOperate && (
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={testCallM.isPending}
                              onClick={() => testCallM.mutate(id)}
                            >
                              Testar (&amp;echo)
                            </Button>
                          )}
                          {canManage && (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                icon={<Edit className="size-3.5" aria-hidden />}
                                onClick={() =>
                                  setEditing({
                                    isNew: false,
                                    form: {
                                      id,
                                      name: ext.name || `Ramal ${id}`,
                                      password: pwd,
                                      effectiveCallerIdName: ext.effectiveCallerIdName || ext.name || `Ramal ${id}`,
                                      context: ext.context || 'default',
                                      callgroup: ext.callgroup || 'default',
                                      enabled: ext.enabled !== false,
                                    },
                                  })
                                }
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-red-600 hover:bg-red-50"
                                icon={<Trash2 className="size-3.5" aria-hidden />}
                                onClick={() => setDeleting(ext)}
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
        )}
      </Card>

      {/* Modal Criar/Editar Ramal */}
      <Modal
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing?.isNew ? 'Novo Ramal SIP' : `Editar Ramal ${editing?.form.id}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button
              variant="primary"
              loading={saveM.isPending}
              disabled={!editing?.form.id.trim() || !editing?.form.password.trim()}
              onClick={() => editing && saveM.mutate(editing.form)}
            >
              Salvar Ramal no FreeSWITCH
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Número do Ramal" required>
                {(f) => (
                  <Input
                    id={f.id}
                    disabled={!editing.isNew}
                    value={editing.form.id}
                    onChange={(e) => setEditing({ ...editing, form: { ...editing.form, id: e.target.value } })}
                  />
                )}
              </Field>
              <Field label="Senha SIP" required>
                {(f) => (
                  <Input
                    id={f.id}
                    value={editing.form.password}
                    onChange={(e) => setEditing({ ...editing, form: { ...editing.form, password: e.target.value } })}
                  />
                )}
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome" required>
                {(f) => (
                  <Input
                    id={f.id}
                    value={editing.form.name}
                    onChange={(e) => setEditing({ ...editing, form: { ...editing.form, name: e.target.value } })}
                  />
                )}
              </Field>
              <Field label="Caller ID Name">
                {(f) => (
                  <Input
                    id={f.id}
                    value={editing.form.effectiveCallerIdName}
                    onChange={(e) => setEditing({ ...editing, form: { ...editing.form, effectiveCallerIdName: e.target.value } })}
                  />
                )}
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Contexto">
                {(f) => (
                  <Input
                    id={f.id}
                    value={editing.form.context}
                    onChange={(e) => setEditing({ ...editing, form: { ...editing.form, context: e.target.value } })}
                  />
                )}
              </Field>
              <Field label="Grupo de Chamada">
                {(f) => (
                  <Select
                    id={f.id}
                    value={editing.form.callgroup}
                    onChange={(e) => setEditing({ ...editing, form: { ...editing.form, callgroup: e.target.value } })}
                  >
                    <option value="default">default</option>
                    <option value="support">support</option>
                    <option value="sales">sales</option>
                  </Select>
                )}
              </Field>
            </div>
            <Checkbox
              label="Ramal Habilitado"
              checked={editing.form.enabled}
              onChange={(e) => setEditing({ ...editing, form: { ...editing.form, enabled: e.target.checked } })}
            />
          </div>
        )}
      </Modal>

      {/* Modal Configuração Softphone */}
      <Modal
        open={sipInfoOpen}
        onOpenChange={setSipInfoOpen}
        title="Dados para Conexão de Softphone (Zoiper / MicroSIP)"
      >
        {sipConfQ.isLoading ? (
          <Loading rows={2} />
        ) : (
          <div className="space-y-2 text-xs text-slate-700">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1.5 font-mono">
              <div><strong>Servidor / Proxy SIP:</strong> {sipConfQ.data?.server || '192.168.15.36'}</div>
              <div><strong>Domínio / Realm:</strong> {sipConfQ.data?.domain || sipConfQ.data?.server || '192.168.15.36'}</div>
              <div><strong>Porta:</strong> {sipConfQ.data?.port || 5060} ({sipConfQ.data?.transport || 'UDP'})</div>
              <div><strong>Usuário:</strong> Ramal (ex: 1000) · <strong>Senha padrão:</strong> 1234</div>
            </div>
            <p className="text-slate-500">
              Para falar com o agente de IA padrão, disque <strong>9000</strong>. Para teste de áudio em loopback, disque <strong>*99</strong>.
            </p>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Excluir ramal ${deleting?.id}?`}
        confirmLabel="Excluir ramal"
        danger
        loading={delM.isPending}
        onConfirm={() => deleting && delM.mutate(deleting.id)}
      >
        O ramal será removido permanentemente do diretório SIP do FreeSWITCH.
      </ConfirmDialog>
    </div>
  );
}
