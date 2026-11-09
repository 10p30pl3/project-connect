const crypto = require('crypto');

/**
 * Despacha webhook de evento/tabulação para o Voll Plan com autenticação HMAC SHA-256.
 *
 * @param {Object} callback Configuração do callback { url, secret }
 * @param {Object} payload Payload compatível com ConnectorEventSchema do Voll Plan
 * @returns {Promise<boolean>} Retorna true se entregue com sucesso (HTTP 2xx)
 */
async function sendVollPlanWebhook(callback, payload) {
  if (!callback || !callback.url) {
    return false;
  }

  const rawBody = JSON.stringify(payload);
  const secret = callback.secret || '';
  const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(callback.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-voll-signature': signature,
        },
        body: rawBody,
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        console.log(
          `[VollWebhook] ✅ Webhook entregue com sucesso em ${callback.url} (AttemptId: ${payload.attemptId}, Tabulação: ${payload.tabulationCode || payload.type})`
        );
        return true;
      }

      console.warn(
        `[VollWebhook] ⚠️ Webhook retornou status HTTP ${res.status} para ${callback.url} (tentativa ${attempt}/3)`
      );
    } catch (err) {
      console.warn(
        `[VollWebhook] ⚠️ Falha ao conectar em ${callback.url} (tentativa ${attempt}/3): ${err.message}`
      );
    }

    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }

  return false;
}

module.exports = {
  sendVollPlanWebhook,
};
