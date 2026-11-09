const path = require('path');
const { readJsonList, writeJsonList } = require('./json-store');

const MAX_RECIPIENTS = 1000;
const MAX_JOBS_KEPT = 200;

/**
 * Disparos para clientes (voz, SMS, WhatsApp), um ou vários destinatários.
 * Modo "individual": uma chamada/mensagem por destinatário, com concorrência limitada.
 */
class OutreachManager {
  constructor({ providerManager, originateCallHandler = null, file = null }) {
    this.providerManager = providerManager;
    this.originateCallHandler = originateCallHandler;
    this.file = file || path.join(__dirname, '..', 'config', 'outreach.json');
    this.jobs = new Map();
    for (const j of readJsonList(this.file)) {
      // jobs interrompidos por reinício não são retomados automaticamente
      if (j.status === 'running' || j.status === 'queued') {
        j.status = 'interrupted';
        for (const r of j.recipients) if (['queued', 'calling'].includes(r.status)) r.status = 'interrupted';
      }
      this.jobs.set(j.id, j);
    }
  }

  setOriginateHandler(fn) {
    this.originateCallHandler = fn;
  }

  persist() {
    const list = [...this.jobs.values()].slice(-MAX_JOBS_KEPT);
    writeJsonList(this.file, list);
  }

  list() {
    return [...this.jobs.values()].reverse().map((j) => this.summary(j));
  }

  summary(j) {
    const counts = {};
    for (const r of j.recipients) counts[r.status] = (counts[r.status] || 0) + 1;
    const { recipients, ...rest } = j;
    return { ...rest, total: recipients.length, counts };
  }

  get(id) {
    const j = this.jobs.get(id);
    return j ? { ...this.summary(j), recipients: j.recipients } : null;
  }

  validate(body) {
    const channel = body.channel || 'voice';
    if (!['voice', 'sms', 'whatsapp'].includes(channel)) throw new Error('"channel" deve ser voice, sms ou whatsapp');
    if (body.mode && body.mode !== 'individual') throw new Error('Somente mode "individual" está disponível nesta versão');
    const raw = Array.isArray(body.recipients) ? body.recipients : body.to ? [body.to] : [];
    if (!raw.length) throw new Error('Informe "recipients" (lista) ou "to"');
    if (raw.length > MAX_RECIPIENTS) throw new Error(`Máximo de ${MAX_RECIPIENTS} destinatários por disparo`);
    const recipients = raw.map((r) => {
      const o = typeof r === 'string' ? { to: r } : r;
      const to = String(o?.to || '').replace(/[^\d+]/g, '');
      if (to.replace(/\D/g, '').length < 8) throw new Error(`Destinatário inválido: ${o?.to}`);
      return { to, vars: o.vars || {}, status: 'queued', attempts: 0 };
    });
    if (channel !== 'voice') {
      if (!body.providerId) throw new Error('"providerId" é obrigatório para sms/whatsapp');
      const p = this.providerManager.get(body.providerId);
      if (!p || p.type !== channel) throw new Error(`Provedor "${body.providerId}" não é do tipo ${channel}`);
      if (!body.message) throw new Error('"message" é obrigatória para sms/whatsapp');
    } else if (!this.originateCallHandler) {
      throw new Error('Originação de voz indisponível');
    }
    return { channel, recipients };
  }

  create(body) {
    const { channel, recipients } = this.validate(body);
    const job = {
      id: `out-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      channel,
      mode: 'individual',
      tenantId: body.tenantId || 'default',
      trunkId: body.trunkId || null,
      providerId: body.providerId || null,
      from: body.from || null,
      message: body.message || null,
      amd: body.amd,
      concurrency: Math.min(50, Math.max(1, parseInt(body.concurrency, 10) || 3)),
      status: 'queued',
      createdAt: new Date().toISOString(),
      recipients,
      cancelled: false
    };
    this.jobs.set(job.id, job);
    this.persist();
    setImmediate(() => this.run(job).catch((e) => console.error('[Outreach] erro:', e.message)));
    return this.summary(job);
  }

  addRecipients(id, list) {
    const j = this.jobs.get(id);
    if (!j) return null;
    if (['done', 'cancelled'].includes(j.status)) throw new Error(`Disparo já finalizado (${j.status})`);
    const { recipients } = this.validate({
      channel: j.channel, providerId: j.providerId, message: j.message, recipients: list
    });
    if (j.recipients.length + recipients.length > MAX_RECIPIENTS) throw new Error('Limite de destinatários excedido');
    j.recipients.push(...recipients);
    this.persist();
    return this.summary(j);
  }

  cancel(id) {
    const j = this.jobs.get(id);
    if (!j) return null;
    j.cancelled = true;
    for (const r of j.recipients) if (r.status === 'queued') r.status = 'cancelled';
    this.persist();
    return this.summary(j);
  }

  async run(job) {
    job.status = 'running';
    const worker = async () => {
      for (;;) {
        if (job.cancelled) return;
        const r = job.recipients.find((x) => x.status === 'queued');
        if (!r) return;
        r.status = 'calling';
        r.attempts += 1;
        r.startedAt = new Date().toISOString();
        try {
          if (job.channel === 'voice') {
            const res = await this.originateCallHandler({
              to: r.to,
              from: job.from || undefined,
              tenantId: job.tenantId,
              amd: job.amd,
              headers: job.trunkId ? { 'X-Trunk-ID': job.trunkId } : {}
            });
            r.status = 'answered';
            r.callId = res.callId;
          } else {
            const res = await this.providerManager.send(job.providerId, {
              to: r.to, from: job.from, message: job.message, vars: r.vars
            });
            r.status = 'sent';
            r.providerResponse = res.response;
          }
        } catch (err) {
          r.status = 'failed';
          r.error = err.message;
        }
        r.finishedAt = new Date().toISOString();
      }
    };
    await Promise.all(Array.from({ length: job.concurrency }, worker));
    // Se algum destinatário ainda ficou na fila (adicionado durante o fim), reprocessa
    if (!job.cancelled && job.recipients.some((x) => x.status === 'queued')) return this.run(job);
    job.status = job.cancelled ? 'cancelled' : 'done';
    job.finishedAt = new Date().toISOString();
    this.persist();
  }
}

module.exports = OutreachManager;
