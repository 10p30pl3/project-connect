import { describe, expect, it } from 'vitest';
import {
  parseTime,
  isValidTimezone,
  validateRow,
  suggestMapping,
  buildPreview,
  type ParsedRow,
} from '../src/services/importer.js';
import type { ColumnMapping } from '@voll/shared';

describe('Best Time to Call (BTC) Importer', () => {
  it('parseTime parses 24h formats and boundaries', () => {
    expect(parseTime('00:00')).toBe(0);
    expect(parseTime('08:30')).toBe(510);
    expect(parseTime('14:00')).toBe(840);
    expect(parseTime('23:59')).toBe(1439);
    expect(parseTime('9:15')).toBe(555);

    expect(parseTime('')).toBeNull();
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('12:60')).toBeNull();
    expect(parseTime('invalid')).toBeNull();
  });

  it('isValidTimezone validates IANA timezone identifiers', () => {
    expect(isValidTimezone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimezone('America/Manaus')).toBe(true);
    expect(isValidTimezone('America/Cuiaba')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);

    expect(isValidTimezone('Invalid/Zone')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
  });

  it('suggestMapping automatically detects BTC columns', () => {
    const headers = ['id', 'nome', 'telefone', 'horario_inicio', 'horario_fim', 'fuso_horario'];
    const sample: ParsedRow[] = [
      { rowNumber: 2, values: { id: '1', nome: 'Ana', telefone: '11999998888', horario_inicio: '14:00', horario_fim: '18:00', fuso_horario: 'America/Sao_Paulo' } },
    ];
    const mapping = suggestMapping(headers, sample);

    expect(mapping.find((m) => m.column === 'horario_inicio')?.target).toBe('best_contact_start');
    expect(mapping.find((m) => m.column === 'horario_fim')?.target).toBe('best_contact_end');
    expect(mapping.find((m) => m.column === 'fuso_horario')?.target).toBe('best_contact_timezone');
  });

  it('validates row with valid start and end BTC window', () => {
    const mapping: ColumnMapping[] = [
      { column: 'id', target: 'external_id', type: 'text', required: true },
      { column: 'h_ini', target: 'best_contact_start', type: 'text', required: false },
      { column: 'h_fim', target: 'best_contact_end', type: 'text', required: false },
      { column: 'fuso', target: 'best_contact_timezone', type: 'text', required: false },
    ];
    const row: ParsedRow = {
      rowNumber: 2,
      values: { id: 'cli_01', h_ini: '14:00', h_fim: '16:30', fuso: 'America/Sao_Paulo' },
    };

    const res = validateRow(row, mapping);
    expect(res.errors).toHaveLength(0);
    expect(res.typed.btc_start_minute).toBe(840);
    expect(res.typed.btc_end_minute).toBe(990);
    expect(res.typed.btc_timezone).toBe('America/Sao_Paulo');
    expect(res.typed.btc_source).toBe('IMPORT');
  });

  it('validates row with start and default duration', () => {
    const mapping: ColumnMapping[] = [
      { column: 'id', target: 'external_id', type: 'text', required: true },
      { column: 'h_ini', target: 'best_contact_start', type: 'text', required: false },
    ];
    const row: ParsedRow = {
      rowNumber: 2,
      values: { id: 'cli_02', h_ini: '10:00' },
    };

    const res = validateRow(row, mapping, { defaultDurationMinutes: 120, defaultTimezone: 'America/Manaus' });
    expect(res.errors).toHaveLength(0);
    expect(res.typed.btc_start_minute).toBe(600);
    expect(res.typed.btc_end_minute).toBe(720); // 10:00 + 120 min = 12:00
    expect(res.typed.btc_timezone).toBe('America/Manaus');
  });

  it('rejects invalid BTC windows (start >= end or crossing midnight)', () => {
    const mapping: ColumnMapping[] = [
      { column: 'id', target: 'external_id', type: 'text', required: true },
      { column: 'h_ini', target: 'best_contact_start', type: 'text', required: false },
      { column: 'h_fim', target: 'best_contact_end', type: 'text', required: false },
    ];

    // Início maior que fim
    const rowInverted: ParsedRow = {
      rowNumber: 2,
      values: { id: 'cli_03', h_ini: '18:00', h_fim: '14:00' },
    };
    const resInverted = validateRow(rowInverted, mapping);
    expect(resInverted.errors.some((e) => e.includes('início deve ser anterior'))).toBe(true);

    // Cruzando meia-noite via duração
    const rowMidnight: ParsedRow = {
      rowNumber: 3,
      values: { id: 'cli_04', h_ini: '23:30' },
    };
    const resMidnight = validateRow(rowMidnight, mapping, { defaultDurationMinutes: 60 });
    expect(resMidnight.errors.some((e) => e.includes('meia-noite'))).toBe(true);
  });

  it('accepts duplicate contacts with identical normalized BTC preferences in buildPreview', () => {
    const csv = `external_id,telefone,inicio,fim\ncli_dup,11988881111,14:00,16:00\ncli_dup,11988882222,14:00,16:00`;
    const mapping: ColumnMapping[] = [
      { column: 'external_id', target: 'external_id', type: 'text', required: true },
      { column: 'telefone', target: 'phone1', type: 'text', required: false },
      { column: 'inicio', target: 'best_contact_start', type: 'text', required: false },
      { column: 'fim', target: 'best_contact_end', type: 'text', required: false },
    ];
    const preview = buildPreview(csv, ',', true, mapping);
    expect(preview.response.schemaErrors).toHaveLength(0);
    expect(preview.response.rejectedRows).toBe(0);
    expect(preview.response.validRows).toBe(2);
  });

  it('flags conflict error when duplicate contacts have conflicting BTC preferences in buildPreview', () => {
    const csv = `external_id,telefone,inicio,fim\ncli_conf,11988881111,10:00,12:00\ncli_conf,11988882222,14:00,18:00`;
    const mapping: ColumnMapping[] = [
      { column: 'external_id', target: 'external_id', type: 'text', required: true },
      { column: 'telefone', target: 'phone1', type: 'text', required: false },
      { column: 'inicio', target: 'best_contact_start', type: 'text', required: false },
      { column: 'fim', target: 'best_contact_end', type: 'text', required: false },
    ];
    const preview = buildPreview(csv, ',', true, mapping);
    expect(preview.response.rejectedRows).toBe(2);
    expect(preview.response.validRows).toBe(0);
    expect(preview.response.rows[0].errors[0]).toContain('Conflito de preferências de horário (BTC)');
  });

  it('parses single column range format (e.g. "14:00 - 16:30" or "14:00 às 18:00")', () => {
    const mapping: ColumnMapping[] = [
      { column: 'id', target: 'external_id', type: 'text', required: true },
      { column: 'bttc', target: 'best_contact_start', type: 'text', required: false },
    ];
    const rowDash: ParsedRow = {
      rowNumber: 2,
      values: { id: 'cli_single_1', bttc: '14:00 - 16:30' },
    };
    const resDash = validateRow(rowDash, mapping);
    expect(resDash.errors).toHaveLength(0);
    expect(resDash.typed.btc_start_minute).toBe(840);
    expect(resDash.typed.btc_end_minute).toBe(990);

    const rowAs: ParsedRow = {
      rowNumber: 3,
      values: { id: 'cli_single_2', bttc: '09:00 às 12:00' },
    };
    const resAs = validateRow(rowAs, mapping);
    expect(resAs.errors).toHaveLength(0);
    expect(resAs.typed.btc_start_minute).toBe(540);
    expect(resAs.typed.btc_end_minute).toBe(720);
  });
});
