import type { Role } from '@voll/shared';

/** Permissões do Voll Plan / SaaS Multi-Tenant. Leitura é livre para todos os perfis autenticados. */
export type Permission =
  | 'users.manage'
  | 'mailings.write'
  | 'lists.write'
  | 'journeys.write'
  | 'strategies.write'
  | 'campaigns.create'
  | 'campaigns.operate' // iniciar, pausar, retomar, encerrar
  | 'attempts.reconcile'
  | 'blocks.write'
  | 'blocks.revoke'
  | 'contacts.write' // destinos
  | 'connections.write'
  | 'control.write'
  | 'sim.use'
  | 'voiceAgent.write' // cadastrar e publicar o agente de voz da conexão
  | 'telephony.hangup' // encerrar chamada em andamento
  | 'billing.costs' // visão financeira completa (tarifas, BRL/USD, tokens, consumíveis)
  | 'workspace.provision' // criar novas empresas/tenants e editar planos comerciais
  | 'telephony.globalTrunks'; // publicar e editar troncos globais default

const ALL_CLIENT_ADMIN_PERMS: Permission[] = [
  'users.manage',
  'mailings.write',
  'lists.write',
  'journeys.write',
  'strategies.write',
  'campaigns.create',
  'campaigns.operate',
  'attempts.reconcile',
  'blocks.write',
  'blocks.revoke',
  'contacts.write',
  'connections.write',
  'control.write',
  'sim.use',
  'voiceAgent.write',
  'telephony.hangup',
];

const MATRIX: Record<Role, Permission[]> = {
  SUPER_ADMIN: [...ALL_CLIENT_ADMIN_PERMS, 'billing.costs', 'workspace.provision', 'telephony.globalTrunks'],
  // Suporte Somente-Leitura: pode inspecionar custos e consumo multi-tenant, porém zero mutações
  SUPER_ADMIN_VIEWER: ['billing.costs'],
  ADMIN: ALL_CLIENT_ADMIN_PERMS,
  MANAGER: [
    'mailings.write',
    'lists.write',
    'journeys.write',
    'strategies.write',
    'campaigns.create',
    'campaigns.operate',
    'contacts.write',
    'sim.use',
    'voiceAgent.write',
    'telephony.hangup',
  ],
  SUPERVISOR: ['campaigns.operate', 'attempts.reconcile', 'blocks.write', 'contacts.write', 'sim.use', 'telephony.hangup'],
  OPERATOR: ['sim.use'],
  ANALYST: [],
};

export function can(role: Role | undefined, perm: Permission): boolean {
  if (!role) return false;
  return MATRIX[role]?.includes(perm) ?? false;
}
