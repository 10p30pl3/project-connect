import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, '..');
const repoRoot = join(apiRoot, '../..');

function readRel(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

describe('Governança Arquitetural SaaS (app_architecture_dependency_map.md)', () => {
  it('documenta as 4 camadas e referencia todos os módulos críticos', () => {
    const mapPath = join(repoRoot, 'app_architecture_dependency_map.md');
    expect(existsSync(mapPath)).toBe(true);
    const doc = readFileSync(mapPath, 'utf8');

    for (const ref of [
      'packages/shared/src/index.ts',
      'apps/api/src/config/env-validator.ts',
      'apps/api/src/lib/crypto.ts',
      'apps/api/src/lib/idempotency.ts',
      'apps/api/src/db/partition-service.ts',
      'apps/api/src/auth/context.ts',
      'apps/api/src/modules/telephony.ts',
      'apps/api/src/modules/billing.ts',
      'voice-app/utils/api-router.js',
    ]) {
      expect(doc).toContain(ref);
    }
  });

  it('mantém numeração sequencial e isolada de migrations SQL (001..011+)', () => {
    const migDir = join(apiRoot, 'migrations');
    const files = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
    expect(files.length).toBeGreaterThanOrEqual(11);
    expect(files).toContain('010_enum_roles.sql');
    expect(files).toContain('011_saas_monitor_architecture.sql');
    for (let i = 0; i < files.length; i += 1) {
      const prefix = String(i + 1).padStart(3, '0') + '_';
      expect(files[i].startsWith(prefix)).toBe(true);
    }
    const enumSql = readFileSync(join(migDir, '010_enum_roles.sql'), 'utf8');
    expect(enumSql).toContain('SUPER_ADMIN');
    expect(enumSql).toContain('SUPER_ADMIN_VIEWER');
  });

  it('enforce de roles SaaS, separação estrita Super Admin vs Cliente (tempo-apenas) e BYOK mascarado', () => {
    const shared = readRel('packages/shared/src/index.ts');
    expect(shared).toContain("'SUPER_ADMIN'");
    expect(shared).toContain("'SUPER_ADMIN_VIEWER'");
    expect(shared).toContain('export function isSuperAdminRole');
    expect(shared).toContain('export function isReadOnlyRole');

    const ctx = readRel('apps/api/src/auth/context.ts');
    expect(ctx).toContain('enforceViewerReadOnly');
    expect(ctx).toContain('requireSuperAdmin');
    expect(ctx).toContain('user_workspaces');

    const billing = readRel('apps/api/src/modules/billing.ts');
    expect(billing).toContain("viewMode: 'CLIENT_TIME_ONLY'");
    expect(billing).toContain("viewMode: 'SUPER_ADMIN_FULL'");
    expect(billing).toContain('requireSuperAdmin');

    const tel = readRel('apps/api/src/modules/telephony.ts');
    expect(tel).toContain('sanitizeTrunkForTenant');
    expect(tel).toContain('sanitizeCallItem');
    expect(tel).toContain('GLOBAL_DEFAULT');
    expect(tel).toContain('TENANT_BYOK');
  });

  it('aplica lazy loading nas rotas web e manifest version.json no Vite', () => {
    const router = readRel('apps/web/src/router.tsx');
    expect(router).toContain('lazyNamed');
    expect(router).toContain("path: '/consumo'");
    expect(router).toContain("path: '/billing'");

    const main = readRel('apps/web/src/main.tsx');
    expect(main).toContain('vite:preloadError');

    const viteCfg = readRel('apps/web/vite.config.ts');
    expect(viteCfg).toContain('version.json');
  });
});
