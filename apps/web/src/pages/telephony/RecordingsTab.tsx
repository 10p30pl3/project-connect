import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Trash2, Volume2 } from 'lucide-react';
import { API_BASE, del, errorMessage, get, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDateTime } from '../../lib/format';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Empty,
  Input,
  Loading,
  TableWrap,
  useToast,
} from '../../components/ui';
import { GatewayError, type RecordingItem } from './types';

function parseRecordingMeta(id: string) {
  const clean = id.replace(/\.wav$/i, '');
  const parts = clean.split('_');
  // Padrões comuns: call_<ts>_<tenant>_<phone> ou <tenant>_<callId>
  const phone = parts.find((p) => /^\+?\d{8,15}$/.test(p));
  const tenant = parts.length >= 3 && parts[0] === 'call' ? parts[2] : parts[0];
  return { tenant: tenant || '—', phone: phone || null };
}

export function RecordingsTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canDelete = can('connections.write');

  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);

  const q = useQuery({
    queryKey: ['telephony', 'recordings'],
    queryFn: () => get<{ count: number; recordings: RecordingItem[] }>('/telephony/recordings'),
    retry: false,
  });

  const transcriptQ = useQuery({
    queryKey: ['telephony', 'recording-transcript', playing],
    queryFn: () => get<{ formatted?: string; text?: string }>(`/telephony/recordings/${encodeURIComponent(playing!)}/transcript`),
    enabled: !!playing,
    retry: false,
  });

  const delSingleM = useMutation({
    mutationFn: (id: string) => del(`/telephony/recordings/${encodeURIComponent(id)}`),
    onSuccess: (_res, id) => {
      toast('success', 'Gravação excluída com sucesso.');
      if (playing === id) setPlaying(null);
      setSelectedIds((prev) => prev.filter((x) => x !== id));
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['telephony', 'recordings'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const batchDelM = useMutation({
    mutationFn: (ids: string[]) => post('/telephony/recordings/batch-delete', { ids }),
    onSuccess: () => {
      toast('success', `${selectedIds.length} gravações removidas com sucesso.`);
      if (playing && selectedIds.includes(playing)) setPlaying(null);
      setSelectedIds([]);
      setConfirmBatchDelete(false);
      qc.invalidateQueries({ queryKey: ['telephony', 'recordings'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const recordings = q.data?.recordings ?? [];
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return recordings.filter((r) => {
      if (dateFilter && !r.createdAt.slice(0, 10).includes(dateFilter)) return false;
      if (!s) return true;
      return r.id.toLowerCase().includes(s);
    });
  }, [recordings, search, dateFilter]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => selectedIds.includes(r.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map((r) => r.id));
    }
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  if (q.isLoading) return <Loading />;
  if (q.error) return <GatewayError error={q.error} onRetry={() => q.refetch()} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="w-72"
            placeholder="Filtrar gravações por callId, tenant ou número..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Input
            type="date"
            className="w-40"
            aria-label="Filtrar gravações por data"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
          />
          <Badge tone="gray">{filtered.length} arquivos</Badge>
        </div>

        {canDelete && selectedIds.length > 0 && (
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 className="size-3.5" aria-hidden />}
            onClick={() => setConfirmBatchDelete(true)}
          >
            Excluir Selecionadas ({selectedIds.length})
          </Button>
        )}
      </div>

      {!filtered.length ? (
        <Empty title="Nenhuma gravação encontrada" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card padded={false}>
            <TableWrap label="Gravações Estéreo (.wav)">
              <table className="data w-full">
                <thead>
                  <tr>
                    {canDelete && (
                      <th className="w-8">
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          onChange={toggleSelectAll}
                          aria-label="Selecionar todas as gravações"
                        />
                      </th>
                    )}
                    <th>Gravação</th>
                    <th>Data</th>
                    <th className="text-right">Tamanho</th>
                    <th className="text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const meta = parseRecordingMeta(r.id);
                    return (
                      <tr key={r.id} className={playing === r.id ? 'bg-brand-50/70' : undefined}>
                        {canDelete && (
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(r.id)}
                              onChange={() => toggleOne(r.id)}
                              aria-label={`Selecionar ${r.id}`}
                            />
                          </td>
                        )}
                        <td>
                          <button
                            type="button"
                            className="text-left font-mono text-xs font-medium text-brand-700 hover:underline break-all"
                            onClick={() => setPlaying(r.id)}
                          >
                            {r.id}
                          </button>
                          <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px] text-slate-500">
                            <span>Agente: <strong>{meta.tenant}</strong></span>
                            {meta.phone && <span>· Tel: <strong className="font-mono">{meta.phone}</strong></span>}
                          </div>
                        </td>
                      <td className="whitespace-nowrap text-xs">{fmtDateTime(r.createdAt)}</td>
                      <td className="text-right tabular-nums text-xs">{(r.sizeBytes / 1024).toFixed(0)} KB</td>
                      <td className="text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Ouvir e ler transcrição"
                            icon={<Volume2 className="size-3.5" aria-hidden />}
                            onClick={() => setPlaying(r.id)}
                          />
                          <a
                            href={`${API_BASE}/telephony/recordings/${encodeURIComponent(r.id)}/audio`}
                            download={`${r.id}.wav`}
                            title="Baixar WAV Estéreo"
                            className="inline-flex items-center rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                          >
                            <Download className="size-3.5" aria-hidden />
                          </a>
                          {canDelete && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-red-600 hover:bg-red-50"
                              title="Excluir gravação (LGPD)"
                              icon={<Trash2 className="size-3.5" aria-hidden />}
                              onClick={() => setDeleteTarget(r.id)}
                            />
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

          <Card
            title={playing ? `Player & Transcrição: ${playing}` : 'Selecione uma gravação'}
            tooltip="Gravação Dual-Stream 8kHz Estéreo: Canal Esquerdo = Cliente, Canal Direito = Agente IA."
          >
            {playing ? (
              <div className="space-y-3">
                <audio
                  key={playing}
                  controls
                  preload="none"
                  className="w-full"
                  src={`${API_BASE}/telephony/recordings/${encodeURIComponent(playing)}/audio`}
                >
                  Seu navegador não reproduz áudio.
                </audio>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span>Canal esquerdo: cliente · direito: agente IA (auditoria LGPD ativa).</span>
                  <a
                    href={`${API_BASE}/telephony/recordings/${encodeURIComponent(playing)}/audio`}
                    download={`${playing}.wav`}
                    className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline"
                  >
                    <Download className="size-3.5" aria-hidden />
                    Download WAV
                  </a>
                </div>
                {transcriptQ.isLoading ? (
                  <Loading rows={3} />
                ) : transcriptQ.data ? (
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700 border border-slate-200">
                    {transcriptQ.data.formatted ?? transcriptQ.data.text ?? 'Sem transcrição.'}
                  </pre>
                ) : (
                  <p className="text-xs text-slate-500">Sem transcrição registrada para esta gravação.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500 py-8 text-center">
                Clique em qualquer gravação na tabela ao lado para ouvir o áudio estéreo e inspecionar a transcrição.
              </p>
            )}
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Excluir gravação permanentemente?"
        confirmLabel="Excluir"
        danger
        loading={delSingleM.isPending}
        onConfirm={() => deleteTarget && delSingleM.mutate(deleteTarget)}
      >
        O arquivo WAV e a transcrição de <strong>{deleteTarget}</strong> serão removidos do disco do cluster local (LGPD).
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmBatchDelete}
        onOpenChange={setConfirmBatchDelete}
        title={`Excluir ${selectedIds.length} gravações?`}
        confirmLabel="Excluir selecionadas"
        danger
        loading={batchDelM.isPending}
        onConfirm={() => batchDelM.mutate(selectedIds)}
      >
        Os arquivos de áudio e transcrição selecionados serão apagados permanentemente do disco.
      </ConfirmDialog>
    </div>
  );
}
