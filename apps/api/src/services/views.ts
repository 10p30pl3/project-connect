/** Formatação das linhas de resposta compartilhadas entre módulos. */
import { ATTEMPT_STATE_LABEL, maskAddress, type AttemptState } from '@voll/shared';

export const ATTEMPT_SELECT = `
  a.id, a.state, a.state_reason, a.channel_type, a.destination_address, a.stage, a.created_at, a.sent_at, a.finalized_at,
  a.tabulation_code, a.campaign_id, a.trace_id, a.strategy_version_id, a.journey_version_id, a.tariff_snapshot,
  a.cost_confirmed, a.lease_until, a.feedback_deadline, a.provider_attempt_id,
  c.id AS contact_id, c.external_id, c.name AS contact_name,
  cn.name AS connection_name, t.name AS tabulation_name, cp.name AS campaign_name`;

export const ATTEMPT_FROM = `
  attempts a JOIN contacts c ON c.id=a.contact_id
  JOIN connections cn ON cn.id=a.connection_id
  JOIN campaigns cp ON cp.id=a.campaign_id
  LEFT JOIN tabulations t ON t.workspace_id=a.workspace_id AND t.code=a.tabulation_code`;

export function nextActionFor(state: AttemptState, reason?: string | null): string {
  switch (state) {
    case 'RESERVED':
      return 'Aguardar envio ao canal (revalidação antes do envio)';
    case 'SENT':
      return 'Aguardar retorno do canal';
    case 'AWAITING_FEEDBACK':
      return 'Aguardar resposta do cliente até o prazo de feedback';
    case 'RECONCILIATION':
      return 'Conferir com o canal; novo envio bloqueado até resolver';
    case 'FINALIZED':
      return 'Reavaliar retentativa ou próximo canal conforme a estratégia';
    case 'RELEASED':
      return reason === 'LEASE_EXPIRED' ? 'Cliente volta a disputar seleção após revalidação' : 'Cliente volta a disputar seleção';
    case 'CANCELLED':
      return 'Manter fluxo encerrado até a restrição cessar';
  }
}

export function attemptRow(r: any) {
  return {
    id: r.id,
    contact: { id: r.contact_id, externalId: r.external_id, name: r.contact_name },
    campaign: { id: r.campaign_id, name: r.campaign_name },
    channelType: r.channel_type,
    connectionName: r.connection_name,
    destinationMasked: maskAddress(r.destination_address),
    stage: r.stage,
    state: r.state,
    stateLabel: ATTEMPT_STATE_LABEL[r.state as AttemptState],
    stateReason: r.state_reason,
    tabulation: r.tabulation_code ? { code: r.tabulation_code, name: r.tabulation_name ?? r.tabulation_code } : null,
    createdAt: r.created_at,
    sentAt: r.sent_at,
    finalizedAt: r.finalized_at,
    nextAction: nextActionFor(r.state, r.state_reason),
  };
}

export const EVENT_LABEL: Record<string, string> = {
  RESERVED: 'Contato reservado',
  DISPATCH_ACCEPTED: 'Enviado ao canal',
  DISPATCH_REJECTED: 'Envio rejeitado pelo canal',
  DISPATCH_INCONCLUSIVE: 'Envio sem confirmação do canal',
  DISPATCH_FAILED: 'Canal indisponível — reserva liberada',
  DELIVERY_CONFIRMED: 'Entrega técnica confirmada',
  RESULT: 'Retorno associado à tentativa',
  OPT_OUT: 'Cliente pediu para não ser contatado',
  LATE_OPT_OUT: 'Opt-out tardio aplicado',
  RESULT_UNKNOWN: 'Resultado inconclusivo do canal',
  DUPLICATE_IGNORED: 'Evento duplicado ignorado',
  LEASE_EXPIRED: 'Reserva expirada sem envio',
  CANCELLED: 'Cancelado antes do envio',
  NO_RETURN: 'Prazo de retorno esgotado',
  RECONCILED: 'Reconciliação resolvida',
  RECONCILED_MANUAL: 'Reconciliação resolvida manualmente',
  LATE_RESULT: 'Resultado tardio registrado (fluxo não reaberto)',
  LATE_DELIVERY: 'Confirmação de entrega tardia',
  RULE_APPLIED: 'Estratégia aplicada',
  STAGE_ADVANCED: 'Avançou para a próxima etapa da jornada',
  FLOW_FINISHED: 'Fluxo encerrado',
};

const REASON_TEXT: Record<string, string> = {
  LEASE_EXPIRED: 'a reserva venceu antes do envio, sem consumir tentativa nem custo',
  DNC: 'o cliente está bloqueado (DNC)',
  DESTINATION_BLOCKED: 'o destino está bloqueado',
  CAMPAIGN_PAUSED: 'a campanha foi pausada antes do envio',
  CAMPAIGN_NOT_RUNNING: 'a campanha não estava em execução no momento do envio',
  GLOBAL_SUSPENSION: 'há suspensão global ativa',
  INVALID_DESTINATION: 'o destino foi marcado como inválido',
  CHANNEL_UNAVAILABLE: 'o canal estava indisponível',
  NO_RETURN: 'o canal não devolveu resultado dentro do prazo',
  RESULT_UNKNOWN: 'o canal informou resultado inconclusivo',
  UNKNOWN_TABULATION: 'o canal devolveu uma tabulação desconhecida',
  DISPATCH_ERROR: 'houve erro técnico no envio sem confirmação de aceite',
  SIM_TIMEOUT: 'o canal não confirmou o aceite do envio',
};

export function explainAttempt(a: any) {
  const tab = a.tabulation_code ? `${a.tabulation_name ?? a.tabulation_code}` : null;
  const reason = a.state_reason ? REASON_TEXT[a.state_reason] ?? a.state_reason : null;
  let whatHappened = '';
  let why = '';
  switch (a.state as AttemptState) {
    case 'RESERVED':
      whatHappened = 'O contato foi reservado para esta campanha e aguarda envio.';
      why = 'Passou em todas as regras de elegibilidade no momento da seleção.';
      break;
    case 'SENT':
      whatHappened = 'A tentativa foi aceita pelo canal.';
      why = 'Aguardando o retorno do canal; entrega técnica não significa contato efetivo.';
      break;
    case 'AWAITING_FEEDBACK':
      whatHappened = 'A mensagem foi entregue tecnicamente.';
      why = 'Aguardando resposta do cliente até o prazo de feedback da jornada.';
      break;
    case 'RECONCILIATION':
      whatHappened = 'A tentativa está em reconciliação.';
      why = reason ? `Motivo: ${reason}. Um novo envio para este cliente fica bloqueado até a resolução.` : 'Não há resultado confiável.';
      break;
    case 'FINALIZED':
      whatHappened = tab ? `A tentativa foi finalizada com a tabulação "${tab}".` : 'A tentativa foi finalizada.';
      why = 'A estratégia preservada na tentativa definiu a próxima ação da inscrição.';
      break;
    case 'RELEASED':
      whatHappened = 'A reserva foi liberada sem envio.';
      why = reason ? `Motivo: ${reason}.` : 'Nenhuma tentativa foi consumida.';
      break;
    case 'CANCELLED':
      whatHappened = 'A tentativa foi cancelada antes do envio.';
      why = reason ? `Motivo: ${reason}.` : 'Nenhuma tentativa foi consumida.';
      break;
  }
  return { whatHappened, why, nextAction: nextActionFor(a.state, a.state_reason) };
}
