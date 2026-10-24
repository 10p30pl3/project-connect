import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import clsx from 'clsx';
import { FileUp } from 'lucide-react';
import { FIELD_TYPES, MAPPING_TARGETS, type ColumnMapping, type MappingTarget } from '@voll/shared';
import { ApiError, errorMessage, post } from '../lib/api';
import type { ImportPreview, ImportResult } from '../lib/types';
import { downloadText, fmtNumber } from '../lib/format';
import { Alert, Badge, Button, Checkbox, ConfirmDialog, Field, Input, Select, Stat, TableWrap, Textarea } from './ui';

const TARGET_LABEL: Record<MappingTarget, string> = {
  external_id: 'Identificador do cliente',
  name: 'Nome',
  phone1: 'Telefone 1',
  phone2: 'Telefone 2',
  phone3: 'Telefone 3',
  phone4: 'Telefone 4',
  phone5: 'Telefone 5',
  digital1: 'Digital 1 (WhatsApp/SMS)',
  digital2: 'Digital 2 (WhatsApp/SMS)',
  digital3: 'Digital 3 (WhatsApp/SMS)',
  email: 'E-mail',
  history_total: 'Histórico de tentativas (acumulado)',
  attribute: 'Campo adicional',
  ignore: 'Ignorar coluna',
};
const TYPE_LABEL: Record<(typeof FIELD_TYPES)[number], string> = { text: 'Texto', number: 'Número', date: 'Data', boolean: 'Sim/Não' };

type Sub = 'ORIGIN' | 'FIELDS' | 'REVIEW';

export function ImportFlow({ onImported, initialName = '' }: { onImported: (r: ImportResult & { name: string }) => void; initialName?: string }) {
  const [sub, setSub] = useState<Sub>('ORIGIN');
  const [name, setName] = useState(initialName);
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [delimiter, setDelimiter] = useState<'auto' | ',' | ';' | '\t' | '|'>('auto');
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<ColumnMapping[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [onlyErrors, setOnlyErrors] = useState(true);
  const nameRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const previewM = useMutation({
    mutationFn: (withMapping: boolean) =>
      post<ImportPreview>('/imports/preview', { content, delimiter, hasHeader, mapping: withMapping ? mapping : undefined }),
  });
  const commitM = useMutation({
    mutationFn: (acceptPartial: boolean) => post<ImportResult>('/imports', { name, content, delimiter, hasHeader, mapping, acceptPartial }),
  });

  async function readFile(f: File) {
    if (f.size > 2_000_000) {
      setErrors({ content: 'O arquivo excede 2 MB (limite do MVP).' });
      return;
    }
    const text = await f.text();
    setContent(text);
    setFileName(f.name);
    if (!name) setName(f.name.replace(/\.(csv|txt)$/i, ''));
    setErrors({});
  }

  async function goFields() {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Informe o nome do mailing';
    if (!content.trim()) e.content = 'Envie um CSV ou cole o conteúdo da planilha';
    setErrors(e);
    if (e.name) return nameRef.current?.focus();
    if (e.content) return contentRef.current?.focus();
    try {
      const p = await previewM.mutateAsync(false);
      setPreview(p);
      setMapping(p.suggestedMapping);
      setSub('FIELDS');
    } catch (err) {
      setErrors(err instanceof ApiError ? { content: Object.values(err.fieldErrors)[0] ?? errorMessage(err) } : { content: errorMessage(err) });
    }
  }

  async function goReview() {
    const e: Record<string, string> = {};
    if (!mapping.some((m) => m.target === 'external_id')) e.mapping = 'Mapeie uma coluna para "Identificador do cliente".';
    const dup = mapping.filter((m) => !['attribute', 'ignore'].includes(m.target)).map((m) => m.target);
    const d = dup.find((t, i) => dup.indexOf(t) !== i);
    if (d) e.mapping = `O destino "${TARGET_LABEL[d]}" foi usado em mais de uma coluna.`;
    if (mapping.some((m) => m.target === 'attribute' && !m.attributeName?.trim())) e.mapping = 'Informe o nome de cada campo adicional.';
    if (mapping.some((m) => m.target.startsWith('digital') && !m.digitalType)) e.mapping = 'Identifique o tipo (WhatsApp ou SMS) de cada destino digital.';
    setErrors(e);
    if (e.mapping) return;
    try {
      const p = await previewM.mutateAsync(true);
      setPreview(p);
      setSub('REVIEW');
    } catch (err) {
      setErrors({ mapping: errorMessage(err) });
    }
  }

  async function commit(acceptPartial: boolean) {
    try {
      const r = await commitM.mutateAsync(acceptPartial);
      setConfirmOpen(false);
      onImported({ ...r, name });
    } catch (err) {
      setConfirmOpen(false);
      const fe = err instanceof ApiError ? err.fieldErrors : {};
      if (fe.name) {
        setSub('ORIGIN');
        setErrors({ name: fe.name });
        setTimeout(() => nameRef.current?.focus());
      } else setErrors({ commit: errorMessage(err) });
    }
  }

  function setMap(i: number, patch: Partial<ColumnMapping>) {
    setMapping((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  }

  function downloadRejected() {
    if (!preview) return;
    const headers = preview.headers;
    const esc = (v: string) => (/[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [['linha', ...headers, 'motivos'].map(esc).join(';')];
    for (const r of preview.rows.filter((x) => x.errors.length)) {
      lines.push([String(r.rowNumber), ...headers.map((h) => r.values[h] ?? ''), r.errors.join(' | ')].map(esc).join(';'));
    }
    downloadText(`${name || 'mailing'}-rejeitados.csv`, '﻿' + lines.join('\n'));
  }

  const subs: { key: Sub; label: string }[] = [
    { key: 'ORIGIN', label: 'Origem' },
    { key: 'FIELDS', label: 'Campos' },
    { key: 'REVIEW', label: 'Conferência' },
  ];
  const subIdx = subs.findIndex((s) => s.key === sub);
  const firstRow = preview?.rows[0]?.values ?? {};

  return (
    <div className="space-y-4" data-testid="import-flow">
      <ol className="flex flex-wrap gap-2 text-xs" aria-label="Etapas da importação">
        {subs.map((s, i) => (
          <li
            key={s.key}
            aria-current={s.key === sub ? 'step' : undefined}
            className={clsx(
              'rounded-full px-2.5 py-1 font-medium',
              s.key === sub ? 'bg-brand-700 text-white' : i < subIdx ? 'bg-brand-100 text-brand-800' : 'bg-slate-100 text-slate-500',
            )}
          >
            {i + 1}. {s.label}
          </li>
        ))}
      </ol>

      {sub === 'ORIGIN' && (
        <div className="space-y-3">
          <Field label="Nome do mailing" required error={errors.name}>
            {(p) => (
              <Input
                id={p.id}
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-describedby={p.describedBy}
                aria-invalid={p.invalid}
              />
            )}
          </Field>
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <Field
              label="Conteúdo (CSV ou colado da planilha)"
              required
              error={errors.content}
              hint="Até 2 MB e 2.000 registros neste MVP. Identificadores e telefones são preservados como texto."
            >
              {(p) => (
                <Textarea
                  id={p.id}
                  ref={contentRef}
                  rows={8}
                  value={content}
                  placeholder={'id;nome;telefone1;whatsapp1;email\n00123;Maria Silva;11999990000;11999990000;maria@ex.com'}
                  onChange={(e) => {
                    setContent(e.target.value);
                    setFileName(null);
                  }}
                  aria-describedby={p.describedBy}
                  aria-invalid={p.invalid}
                  data-testid="import-content"
                />
              )}
            </Field>
            <div className="flex flex-col gap-3 md:w-56">
              <label className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed border-slate-300 bg-white p-4 text-center text-sm hover:border-brand-400">
                <FileUp className="size-5 text-brand-700" aria-hidden />
                <span className="font-medium">Escolher arquivo CSV</span>
                <span className="text-xs text-slate-500">{fileName ?? 'nenhum arquivo'}</span>
                <input
                  type="file"
                  accept=".csv,.txt,text/csv"
                  className="sr-only"
                  data-testid="import-file"
                  onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])}
                />
              </label>
              <Field label="Separador">
                {(p) => (
                  <Select id={p.id} value={delimiter} onChange={(e) => setDelimiter(e.target.value as typeof delimiter)}>
                    <option value="auto">Automático</option>
                    <option value=";">Ponto e vírgula (;)</option>
                    <option value=",">Vírgula (,)</option>
                    <option value={'\t'}>Tabulação</option>
                    <option value="|">Barra vertical (|)</option>
                  </Select>
                )}
              </Field>
              <Checkbox label="A primeira linha contém os nomes" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" loading={previewM.isPending} onClick={goFields}>
              Continuar para campos
            </Button>
          </div>
        </div>
      )}

      {sub === 'FIELDS' && preview && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {fmtNumber(preview.totalRows)} registros · separador detectado: <code>{preview.delimiter === '\t' ? 'tab' : preview.delimiter}</code>. Revise
            para onde cada coluna vai no cadastro.
          </p>
          {errors.mapping && <Alert tone="error">{errors.mapping}</Alert>}
          <TableWrap label="Definição dos campos">
            <table className="data">
              <thead>
                <tr>
                  <th>Coluna</th>
                  <th>Exemplo</th>
                  <th>Destino no cadastro</th>
                  <th>Tipo</th>
                  <th>Obrigatório</th>
                </tr>
              </thead>
              <tbody>
                {mapping.map((m, i) => (
                  <tr key={m.column}>
                    <td className="font-medium">{m.column}</td>
                    <td className="max-w-40 truncate text-slate-600">{firstRow[m.column] ?? ''}</td>
                    <td className="min-w-56">
                      <div className="flex flex-col gap-1">
                        <Select
                          aria-label={`Destino da coluna ${m.column}`}
                          value={m.target}
                          onChange={(e) => {
                            const t = e.target.value as MappingTarget;
                            setMap(i, {
                              target: t,
                              digitalType: t.startsWith('digital') ? (m.digitalType ?? 'WHATSAPP') : undefined,
                              attributeName: t === 'attribute' ? (m.attributeName ?? m.column) : undefined,
                            });
                          }}
                        >
                          {MAPPING_TARGETS.map((t) => (
                            <option key={t} value={t}>
                              {TARGET_LABEL[t]}
                            </option>
                          ))}
                        </Select>
                        {m.target === 'attribute' && (
                          <Input
                            aria-label={`Nome do campo adicional da coluna ${m.column}`}
                            value={m.attributeName ?? ''}
                            onChange={(e) => setMap(i, { attributeName: e.target.value })}
                          />
                        )}
                        {m.target.startsWith('digital') && (
                          <Select
                            aria-label={`Tipo do destino digital da coluna ${m.column}`}
                            value={m.digitalType ?? 'WHATSAPP'}
                            onChange={(e) => setMap(i, { digitalType: e.target.value as 'WHATSAPP' | 'SMS' })}
                          >
                            <option value="WHATSAPP">WhatsApp</option>
                            <option value="SMS">SMS (RCS se suportado)</option>
                          </Select>
                        )}
                      </div>
                    </td>
                    <td>
                      <Select
                        aria-label={`Tipo da coluna ${m.column}`}
                        value={m.type}
                        disabled={m.target === 'ignore'}
                        onChange={(e) => setMap(i, { type: e.target.value as ColumnMapping['type'] })}
                      >
                        {FIELD_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {TYPE_LABEL[t]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Coluna ${m.column} obrigatória`}
                        className="size-4 accent-brand-700"
                        checked={m.required || m.target === 'external_id'}
                        disabled={m.target === 'external_id' || m.target === 'ignore'}
                        onChange={(e) => setMap(i, { required: e.target.checked })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <div className="flex justify-between">
            <Button onClick={() => setSub('ORIGIN')}>Revisar origem</Button>
            <Button variant="primary" loading={previewM.isPending} onClick={goReview}>
              Conferir registros
            </Button>
          </div>
        </div>
      )}

      {sub === 'REVIEW' && preview && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Recebidos" value={fmtNumber(preview.totalRows)} />
            <Stat label="Válidos" value={fmtNumber(preview.validRows)} tone="good" />
            <Stat label="Inconsistentes" value={fmtNumber(preview.rejectedRows)} tone={preview.rejectedRows ? 'bad' : undefined} />
          </div>
          {preview.schemaErrors.length > 0 && (
            <Alert tone="error" title="Esquema inconsistente — importação bloqueada">
              <ul className="list-disc pl-4">
                {preview.schemaErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Alert>
          )}
          {errors.commit && <Alert tone="error">{errors.commit}</Alert>}
          <div className="flex items-center justify-between gap-2">
            <Checkbox label="Mostrar só linhas com inconsistência" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
            {preview.rejectedRows > 0 && (
              <Button size="sm" onClick={downloadRejected}>
                Baixar rejeitados
              </Button>
            )}
          </div>
          <TableWrap label="Conferência dos registros">
            <table className="data">
              <thead>
                <tr>
                  <th>Linha</th>
                  {preview.headers.slice(0, 6).map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows
                  .filter((r) => !onlyErrors || r.errors.length)
                  .map((r) => (
                    <tr key={r.rowNumber}>
                      <td className="tabular">{r.rowNumber}</td>
                      {preview.headers.slice(0, 6).map((h) => (
                        <td key={h} className="max-w-40 truncate">
                          {r.values[h]}
                        </td>
                      ))}
                      <td>
                        {r.errors.length ? (
                          <span className="text-red-700">{r.errors.join('; ')}</span>
                        ) : (
                          <Badge tone="green">Pronto</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </TableWrap>
          {preview.rows.length < preview.totalRows && (
            <p className="text-xs text-slate-500">Exibindo as primeiras {preview.rows.length} linhas da conferência.</p>
          )}
          <div className="flex flex-wrap justify-between gap-2">
            <div className="flex gap-2">
              <Button onClick={() => setSub('ORIGIN')}>Revisar origem</Button>
              <Button onClick={() => setSub('FIELDS')}>Ajustar campos</Button>
            </div>
            <Button
              variant="primary"
              disabled={preview.validRows === 0 || preview.schemaErrors.length > 0}
              loading={commitM.isPending}
              onClick={() => (preview.rejectedRows > 0 ? setConfirmOpen(true) : commit(false))}
            >
              {preview.rejectedRows > 0 ? `Importar ${fmtNumber(preview.validRows)} válidos` : `Importar ${fmtNumber(preview.validRows)} registros`}
            </Button>
          </div>
          {preview.validRows === 0 && <Alert tone="warn">Nenhum registro válido. Ajuste os campos ou a origem para importar.</Alert>}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Importar somente os registros válidos?"
        confirmLabel={`Importar ${fmtNumber(preview?.validRows ?? 0)} válidos`}
        loading={commitM.isPending}
        onConfirm={() => commit(true)}
      >
        <p className="text-sm">
          Serão incluídos <strong>{fmtNumber(preview?.validRows ?? 0)}</strong> registros e excluídos{' '}
          <strong>{fmtNumber(preview?.rejectedRows ?? 0)}</strong> inconsistentes. O relatório dos rejeitados (linha original, valores e motivos)
          fica associado ao mailing para download. Linhas rejeitadas não entram no cadastro.
        </p>
      </ConfirmDialog>
    </div>
  );
}
