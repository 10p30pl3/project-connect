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

export type ImporterOptions = {
  defaultTimezone?: string;
  defaultDurationMinutes?: number;
  idempotencyKey?: string;
};

export function parseTime(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})(:(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function isValidTimezone(tz: string): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

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

  // Detecção inteligente: se a 1ª linha for identificada como dados reais (telefone, email, etc.), não trata como cabeçalho
  let effectiveHasHeader = hasHeader;
  if (data.length > 0 && hasHeader) {
    const firstCols = data[0] ?? [];
    let dataScore = 0;
    for (const c of firstCols) {
      const s = String(c ?? '').trim();
      if (s.includes('@')) dataScore += 3;
      const digits = s.replace(/\D/g, '');
      if (digits.length >= 8 && digits.length <= 15) dataScore += 2;
      if (/^\d+$/.test(s)) dataScore += 1;
    }
    if (dataScore >= 2 || (data.length === 1 && dataScore >= 1)) {
      effectiveHasHeader = false;
    }
  }

  let headers: string[];
  let body: string[][];
  if (effectiveHasHeader) {
    headers = (data[0] ?? []).map((h, i) => (h?.trim() ? h.trim() : `coluna${i + 1}`));
    body = data.slice(1);
  } else {
    const width = Math.max(0, ...data.map((r) => r.length));
    headers = Array.from({ length: width }, (_, i) => `Coluna ${i + 1}`);
    body = data;
  }
  // nomes de coluna duplicados recebem sufixo
  const seen: Record<string, number> = {};
  headers = headers.map((h) => {
    seen[h] = (seen[h] ?? 0) + 1;
    return seen[h] > 1 ? `${h}_${seen[h]}` : h;
  });
  const rows: ParsedRow[] = body.map((r, i) => ({
    rowNumber: i + (effectiveHasHeader ? 2 : 1),
    values: Object.fromEntries(headers.map((h, j) => [h, (r[j] ?? '').trim()])),
  }));
  return { delimiter: detected, headers, rows };
}

export function suggestMapping(headers: string[], sample: ParsedRow[]): ColumnMapping[] {
  let phoneN = 0;
  let digitalN = 0;
  const used = new Set<string>();
  return headers.map((h, i) => {
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
    else if (['melhorhorarioinicio', 'horarioinicio', 'horariode', 'horade', 'bestcontactstart', 'btcstart', 'bttcstart', 'bttcinicio', 'dehorario', 'bttc', 'btc', 'melhorhorario'].includes(k) && !used.has('best_contact_start'))
      target = 'best_contact_start';
    else if (['melhorhorariofim', 'horariofim', 'horarioate', 'horaate', 'bestcontactend', 'btcend', 'bttcend', 'bttcfim', 'atehorario'].includes(k) && !used.has('best_contact_end'))
      target = 'best_contact_end';
    else if (['duracao', 'duracaojanela', 'janelaminutos', 'btcduration', 'bttcduration', 'bttcduracao', 'duracaojanelaminutos'].includes(k) && !used.has('best_contact_duration'))
      target = 'best_contact_duration';
    else if (['fuso', 'fusohorario', 'timezone', 'btctimezone', 'bttctimezone', 'iana'].includes(k) && !used.has('best_contact_timezone'))
      target = 'best_contact_timezone';

    // Heurística de dados amostrais para quando a coluna for genérica (ex: "Coluna 1", "Coluna 2")
    const vals = sample.map((r) => r.values[h]).filter((v) => v !== '' && v !== undefined).slice(0, 50);
    const firstVal = vals[0] ?? '';
    const digits = firstVal.replace(/\D/g, '');

    if (target === 'attribute') {
      if (firstVal.includes('@') && !used.has('email')) {
        target = 'email';
      } else if (digits.length >= 10 && digits.length <= 13) {
        if (phoneN === 0) {
          target = 'phone1';
          phoneN = 1;
        } else if (digitalN === 0) {
          target = 'digital1';
          digitalType = 'WHATSAPP';
          digitalN = 1;
        } else if (phoneN < 5) {
          target = `phone${++phoneN}` as MappingTarget;
        }
      } else if (!used.has('external_id') && (/^\d{1,14}$/.test(firstVal) || i === 0)) {
        target = 'external_id';
      } else if (!used.has('name') && firstVal.length >= 2 && !/\d/.test(firstVal)) {
        target = 'name';
      }
    }

    used.add(target);
    let type: ColumnMapping['type'] = 'text';
    if (target === 'attribute') {
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

export function validateRow(row: ParsedRow, mapping: ColumnMapping[], options?: ImporterOptions): ValidatedRow {
  const out: ValidatedRow = { ...row, errors: [], typed: {}, destinations: [] };
  const seenAddr = new Set<string>();

  let btcStartVal: string | null = null;
  let btcEndVal: string | null = null;
  let btcDurationVal: string | null = null;
  let btcTzVal: string | null = null;

  for (const m of mapping) {
    const v = row.values[m.column] ?? '';
    if (m.required && !v) out.errors.push(`${m.column}: obrigatório`);
    if (m.target === 'ignore') continue;
    if (m.target === 'best_contact_start') {
      if (v) btcStartVal = v;
      continue;
    }
    if (m.target === 'best_contact_end') {
      if (v) btcEndVal = v;
      continue;
    }
    if (m.target === 'best_contact_duration') {
      if (v) btcDurationVal = v;
      continue;
    }
    if (m.target === 'best_contact_timezone') {
      if (v) btcTzVal = v;
      continue;
    }
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

  // Validação de Best Time to Call (BTC)
  const defaultTz = options?.defaultTimezone || 'America/Sao_Paulo';
  const defaultDur = options?.defaultDurationMinutes;

  const hasAnyBtc = btcStartVal !== null || btcEndVal !== null || btcDurationVal !== null || btcTzVal !== null;
  if (hasAnyBtc) {
    let startMin: number | null = null;
    let endMin: number | null = null;
    let durMin: number | null = defaultDur ?? null;
    let tz = defaultTz;

    if (btcStartVal !== null) {
      // Suporte a coluna única contendo intervalo, ex: "14:00 - 16:00" ou "14:00 às 16:00"
      const rangeParts = btcStartVal.split(/\s*[-–/|aAàÀ][sS]?\s*|\s+ate\s+|\s+to\s+/i);
      if (rangeParts.length === 2 && btcEndVal === null) {
        startMin = parseTime(rangeParts[0]);
        endMin = parseTime(rangeParts[1]);
      } else {
        startMin = parseTime(btcStartVal);
      }
      if (startMin === null) out.errors.push(`Horário de início inválido "${btcStartVal}" (use HH:mm)`);
    }

    if (btcEndVal !== null) {
      endMin = parseTime(btcEndVal);
      if (endMin === null) out.errors.push(`Horário de término inválido "${btcEndVal}" (use HH:mm)`);
    }

    if (btcDurationVal !== null) {
      const d = Number(btcDurationVal);
      if (Number.isFinite(d) && d > 0 && d <= 720) {
        durMin = d;
      } else {
        out.errors.push(`Duração da janela inválida "${btcDurationVal}" (use de 1 a 720 minutos)`);
      }
    }

    if (btcTzVal !== null) {
      if (isValidTimezone(btcTzVal)) {
        tz = btcTzVal.trim();
      } else {
        out.errors.push(`Fuso horário IANA desconhecido "${btcTzVal}"`);
      }
    } else if (!isValidTimezone(tz)) {
      out.errors.push(`Fuso horário padrão inválido "${tz}"`);
    }

    if (startMin !== null && endMin === null && durMin !== null) {
      endMin = startMin + durMin;
    }

    if (startMin !== null && endMin !== null) {
      if (startMin >= endMin) {
        out.errors.push('Janela de contato inválida: início deve ser anterior ao término no mesmo dia');
      } else if (endMin > 1440) {
        out.errors.push('Janela de contato inválida: término ultrapassa meia-noite (24:00)');
      } else {
        out.typed.btc_start_minute = startMin;
        out.typed.btc_end_minute = endMin;
        out.typed.btc_timezone = tz;
        out.typed.btc_source = 'IMPORT';
      }
    } else if (startMin !== null || endMin !== null) {
      out.errors.push('Horário preferencial incompleto: informe início e término ou início com duração');
    }
  }

  return out;
}

export function buildPreview(
  content: string,
  delimiter: string,
  hasHeader: boolean,
  mapping?: ColumnMapping[],
  options?: ImporterOptions,
) {
  const parsed = parseContent(content, delimiter, hasHeader);
  const suggested = suggestMapping(parsed.headers, parsed.rows.slice(0, 100));
  const effective = mapping && mapping.length ? mapping : suggested;
  const sErr = schemaErrors(effective, parsed.headers, parsed.rows.length);
  const validated = parsed.rows.slice(0, MAX_ROWS).map((r) => validateRow(r, effective, options));

  // Validação cruzada de contatos repetidos no mesmo mailing (§Plano v3):
  // Se o mesmo externalId tiver janelas BTC conflitantes, marca erro em todas as ocorrências.
  const btcByExt = new Map<string, { sigs: Set<string>; rows: ValidatedRow[] }>();
  for (const r of validated) {
    if (!r.externalId) continue;
    const start = (r.typed.btc_start_minute as number | undefined) ?? '';
    const end = (r.typed.btc_end_minute as number | undefined) ?? '';
    const tz = (r.typed.btc_timezone as string | undefined) ?? '';
    const sig = `${start}|${end}|${tz}`;
    const group = btcByExt.get(r.externalId);
    if (!group) {
      btcByExt.set(r.externalId, { sigs: new Set([sig]), rows: [r] });
    } else {
      group.sigs.add(sig);
      group.rows.push(r);
    }
  }

  for (const [, group] of btcByExt.entries()) {
    if (group.sigs.size > 1) {
      const rowNums = group.rows.map((x) => x.rowNumber).join(', ');
      for (const r of group.rows) {
        r.errors.push(`Conflito de preferências de horário (BTC) para o mesmo cliente (linhas ${rowNums})`);
      }
    }
  }

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
  options?: ImporterOptions,
) {
  const { parsed, effective, validated } = preview;
  const valid = validated.filter((r) => !r.errors.length);
  const rejected = validated.filter((r) => r.errors.length);

  if (options?.idempotencyKey) {
    const existing = await c.query<{ id: string; version_id: string }>(
      `SELECT m.id, mv.id AS version_id 
         FROM mailings m 
         JOIN mailing_versions mv ON mv.mailing_id = m.id AND mv.version = 1
        WHERE m.workspace_id = $1 AND m.idempotency_key = $2`,
      [ws.id, options.idempotencyKey],
    );
    if (existing.rows.length > 0) {
      return {
        mailingId: existing.rows[0].id,
        versionId: existing.rows[0].version_id,
        validRows: valid.length,
        rejectedRows: rejected.length,
        idempotentReplay: true,
      };
    }
  }

  const [mailing] = (
    await c.query(
      `INSERT INTO mailings (workspace_id, name, created_by, idempotency_key) VALUES ($1,$2,$3,$4) RETURNING id`,
      [ws.id, name, userId, options?.idempotencyKey ?? null],
    )
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
