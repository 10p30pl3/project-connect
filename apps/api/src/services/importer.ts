/** Importação de mailing (§16.1, §26.5, §27.2). Usado pela API e pelo seed. */
import Papa from 'papaparse';
import type { ColumnMapping, MappingTarget } from '@voll/shared';
import type { Client } from '../db/pool.js';
import { normalizeEmail, normalizePhone } from '../lib/phone.js';

export const MAX_ROWS = 50000;
const PREVIEW_ROWS = 200;

export type ParsedRow = { rowNumber: number; values: Record<string, string> };

export type ValidatedRow = ParsedRow & {
  errors: string[];
  externalId?: string;
  name?: string;
  historyTotal?: number | null;
  typed: Record<string, unknown>;
  destinations: { channelType: 'VOICE' | 'WHATSAPP' | 'SMS' | 'EMAIL'; address: string; priority: number; label: string }[];
};

const strip = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export function parseContent(content: string, delimiter: string, hasHeader: boolean) {
  const res = Papa.parse<string[]>(content.replace(/^﻿/, ''), {
    delimiter: delimiter === 'auto' ? '' : delimiter,
    skipEmptyLines: 'greedy',
  });
  const data = res.data as string[][];
  const detected = (res.meta.delimiter as string) || ',';
  let headers: string[];
  let body: string[][];
  if (hasHeader) {
    headers = (data[0] ?? []).map((h, i) => (h?.trim() ? h.trim() : `coluna${i + 1}`));
    body = data.slice(1);
  } else {
    const width = Math.max(0, ...data.map((r) => r.length));
    headers = Array.from({ length: width }, (_, i) => `coluna${i + 1}`);
    body = data;
  }
  // nomes de coluna duplicados recebem sufixo
  const seen: Record<string, number> = {};
  headers = headers.map((h) => {
    seen[h] = (seen[h] ?? 0) + 1;
    return seen[h] > 1 ? `${h}_${seen[h]}` : h;
  });
  const rows: ParsedRow[] = body.map((r, i) => ({
    rowNumber: i + (hasHeader ? 2 : 1),
    values: Object.fromEntries(headers.map((h, j) => [h, (r[j] ?? '').trim()])),
  }));
  return { delimiter: detected, headers, rows };
}

export function suggestMapping(headers: string[], sample: ParsedRow[]): ColumnMapping[] {
  let phoneN = 0;
  let digitalN = 0;
  const used = new Set<string>();
  return headers.map((h) => {
    const k = strip(h);
    let target: MappingTarget = 'attribute';
    let digitalType: 'WHATSAPP' | 'SMS' | undefined;
    const m = k.match(/^(telefone|fone|celular|tel|phone)(\d)?$/);
    const d = k.match(/^(whatsapp|whats|wpp|zap|sms|digital)(\d)?$/);
    if (['id', 'cpf', 'cnpj', 'codigo', 'cod', 'idcliente', 'codcliente', 'externalid', 'documento'].includes(k) && !used.has('external_id'))
      target = 'external_id';
    else if (['nome', 'name', 'cliente', 'nomecliente'].includes(k) && !used.has('name')) target = 'name';
    else if (['email', 'mail'].includes(k) && !used.has('email')) target = 'email';
    else if (m && phoneN < 5) target = `phone${++phoneN}` as MappingTarget;
    else if (d && digitalN < 3) {
      target = `digital${++digitalN}` as MappingTarget;
      digitalType = d[1] === 'sms' ? 'SMS' : d[1] === 'digital' ? undefined : 'WHATSAPP';
    } else if (['historico', 'tentativashistorico', 'historicototal', 'historytotal'].includes(k)) target = 'history_total';
    used.add(target);
    let type: ColumnMapping['type'] = 'text';
    if (target === 'attribute') {
      const vals = sample.map((r) => r.values[h]).filter((v) => v !== '' && v !== undefined).slice(0, 50);
      if (vals.length && vals.every((v) => parseNumber(v) !== null) && !vals.some((v) => /^0\d/.test(v))) type = 'number';
      else if (vals.length && vals.every((v) => parseDate(v) !== null)) type = 'date';
    }
    return {
      column: h,
      target,
      attributeName: target === 'attribute' ? h : undefined,
      type,
      required: target === 'external_id',
      digitalType,
    };
  });
}

export function parseNumber(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  let norm = s.replace(/[R$\s]/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(norm)) norm = norm.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+,\d+$/.test(norm)) norm = norm.replace(',', '.');
  const n = Number(norm);
  return Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(norm) ? n : null;
}

export function parseDate(v: string): string | null {
  const s = v.trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return validDate(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  return null;
}
function validDate(y: number, mo: number, d: number) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
    ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    : null;
}
function parseBool(v: string): boolean | null {
  const s = strip(v);
  if (['sim', 's', 'true', '1', 'yes', 'y'].includes(s)) return true;
  if (['nao', 'n', 'false', '0', 'no'].includes(s)) return false;
  return null;
}

export function schemaErrors(mapping: ColumnMapping[], headers: string[], totalRows: number): string[] {
  const errs: string[] = [];
  if (!mapping.some((m) => m.target === 'external_id')) errs.push('Mapeie uma coluna para o identificador do cliente');
  const counts: Record<string, number> = {};
  for (const m of mapping) {
    if (!headers.includes(m.column)) errs.push(`Coluna "${m.column}" não existe no arquivo`);
    if (m.target !== 'attribute' && m.target !== 'ignore') counts[m.target] = (counts[m.target] ?? 0) + 1;
    if (m.target === 'attribute' && !m.attributeName?.trim()) errs.push(`Informe o nome do campo para a coluna "${m.column}"`);
    if (m.target.startsWith('digital') && !m.digitalType) errs.push(`Informe o tipo (WhatsApp ou SMS) da coluna "${m.column}"`);
  }
  for (const [t, n] of Object.entries(counts)) if (n > 1) errs.push(`O destino "${t}" foi mapeado mais de uma vez`);
  const attrNames: Record<string, number> = {};
  for (const m of mapping.filter((m) => m.target === 'attribute')) {
    const k = (m.attributeName ?? '').trim();
    attrNames[k] = (attrNames[k] ?? 0) + 1;
  }
  for (const [k, n] of Object.entries(attrNames)) if (k && n > 1) errs.push(`O campo "${k}" foi usado mais de uma vez`);
  if (totalRows > MAX_ROWS) errs.push(`O arquivo tem ${totalRows} registros; o limite é ${MAX_ROWS}`);
  if (totalRows === 0) errs.push('Nenhum registro encontrado');
  return errs;
}

export function validateRow(row: ParsedRow, mapping: ColumnMapping[]): ValidatedRow {
  const out: ValidatedRow = { ...row, errors: [], typed: {}, destinations: [] };
  const seenAddr = new Set<string>();
  for (const m of mapping) {
    const v = row.values[m.column] ?? '';
    if (m.required && !v) out.errors.push(`${m.column}: obrigatório`);
    if (m.target === 'ignore') continue;
    if (m.target === 'external_id') {
      if (!v) out.errors.push(`${m.column}: identificador obrigatório`);
      else if (/^\d+([.,]\d+)?e[+-]?\d+$/i.test(v)) out.errors.push(`${m.column}: identificador em notação científica`);
      else out.externalId = v;
      continue;
    }
    if (m.target === 'name') {
      if (v) out.name = v;
      continue;
    }
    if (m.target === 'history_total') {
      if (!v) out.historyTotal = null;
      else if (/^\d+$/.test(v)) out.historyTotal = Number(v);
      else out.errors.push(`${m.column}: histórico deve ser inteiro não negativo`);
      continue;
    }
    if (m.target === 'attribute') {
      const key = (m.attributeName ?? m.column).trim();
      if (!v) {
        out.typed[key] = null;
        continue;
      }
      if (m.type === 'number') {
        const n = parseNumber(v);
        if (n === null) out.errors.push(`${m.column}: número inválido "${v}"`);
        else out.typed[key] = n;
      } else if (m.type === 'date') {
        const d = parseDate(v);
        if (!d) out.errors.push(`${m.column}: data inválida "${v}" (use DD/MM/AAAA)`);
        else out.typed[key] = d;
      } else if (m.type === 'boolean') {
        const b = parseBool(v);
        if (b === null) out.errors.push(`${m.column}: valor lógico inválido "${v}"`);
        else out.typed[key] = b;
      } else out.typed[key] = v;
      continue;
    }
    if (!v) continue;
    if (m.target === 'email') {
      const e = normalizeEmail(v);
      if (!e.ok) out.errors.push(`${m.column}: ${e.error}`);
      else out.destinations.push({ channelType: 'EMAIL', address: e.value, priority: 1, label: m.column });
      continue;
    }
    const isPhone = m.target.startsWith('phone');
    const p = normalizePhone(v);
    if (!p.ok) {
      out.errors.push(`${m.column}: ${p.error}`);
      continue;
    }
    const channel = isPhone ? 'VOICE' : (m.digitalType ?? 'WHATSAPP');
    const key = `${channel}:${p.value}`;
    if (seenAddr.has(key)) {
      out.errors.push(`${m.column}: número repetido no mesmo canal`);
      continue;
    }
    seenAddr.add(key);
    out.destinations.push({ channelType: channel, address: p.value, priority: Number(m.target.slice(-1)) || 1, label: m.column });
  }
  return out;
}

export function buildPreview(content: string, delimiter: string, hasHeader: boolean, mapping?: ColumnMapping[]) {
  const parsed = parseContent(content, delimiter, hasHeader);
  const suggested = suggestMapping(parsed.headers, parsed.rows.slice(0, 100));
  const effective = mapping && mapping.length ? mapping : suggested;
  const sErr = schemaErrors(effective, parsed.headers, parsed.rows.length);
  const validated = parsed.rows.slice(0, MAX_ROWS).map((r) => validateRow(r, effective));
  const rejected = validated.filter((r) => r.errors.length);
  // destaca primeiro os rejeitados na amostra
  const sample = [...rejected.slice(0, 50), ...validated.filter((r) => !r.errors.length)].slice(0, PREVIEW_ROWS);
  sample.sort((a, b) => a.rowNumber - b.rowNumber);
  return {
    parsed,
    effective,
    validated,
    response: {
      delimiter: parsed.delimiter,
      headers: parsed.headers,
      totalRows: parsed.rows.length,
      suggestedMapping: suggested,
      rows: sample.map((r) => ({ rowNumber: r.rowNumber, values: r.values, errors: r.errors })),
      validRows: validated.length - rejected.length,
      rejectedRows: rejected.length,
      schemaErrors: sErr,
    },
  };
}

/** Persiste a importação (somente válidos) numa transação em lotes UNNEST de alta performance. */
export async function commitImport(
  c: Client,
  ws: { id: string },
  userId: string | null,
  name: string,
  preview: ReturnType<typeof buildPreview>,
) {
  const { parsed, effective, validated } = preview;
  const valid = validated.filter((r) => !r.errors.length);
  const rejected = validated.filter((r) => r.errors.length);
  const [mailing] = (
    await c.query(`INSERT INTO mailings (workspace_id, name, created_by) VALUES ($1,$2,$3) RETURNING id`, [ws.id, name, userId])
  ).rows;
  const report = rejected.slice(0, 5000).map((r) => ({ rowNumber: r.rowNumber, values: r.values, errors: r.errors }));
  const [version] = (
    await c.query(
      `INSERT INTO mailing_versions (mailing_id, version, field_mapping, headers, total_rows, valid_rows, rejected_rows, rejected_report, created_by)
       VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [mailing.id, JSON.stringify(effective), JSON.stringify(parsed.headers), parsed.rows.length, valid.length, rejected.length, JSON.stringify(report), userId],
    )
  ).rows;

  const BATCH_SIZE = 1000;
  for (let offset = 0; offset < valid.length; offset += BATCH_SIZE) {
    const chunk = valid.slice(offset, offset + BATCH_SIZE);

    // 1. Consolida contatos únicos por externalId no lote (evita conflito duplo no mesmo comando UNNEST)
    const contactByExt = new Map<
      string,
      { externalId: string; name: string | null; typed: Record<string, unknown>; historyTotal: number | null }
    >();
    for (const r of chunk) {
      const ext = r.externalId!;
      const prev = contactByExt.get(ext);
      const nonNullTyped = Object.fromEntries(Object.entries(r.typed).filter(([, v]) => v !== null && v !== undefined));
      if (!prev) {
        contactByExt.set(ext, {
          externalId: ext,
          name: r.name ?? null,
          typed: { ...nonNullTyped },
          historyTotal: r.historyTotal ?? null,
        });
      } else {
        if (r.name) prev.name = r.name;
        Object.assign(prev.typed, nonNullTyped);
        if (r.historyTotal !== null && r.historyTotal !== undefined) prev.historyTotal = r.historyTotal;
      }
    }

    const uniqueContacts = Array.from(contactByExt.values());
    const upserted = await c.query(
      `INSERT INTO contacts (workspace_id, external_id, name, attributes, history_total, history_reference_date)
       SELECT $1,
              x.ext_id,
              x.cname,
              x.attrs,
              x.hist,
              CASE WHEN x.hist IS NULL THEN NULL ELSE current_date END
         FROM unnest($2::text[], $3::text[], $4::jsonb[], $5::int[]) AS x(ext_id, cname, attrs, hist)
       ON CONFLICT (workspace_id, external_id) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, contacts.name),
         attributes = contacts.attributes || (SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each(EXCLUDED.attributes) AS t(k, v) WHERE v <> 'null'::jsonb),
         history_total = COALESCE(EXCLUDED.history_total, contacts.history_total),
         history_reference_date = COALESCE(EXCLUDED.history_reference_date, contacts.history_reference_date),
         updated_at = now()
       RETURNING id, external_id`,
      [
        ws.id,
        uniqueContacts.map((u) => u.externalId),
        uniqueContacts.map((u) => u.name),
        uniqueContacts.map((u) => JSON.stringify(u.typed)),
        uniqueContacts.map((u) => u.historyTotal),
      ],
    );

    const idByExt = new Map<string, string>();
    for (const row of upserted.rows) {
      idByExt.set(row.external_id, row.id);
    }

    // 2. Insere destinos em lote (deduplicados por contact_id + channel_type + address)
    const destSeen = new Set<string>();
    const destContactIds: string[] = [];
    const destChannels: string[] = [];
    const destAddresses: string[] = [];
    const destLabels: string[] = [];
    const destPriorities: number[] = [];

    for (const r of chunk) {
      const cid = idByExt.get(r.externalId!)!;
      for (const d of r.destinations) {
        const key = `${cid}:${d.channelType}:${d.address}`;
        if (destSeen.has(key)) continue;
        destSeen.add(key);
        destContactIds.push(cid);
        destChannels.push(d.channelType);
        destAddresses.push(d.address);
        destLabels.push(d.label);
        destPriorities.push(d.priority);
      }
    }

    if (destContactIds.length > 0) {
      await c.query(
        `INSERT INTO contact_destinations (workspace_id, contact_id, channel_type, address, label, priority, source)
         SELECT $1, x.cid, x.ch::channel_type, x.addr, x.lbl, x.prio, 'IMPORT'
           FROM unnest($2::uuid[], $3::text[], $4::text[], $5::text[], $6::int[]) AS x(cid, ch, addr, lbl, prio)
         ON CONFLICT (contact_id, channel_type, address) DO NOTHING`,
        [ws.id, destContactIds, destChannels, destAddresses, destLabels, destPriorities],
      );
    }

    // 3. Garante Perfil Cumulativo de Inteligência (Golden Record) em lote
    const uniqueContactIds = Array.from(idByExt.values());
    if (uniqueContactIds.length > 0) {
      await c.query(
        `INSERT INTO contact_intelligence_profiles (workspace_id, contact_id, locator_score)
         SELECT $1, unnest($2::uuid[]), 75
         ON CONFLICT (workspace_id, contact_id) DO UPDATE SET updated_at = now()`,
        [ws.id, uniqueContactIds],
      );
    }

    // 4. Insere mailing_records em lote
    await c.query(
      `INSERT INTO mailing_records (mailing_id, mailing_version_id, contact_id, row_number, business_key, raw_fields, typed_fields)
       SELECT $1, $2, x.cid, x.rnum, x.bkey, x.rawf, x.typf
         FROM unnest($3::uuid[], $4::int[], $5::text[], $6::jsonb[], $7::jsonb[]) AS x(cid, rnum, bkey, rawf, typf)`,
      [
        mailing.id,
        version.id,
        chunk.map((r) => idByExt.get(r.externalId!)!),
        chunk.map((r) => r.rowNumber),
        chunk.map((r) => r.externalId!),
        chunk.map((r) => JSON.stringify(r.values)),
        chunk.map((r) => JSON.stringify(r.typed)),
      ],
    );
  }

  return { mailingId: mailing.id as string, versionId: version.id as string, validRows: valid.length, rejectedRows: rejected.length };
}
