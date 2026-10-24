import type { Role } from '@voll/shared';

/** Permissões do MVP conforme docs/API.md (§17.1). Leitura é livre para todos os perfis autenticados. */
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
  | 'sim.use';

const MATRIX: Record<Role, Permission[]> = {
  ADMIN: [
    'users.manage', 'mailings.write', 'lists.write', 'journeys.write', 'strategies.write', 'campaigns.create',
    'campaigns.operate', 'attempts.reconcile', 'blocks.write', 'blocks.revoke', 'contacts.write',
    'connections.write', 'control.write', 'sim.use',
  ],
  MANAGER: [
    'mailings.write', 'lists.write', 'journeys.write', 'strategies.write', 'campaigns.create', 'campaigns.operate',
    'contacts.write', 'sim.use',
  ],
  SUPERVISOR: ['campaigns.operate', 'attempts.reconcile', 'blocks.write', 'contacts.write', 'sim.use'],
  OPERATOR: ['sim.use'],
  ANALYST: [],
};

export function can(role: Role | undefined, perm: Permission): boolean {
  if (!role) return false;
  return MATRIX[role].includes(perm);
}
