/** Seed idempotente para desenvolvimento e homologação. Dados 100% fictícios. */
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import type { StrategyConfig } from '@voll/shared';
import { getPool, one, tx, closePool, type Client } from './pool.js';
import { config } from '../config.js';
import { buildPreview, commitImport } from '../services/importer.js';
import { runIntelligencePipeline } from '../intelligence/cpc-plan-engine.js';

const RULES: StrategyConfig['tabulationRules'] = {
  CONVERSION: 'FINISH_SUCCESS',
  CPC_NO_DEAL: 'RETRY',
  CALLBACK_SCHEDULED: 'SCHEDULE_CALLBACK',
  VOICEMAIL: 'RETRY',
  NO_ANSWER: 'RETRY',
  BUSY: 'RETRY',
  WRONG_PERSON: 'NEXT_DESTINATION',
  INVALID_NUMBER: 'NEXT_DESTINATION',
  OPT_OUT: 'FINISH_FAIL',
  READ_NO_REPLY: 'NEXT_STEP',
  REPLIED: 'RETRY',
};

export const STRATEGIES: { name: string; protected: boolean; config: StrategyConfig }[] = [
  // --- Estratégias Simples (para começar rápido) ---
  {
    name: 'Simples · Disparo Único',
    protected: false,
    config: {
      calendar: { days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00', timezone: 'America/Sao_Paulo' },
      limits: { total: 1, daily: 1, scope: 'WORKSPACE', incompleteHistory: 'USE_KNOWN' },
      retry: { intervalMinutes: 60, maxPerDestination: 1 },
      distribution: { batchSize: 20, maxPending: 50, leaseSeconds: 60 },
      tabulationRules: RULES,
    },
  },
  {
    name: 'Simples · 24x7 (Disparo Imediato)',
    protected: false,
    config: {
      calendar: { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', timezone: 'America/Sao_Paulo' },
      limits: { total: 6, daily: 4, scope: 'WORKSPACE', incompleteHistory: 'USE_KNOWN' },
      retry: { intervalMinutes: 1, maxPerDestination: 2 },
      distribution: { batchSize: 10, maxPending: 20, leaseSeconds: 60 },
      tabulationRules: RULES,
    },
  },
  {
    name: 'Simples · Comercial Leve',
    protected: false,
    config: {
      calendar: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00', timezone: 'America/Sao_Paulo' },
      limits: { total: 3, daily: 1, scope: 'WORKSPACE', incompleteHistory: 'USE_KNOWN' },
      retry: { intervalMinutes: 60, maxPerDestination: 2 },
      distribution: { batchSize: 20, maxPending: 50, leaseSeconds: 60 },
      tabulationRules: RULES,
    },
  },

  // --- Estratégias Completas (avançadas e parametrizáveis) ---
  {
    name: 'Padrão Cobrança',
    protected: true,
    config: {
      calendar: { days: [1, 2, 3, 4, 5], start: '08:00', end: '20:00', timezone: 'America/Sao_Paulo' },
      limits: { total: 10, daily: 3, scope: 'WORKSPACE', incompleteHistory: 'USE_KNOWN' },
      retry: { intervalMinutes: 30, maxPerDestination: 3 },
      distribution: { batchSize: 20, maxPending: 50, leaseSeconds: 60 },
      tabulationRules: RULES,
    },
  },
  {
    name: 'Intensiva (Recuperação)',
    protected: true,
    config: {
      calendar: { days: [1, 2, 3, 4, 5, 6], start: '08:00', end: '21:00', timezone: 'America/Sao_Paulo' },
      limits: { total: 15, daily: 5, scope: 'WORKSPACE', incompleteHistory: 'USE_KNOWN' },
      retry: { intervalMinutes: 15, maxPerDestination: 5 },
      distribution: { batchSize: 40, maxPending: 100, leaseSeconds: 60 },
      tabulationRules: RULES,
    },
  },
  {
    name: 'Confirmação & Agendamentos',
    protected: false,
    config: {
      calendar: { days: [1, 2, 3, 4, 5, 6], start: '08:00', end: '20:00', timezone: 'America/Sao_Paulo' },
      limits: { total: 4, daily: 2, scope: 'WORKSPACE', incompleteHistory: 'USE_KNOWN' },
      retry: { intervalMinutes: 120, maxPerDestination: 2 },
      distribution: { batchSize: 30, maxPending: 60, leaseSeconds: 60 },
      tabulationRules: RULES,
    },
  },
];
// Padrão cobrança também atende sábado das 08:00 às 14:00 — representado no MVP como janela única;
// calendários com faixas por dia são escopo da próxima versão da estratégia.

const TABULATIONS = [
  { code: 'CONVERSION', name: 'Acordo fechado', cpc: true, conv: true },
  { code: 'CPC_NO_DEAL', name: 'Titular sem acordo', cpc: true },
  { code: 'CALLBACK_SCHEDULED', name: 'Reagendamento solicitado', cpc: true, channels: ['VOICE'] },
  { code: 'VOICEMAIL', name: 'Caixa postal', channels: ['VOICE'] },
  { code: 'NO_ANSWER', name: 'Não atendeu' },
  { code: 'BUSY', name: 'Ocupado' },
  { code: 'WRONG_PERSON', name: 'Terceiro' },
  { code: 'INVALID_NUMBER', name: 'Número inválido', inval: true },
  { code: 'OPT_OUT', name: 'Não deseja contato', optout: true },
  { code: 'READ_NO_REPLY', name: 'Lida sem resposta', channels: ['WHATSAPP', 'SMS'] },
  { code: 'REPLIED', name: 'Respondeu', cpc: true, channels: ['WHATSAPP', 'SMS', 'EMAIL'] },
];

const FIRST = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Fábio', 'Gabriela', 'Heitor', 'Isabela', 'João', 'Larissa', 'Marcos', 'Natália', 'Otávio', 'Paula', 'Rafael', 'Sofia', 'Tiago', 'Vera', 'Wagner', 'Sebastião', 'Aparecida', 'Enzo', 'Valentina'];
const LAST = ['Almeida', 'Barbosa', 'Cardoso', 'Duarte', 'Esteves', 'Ferraz', 'Gomes', 'Henriques', 'Lima', 'Moraes'];
const SAMPLE_DDDS = ['11', '21', '31', '41', '47', '51', '61', '62', '71', '81', '85', '91', '92'];

export function sampleCsv(n = 1000): string {
  const lines = ['id;nome;telefone1;telefone2;telefone3;whatsapp1;email;valor_divida;dias_atraso;score;historico;idade'];
  for (let i = 1; i <= n; i++) {
    const id = String(i).padStart(6, '0'); // zeros à esquerda preservados
    const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 3) % LAST.length]}`;
    const ddd = SAMPLE_DDDS[i % SAMPLE_DDDS.length];
    const p = (k: number) => `(${ddd}) 98800-${String(i * 10 + k).padStart(4, '0')}`;
    const t2 = i % 3 === 0 ? `(${ddd}) 3220-${String(i * 10 + 2).padStart(4, '0')}` : '';
    const t3 = i % 7 === 0 ? p(3) : '';
    const wa = i % 2 === 0 ? p(5) : '';
    const email = i % 3 !== 0 ? `cliente${id}@exemplo.test` : '';
    const valor = (250 + ((i * 137) % 4800)).toFixed(2).replace('.', ',');
    const atraso = 5 + ((i * 17) % 180);
    const score = (i * 29) % 101;
    const hist = i % 5 === 0 ? '' : String((i * 3) % 4); // alguns sem histórico conhecido
    const idade = i % 6 === 0 ? '' : String(20 + ((i * 11) % 52)); // algumas idades observadas e outras para inferência
    lines.push([id, name, p(1), t2, t3, wa, email, valor, atraso, score, hist, idade].join(';'));
  }
  return lines.join('\n');
}

async function ensureUser(c: Client, orgId: string, email: string, name: string, role: string, password: string) {
  const u = await one(c, `SELECT id FROM users WHERE lower(email)=lower($1)`, [email]);
  if (u) return u.id;
  const hash = await bcrypt.hash(password, 10);
  return (await one(c, `INSERT INTO users (organization_id, email, name, password_hash, role) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [
    orgId, email, name, hash, role,
  ]))!.id;
}

const DEMO = process.env.SEED_DEMO !== 'false';

export async function seed(opts: { withSampleMailing?: boolean } = {}) {
  const withSample = opts.withSampleMailing ?? DEMO;
  return tx(async (c) => {
    let org = await one(c, `SELECT id FROM organizations WHERE name='Voll Solutions'`);
    if (!org) org = await one(c, `INSERT INTO organizations (name) VALUES ('Voll Solutions') RETURNING id`);
    let ws = await one(c, `SELECT id FROM workspaces WHERE organization_id=$1 ORDER BY created_at LIMIT 1`, [org!.id]);
    if (!ws) ws = await one(c, `INSERT INTO workspaces (organization_id, name) VALUES ($1,'Principal') RETURNING id`, [org!.id]);
    const orgId = org!.id as string;
    const wsId = ws!.id as string;

    const adminId = await ensureUser(c, orgId, config.seedAdminEmail, 'Administrador Voll', 'ADMIN', config.seedAdminPassword);
    // usuários de demonstração (senha conhecida): desligados em produção com SEED_DEMO=false
    if (DEMO) {
      await ensureUser(c, orgId, 'ricardo@vollsolutions.com.br', 'Ricardo (Voll Solutions)', 'ADMIN', 'Voll@2026');
      await ensureUser(c, orgId, 'gestor@voll.local', 'Gestora Exemplo', 'MANAGER', 'Voll@2026');
      await ensureUser(c, orgId, 'supervisor@voll.local', 'Supervisor Exemplo', 'SUPERVISOR', 'Voll@2026');
      await ensureUser(c, orgId, 'operador@voll.local', 'Operador Exemplo', 'OPERATOR', 'Voll@2026');
      await ensureUser(c, orgId, 'analista@voll.local', 'Analista Exemplo', 'ANALYST', 'Voll@2026');
    }

    for (const t of TABULATIONS) {
      await c.query(
        `INSERT INTO tabulations (workspace_id, code, name, is_cpc, is_conversion, is_opt_out, invalidates_destination, channel_types)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::channel_type[]) ON CONFLICT (workspace_id, code) DO NOTHING`,
        [wsId, t.code, t.name, !!t.cpc, !!t.conv, !!t.optout, !!t.inval, t.channels ?? ['VOICE', 'WHATSAPP', 'SMS', 'EMAIL']],
      );
    }

    const conn = async (name: string, channel: string, tariff: number | null, outcomes: Record<string, number>) => {
      const ex = await one(c, `SELECT id FROM connections WHERE workspace_id=$1 AND name=$2`, [wsId, name]);
      if (ex) return ex.id as string;
      const simulation = { outcomes, minDelaySeconds: 2, maxDelaySeconds: 8, duplicateRate: 0.15, noReturnRate: 0.05 };
      return (await one(
        c,
        `INSERT INTO connections (workspace_id, name, channel_type, provider, config, webhook_secret, tariff, tariff_updated_at)
         VALUES ($1,$2,$3,'SIMULATED',$4,$5,$6, CASE WHEN $6::numeric IS NULL THEN NULL ELSE now() END) RETURNING id`,
        [wsId, name, channel, JSON.stringify({ simulation }), randomBytes(24).toString('hex'), tariff],
      ))!.id as string;
    };
    const voice = await conn('Discador simulado', 'VOICE', 0.12, {
      NO_ANSWER: 4, BUSY: 1, CPC_NO_DEAL: 2, CONVERSION: 1.2, WRONG_PERSON: 0.8, INVALID_NUMBER: 0.5, OPT_OUT: 0.2, RESULT_UNKNOWN: 0.4,
    });
    const directCallVoice = await (async () => {
      const ex = await one(c, `SELECT id FROM connections WHERE workspace_id=$1 AND name='Discador IA · Tronco Direct Call'`, [wsId]);
      if (ex) return ex.id as string;
      return (await one(
        c,
        `INSERT INTO connections (workspace_id, name, channel_type, provider, config, webhook_secret, tariff, tariff_updated_at, active)
         VALUES ($1, 'Discador IA · Tronco Direct Call', 'VOICE', 'VOICE_APP', $2, $3, 0.08, now(), $4) RETURNING id`,
        [
          wsId,
          JSON.stringify({
            // endereço, token e caller ID vêm do ambiente; sem eles a conexão nasce inativa
            voiceAppBaseUrl: process.env.VOICE_APP_BASE_URL ?? '',
            voiceAppToken: process.env.VOICE_APP_TOKEN ?? '',
            trunkName: 'Direct Call (SIP Trunk)',
            sipServer: 'sip1.directdial.com.br',
            sipPort: 5060,
            sipTransport: 'UDP',
            defaultCallerId: process.env.VOICE_APP_CALLER_ID ?? '',
          }),
          randomBytes(24).toString('hex'),
          Boolean(process.env.VOICE_APP_BASE_URL && process.env.VOICE_APP_CALLER_ID),
        ],
      ))!.id as string;
    })();

    const whatsapp = await conn('WhatsApp simulado', 'WHATSAPP', 0.05, {
      READ_NO_REPLY: 4, REPLIED: 2, CONVERSION: 1, OPT_OUT: 0.3, RESULT_UNKNOWN: 0.3,
    });
    const sms = await conn('SMS simulado', 'SMS', null, { READ_NO_REPLY: 5, REPLIED: 1, OPT_OUT: 0.2 });
    const email = await conn('E-mail transacional', 'EMAIL', 0.01, {
      READ_NO_REPLY: 4, REPLIED: 1.5, CONVERSION: 0.8, OPT_OUT: 0.1,
    });

    const journey = async (name: string, steps: unknown[]) => {
      const ex = await one(c, `SELECT id FROM journeys WHERE workspace_id=$1 AND name=$2`, [wsId, name]);
      if (ex) return;
      const j = await one(c, `INSERT INTO journeys (workspace_id, name) VALUES ($1,$2) RETURNING id`, [wsId, name]);
      await c.query(`INSERT INTO journey_versions (journey_id, version, steps) VALUES ($1,1,$2)`, [j!.id, JSON.stringify(steps)]);
    };
    // Jornadas Simples
    await journey('Voz (Discador Padrão)', [{ channelType: 'VOICE', connectionId: voice, feedbackTimeoutMinutes: 2 }]);
    await journey('Voz IA · Tronco Direct Call', [{ channelType: 'VOICE', connectionId: directCallVoice, feedbackTimeoutMinutes: 3 }]);
    await journey('WhatsApp Simples', [{ channelType: 'WHATSAPP', connectionId: whatsapp, feedbackTimeoutMinutes: 5 }]);
    await journey('E-mail Simples', [{ channelType: 'EMAIL', connectionId: email, feedbackTimeoutMinutes: 15 }]);
    await journey('SMS Simples', [{ channelType: 'SMS', connectionId: sms, feedbackTimeoutMinutes: 5 }]);

    // Jornadas Completas
    await journey('WhatsApp → Voz', [
      { channelType: 'WHATSAPP', connectionId: whatsapp, feedbackTimeoutMinutes: 5 },
      { channelType: 'VOICE', connectionId: voice, feedbackTimeoutMinutes: 2 },
    ]);
    await journey('E-mail → WhatsApp → Voz', [
      { channelType: 'EMAIL', connectionId: email, feedbackTimeoutMinutes: 15 },
      { channelType: 'WHATSAPP', connectionId: whatsapp, feedbackTimeoutMinutes: 5 },
      { channelType: 'VOICE', connectionId: voice, feedbackTimeoutMinutes: 2 },
    ]);
    await journey('Multicanal Completo (360°)', [
      { channelType: 'WHATSAPP', connectionId: whatsapp, feedbackTimeoutMinutes: 5 },
      { channelType: 'VOICE', connectionId: voice, feedbackTimeoutMinutes: 2 },
      { channelType: 'SMS', connectionId: sms, feedbackTimeoutMinutes: 5 },
      { channelType: 'EMAIL', connectionId: email, feedbackTimeoutMinutes: 15 },
    ]);

    for (const s of STRATEGIES) {
      const ex = await one(c, `SELECT id FROM strategies WHERE workspace_id=$1 AND name=$2`, [wsId, s.name]);
      if (ex) continue;
      const st = await one(c, `INSERT INTO strategies (workspace_id, name, protected) VALUES ($1,$2,$3) RETURNING id`, [wsId, s.name, s.protected]);
      await c.query(`INSERT INTO strategy_versions (strategy_id, version, config, published_by) VALUES ($1,1,$2,$3)`, [
        st!.id, JSON.stringify(s.config), adminId,
      ]);
    }

    const TEMPLATES = [
      {
        name: 'Cobrança Preventiva (Lembrete Pré-Vencimento D-3/D-1)',
        description: 'Lembrete amigável enviado antes do vencimento com link do boleto e chave PIX copia-e-cola. Evita entrada em inadimplência e preserva o relacionamento com o cliente.',
        purposeCode: 'COBRANCA',
        journeyName: 'WhatsApp Simples',
        strategyName: 'Simples · Disparo Único',
        usageCount: 34,
      },
      {
        name: 'Cobrança Faixa 1 (1 a 30 dias) — WhatsApp → Voz',
        description: 'Régua digital-first para atrasos recentes. Primeiro toque via WhatsApp oficial com cálculo de encargos; caso não haja confirmação em 120 minutos, transborda automaticamente para ligação ativa do discador.',
        purposeCode: 'COBRANCA',
        journeyName: 'WhatsApp → Voz',
        strategyName: 'Padrão Cobrança',
        usageCount: 48,
      },
      {
        name: 'Recuperação Crítica (30 a 90 dias) — Voz IA Direct Call',
        description: 'Acionamento de alta cadência para carteiras vencidas há mais de 30 dias. Utiliza agente de voz com inteligência artificial para negociar quitação à vista com desconto ou parcelamento imediato com chave PIX.',
        purposeCode: 'COBRANCA',
        journeyName: 'Voz IA · Tronco Direct Call',
        strategyName: 'Intensiva (Recuperação)',
        usageCount: 27,
      },
      {
        name: 'Acordo Rompido — Notificação Imediata 24x7',
        description: 'Acionamento de emergência multicanal ininterrupto (WhatsApp, Voz, SMS e E-mail) disparado no dia seguinte ao não pagamento de parcela de acordo renegociado.',
        purposeCode: 'COBRANCA',
        journeyName: 'Multicanal Completo (360°)',
        strategyName: 'Simples · 24x7 (Disparo Imediato)',
        usageCount: 19,
      },
      {
        name: 'Venda Ativa & Upgrade — WhatsApp Interativo + Voz',
        description: 'Campanha de up-sell e cross-sell para base qualificada. Envia catálogo de novas ofertas de fibra/celular via WhatsApp interativo nos horários de maior propensão e aciona chamada consultiva caso haja interesse.',
        purposeCode: 'VENDAS',
        journeyName: 'WhatsApp → Voz',
        strategyName: 'Simples · Comercial Leve',
        usageCount: 31,
      },
      {
        name: 'Reativação de Inativos (Winback 90d+)',
        description: 'Campanha econômica em 3 toques para resgate de ex-assinantes. Inicia com proposta exclusiva por e-mail, avança para WhatsApp com cupom promocional e realiza ligação final de consultor de retenção.',
        purposeCode: 'VENDAS',
        journeyName: 'E-mail → WhatsApp → Voz',
        strategyName: 'Padrão Cobrança',
        usageCount: 14,
      },
      {
        name: 'Confirmação de Agendamentos (Lembrete D-1 e D-0)',
        description: 'Redução de no-show em consultas, exames e ordens de serviço. Lembrete interativo via WhatsApp 24h antes com botões "Confirmar Presença" ou "Reagendar Horário", atualizando a agenda automaticamente.',
        purposeCode: 'AGENDAMENTOS',
        journeyName: 'WhatsApp Simples',
        strategyName: 'Confirmação & Agendamentos',
        usageCount: 56,
      },
      {
        name: 'Janela de Chegada Técnica — SMS em Trânsito',
        description: 'Disparo de alta velocidade por SMS avisando que o técnico iniciou o deslocamento até o endereço cadastrado, com previsão de chegada em até 30 minutos e código de identificação do colaborador.',
        purposeCode: 'CONFIRMACAO_SERVICO',
        journeyName: 'SMS Simples',
        strategyName: 'Simples · Disparo Único',
        usageCount: 42,
      },
      {
        name: 'Pesquisa NPS & CSAT — Pós-Atendimento SAC',
        description: 'Avaliação rápida de atendimento disparada 15 minutos após a conclusão de chamados. Coleta nota de 0 a 10 no WhatsApp e registra feedback aberto sobre a resolução do operador.',
        purposeCode: 'PESQUISA_RELACIONAMENTO',
        journeyName: 'WhatsApp Simples',
        strategyName: 'Simples · Disparo Único',
        usageCount: 65,
      },
      {
        name: 'Alerta Crítico de Indisponibilidade & Manutenção',
        description: 'Disparo massivo imediato nos 4 canais para comunicar falhas de rede, manutenção preventiva programada ou avisos de segurança ininterruptos para clientes da região afetada.',
        purposeCode: 'ATENDIMENTO_SUPORTE',
        journeyName: 'Multicanal Completo (360°)',
        strategyName: 'Simples · 24x7 (Disparo Imediato)',
        usageCount: 8,
      },
    ];

    for (const tmpl of TEMPLATES) {
      const ex = await one(c, `SELECT id FROM campaign_templates WHERE workspace_id=$1 AND name=$2`, [wsId, tmpl.name]);
      if (ex) continue;
      const jRow = await one<{ id: string; vid: string }>(c, `
        SELECT j.id, (SELECT jv.id FROM journey_versions jv WHERE jv.journey_id = j.id ORDER BY jv.version DESC LIMIT 1) as vid
        FROM journeys j WHERE j.workspace_id=$1 AND j.name=$2
      `, [wsId, tmpl.journeyName]);
      const sRow = await one<{ id: string; vid: string }>(c, `
        SELECT s.id, (SELECT sv.id FROM strategy_versions sv WHERE sv.strategy_id = s.id ORDER BY sv.version DESC LIMIT 1) as vid
        FROM strategies s WHERE s.workspace_id=$1 AND s.name=$2
      `, [wsId, tmpl.strategyName]);

      await c.query(
        `INSERT INTO campaign_templates (
          workspace_id, name, description, purpose_code,
          journey_id, journey_version_id, strategy_id, strategy_version_id,
          start_mode, usage_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'NOW', $9)`,
        [
          wsId,
          tmpl.name,
          tmpl.description,
          tmpl.purposeCode,
          jRow?.id ?? null,
          jRow?.vid ?? null,
          sRow?.id ?? null,
          sRow?.vid ?? null,
          tmpl.usageCount,
        ],
      );
    }

    if (withSample) {
      let ex = await one(c, `SELECT id FROM mailings WHERE workspace_id=$1 AND name='Carteira exemplo'`, [wsId]);
      if (!ex) {
        const preview = buildPreview(sampleCsv(), 'auto', true);
        const imported = await commitImport(c, { id: wsId }, adminId, 'Carteira exemplo', preview);
        ex = { id: imported.mailingId };
        const dnc = await one(c, `SELECT id FROM contacts WHERE workspace_id=$1 AND external_id='000001'`, [wsId]);
        if (dnc)
          await c.query(
            `INSERT INTO blocks (workspace_id, scope, contact_id, reason, origin, created_by) VALUES ($1,'CONTACT',$2,'Solicitação registrada no SAC (exemplo)','MANUAL',$3)`,
            [wsId, dnc.id, adminId],
          );
      }
      const existingRun = await one(c, `SELECT id FROM mailing_intelligence_runs WHERE workspace_id=$1 LIMIT 1`, [wsId]);
      if (!existingRun && ex?.id) {
        await runIntelligencePipeline(
          c,
          wsId,
          adminId,
          {
            mailingId: ex.id,
            mode: 'PARALLEL_BOTH',
            purposeCode: 'COBRANCA',
            purposePrompt:
              'Renegociação amigável de faturas em atraso; priorizar menor custo por CPC confirmado por tabulação, respeitando janela Wi-Fi no Norte/Nordeste e DDD local.',
            labSamplePct: 25,
            plannedDaysWaves: 3,
            maxAttemptsPerContact: 4,
            maxAcceptableCpcBrl: 1.8,
            autoDispatchProduction: true,
          },
          { preSimulateLabWaves: 2 },
        );
      }
    }
    return { organizationId: orgId, workspaceId: wsId, adminId };
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  seed()
    .then(async (r) => {
      console.log('seed ok', r);
      console.log(`login: ${config.seedAdminEmail}${DEMO ? ` / ${config.seedAdminPassword}` : ' (senha definida em SEED_ADMIN_PASSWORD)'}`);
      await closePool();
    })
    .catch(async (e) => {
      console.error(e);
      await closePool();
      process.exit(1);
    });
}
void getPool;
