import { describe, it, expect, beforeEach } from 'vitest';
import { makeApp, resetDb } from './helpers.js';

describe('CRUD unificado de Canais e Preservação de Segredos (008)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('cria canal com configurações básicas e avançadas, atualiza preservando segredos e testa conectividade', async () => {
    const app = await makeApp();
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/connections',
        payload: {
          name: 'WhatsApp Oficial Vendas',
          channelType: 'WHATSAPP',
          provider: 'META_CLOUD',
          endpointUrl: 'https://graph.facebook.com/v19.0',
          authToken: 'secret-bearer-1234',
          whatsappPhoneNumberId: '108293847561029',
          whatsappBusinessAccountId: '992817264510293',
          whatsappVerifyToken: 'verify-xyz',
          whatsappAppSecret: 'app-secret-9876',
          whatsappAccessToken: 'access-tok-5678',
          technical: {
            whatsapp: {
              apiBaseUrl: 'https://graph.facebook.com/v20.0',
              webhookUrl: 'https://api.exemplo.com.br/webhooks/wa',
            },
          },
        },
      });
      expect(created.statusCode).toBe(201);
      const createdBody = created.json();
      expect(createdBody.hasAuthToken).toBe(true);
      expect(createdBody.authTokenMasked).toBe('••••1234');
      expect(createdBody.hasWhatsappAppSecret).toBe(true);
      expect(createdBody.technical?.whatsapp?.apiBaseUrl).toBe('https://graph.facebook.com/v20.0');

      // Edita apenas campo básico enviando token mascarado: não deve sobrescrever o segredo
      const patched = await app.inject({
        method: 'PATCH',
        url: `/api/connections/${createdBody.id}`,
        payload: {
          name: 'WhatsApp Oficial Vendas v2',
          authToken: '••••1234',
          whatsappAppSecret: '***',
          technical: {
            whatsapp: {
              webhookUrl: 'https://api.exemplo.com.br/webhooks/wa-v2',
            },
          },
        },
      });
      expect(patched.statusCode).toBe(200);
      const patchedBody = patched.json();
      expect(patchedBody.name).toBe('WhatsApp Oficial Vendas v2');
      expect(patchedBody.hasAuthToken).toBe(true);
      expect(patchedBody.authTokenMasked).toBe('••••1234');
      expect(patchedBody.hasWhatsappAppSecret).toBe(true);
      expect(patchedBody.technical?.whatsapp?.apiBaseUrl).toBe('https://graph.facebook.com/v20.0');
      expect(patchedBody.technical?.whatsapp?.webhookUrl).toBe('https://api.exemplo.com.br/webhooks/wa-v2');

      // Testa conectividade do canal
      const tested = await app.inject({
        method: 'POST',
        url: `/api/connections/${createdBody.id}/test`,
        payload: {},
      });
      expect(tested.statusCode).toBe(200);
      expect(tested.json().channelType).toBe('WHATSAPP');

      // Exclui canal sem dependências
      const deleted = await app.inject({
        method: 'DELETE',
        url: `/api/connections/${createdBody.id}`,
      });
      expect(deleted.statusCode).toBe(200);
      expect(deleted.json().deleted).toBe(true);
    } finally {
      await app.close();
    }
  });
});
