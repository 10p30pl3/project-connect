import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bookmark, CheckCircle2, Info, Layers, SlidersHorizontal, Sparkles } from 'lucide-react';
import { type OperationPurpose } from '@voll/shared';
import { post } from '../lib/api';
import type { CampaignTemplate } from '../lib/types';
import { Alert, Button, Field, Input, Modal, Textarea, useToast } from './ui';

export interface SaveAsTemplateModalProps {
  open: boolean;
  onClose: () => void;
  /** Se informado, chama POST /campaigns/:id/save-as-template */
  campaignId?: string;
  campaignName?: string;
  /** Se não tiver campaignId (ex: na etapa 4 do wizard), envia os dados diretamente */
  directData?: {
    journeyId?: string;
    journeyVersionId?: string;
    journeyName?: string;
    strategyId?: string;
    strategyVersionId?: string;
    strategyName?: string;
    purposeCode?: OperationPurpose;
    startMode?: 'NOW' | 'SCHEDULE' | 'READY';
  };
  initialName?: string;
  initialDescription?: string;
  onSaved?: (template: CampaignTemplate) => void;
}

export function SaveAsTemplateModal({
  open,
  onClose,
  campaignId,
  campaignName,
  directData,
  initialName = '',
  initialDescription = '',
  onSaved,
}: SaveAsTemplateModalProps) {
  const toast = useToast();
  const qc = useQueryClient();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const defaultName = initialName
        ? initialName.startsWith('Modelo') ? initialName : `Modelo - ${initialName}`
        : campaignName
          ? `Modelo - ${campaignName}`
          : 'Novo Modelo de Campanha';
      setName(defaultName);
      setDescription(initialDescription || (campaignName ? `Modelo gerado a partir da campanha "${campaignName}"` : ''));
      setError(null);
    }
  }, [open, initialName, campaignName, initialDescription]);

  const saveM = useMutation({
    mutationFn: async () => {
      if (!name.trim()) {
        throw new Error('Informe um nome para o modelo.');
      }
      if (campaignId) {
        return post<CampaignTemplate>(`/campaigns/${campaignId}/save-as-template`, {
          name: name.trim(),
          description: description.trim() || undefined,
        });
      }
      if (directData) {
        return post<CampaignTemplate>('/campaign-templates', {
          name: name.trim(),
          description: description.trim() || undefined,
          journeyId: directData.journeyId,
          journeyVersionId: directData.journeyVersionId,
          strategyId: directData.strategyId,
          strategyVersionId: directData.strategyVersionId,
          purposeCode: directData.purposeCode ?? 'COBRANCA',
          startMode: directData.startMode ?? 'NOW',
        });
      }
      throw new Error('Parâmetros insuficientes para salvar o modelo.');
    },
    onSuccess: (data) => {
      toast('success', `Modelo "${data.name}" salvo com sucesso!`);
      qc.invalidateQueries({ queryKey: ['campaign-templates'] });
      onSaved?.(data);
      onClose();
    },
    onError: (err: any) => {
      setError(err?.message || 'Falha ao salvar o modelo.');
    },
  });

  const jName = directData?.journeyName;
  const sName = directData?.strategyName;

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Salvar como modelo de campanha"
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-sky-100 bg-sky-50/70 p-3.5 text-xs text-sky-950">
          <div className="flex items-start gap-2.5">
            <Info className="mt-0.5 size-4 shrink-0 text-sky-700" aria-hidden />
            <div className="space-y-1">
              <p className="font-semibold text-sky-900">Configurações que serão salvas no modelo:</p>
              <p className="text-sky-800">
                Todas as regras de <strong>Jornada</strong>, <strong>Estratégia</strong> e <strong>Acionamento</strong> serão copiadas para este modelo.
              </p>
              <p className="font-medium text-sky-900">
                O mailing e os filtros de público <u>não</u> são incluídos, permitindo que você reutilize este modelo com qualquer base de contatos.
              </p>
            </div>
          </div>
        </div>

        {/* Resumo do que está sendo empacotado */}
        {(jName || sName || campaignName) && (
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-700">
            {jName && (
              <div className="flex items-center gap-1.5">
                <Layers className="size-3.5 text-brand-700" />
                <span className="truncate"><strong>Jornada:</strong> {jName}</span>
              </div>
            )}
            {sName && (
              <div className="flex items-center gap-1.5">
                <SlidersHorizontal className="size-3.5 text-brand-700" />
                <span className="truncate"><strong>Estratégia:</strong> {sName}</span>
              </div>
            )}
            {campaignName && !jName && (
              <div className="col-span-2 flex items-center gap-1.5 text-slate-600">
                <Bookmark className="size-3.5 text-brand-700" />
                <span>Baseado na campanha: <strong>{campaignName}</strong></span>
              </div>
            )}
          </div>
        )}

        <Field label="Nome do modelo" required error={error ?? undefined}>
          {(f) => (
            <Input
              id={f.id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Cobrança Digital 30d (WhatsApp + Voz)"
              autoFocus
            />
          )}
        </Field>

        <Field label="Descrição (opcional)" hint="Explique o objetivo operacional deste modelo para sua equipe.">
          {(f) => (
            <Textarea
              id={f.id}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Ex: Utilizar para bases vencidas com régua amigável de WhatsApp e transbordo para voz..."
            />
          )}
        </Field>

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
          <Button variant="secondary" onClick={onClose} disabled={saveM.isPending}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={() => saveM.mutate()}
            disabled={saveM.isPending || !name.trim()}
            icon={<Bookmark className="size-3.5" />}
          >
            {saveM.isPending ? 'Salvando...' : 'Salvar modelo'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
