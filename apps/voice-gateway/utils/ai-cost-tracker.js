const path = require('path');
const fs = require('fs');
const { readJsonList, writeJsonList } = require('./json-store');

// Tabela de Preços por 1 Milhão de Tokens (USD)
const PRICING_PER_1M = {
  // Geração Live (Novo GPT-Live Full-Duplex)
  'gpt-live-1': {
    audioInput: 32.00,
    audioInputCached: 0.40,
    audioOutput: 64.00,
    textInput: 4.00,
    textInputCached: 0.40,
    textOutput: 24.00
  },
  'gpt-live-1-mini': {
    audioInput: 10.00,
    audioInputCached: 0.30,
    audioOutput: 20.00,
    textInput: 0.60,
    textInputCached: 0.06,
    textOutput: 2.40
  },
  // Geração 2.1
  'gpt-realtime-2.1-mini': {
    audioInput: 10.00,
    audioInputCached: 0.30,
    audioOutput: 20.00,
    textInput: 0.60,
    textInputCached: 0.06,
    textOutput: 2.40
  },
  'gpt-realtime-2.1': {
    audioInput: 40.00,
    audioInputCached: 2.50,
    audioOutput: 80.00,
    textInput: 5.00,
    textInputCached: 1.25,
    textOutput: 20.00
  },
  // Geração 1.x
  'gpt-realtime-mini': {
    audioInput: 10.00,
    audioInputCached: 0.30,
    audioOutput: 20.00,
    textInput: 0.60,
    textInputCached: 0.06,
    textOutput: 2.40
  },
  'gpt-realtime': {
    audioInput: 40.00,
    audioInputCached: 2.50,
    audioOutput: 80.00,
    textInput: 5.00,
    textInputCached: 1.25,
    textOutput: 20.00
  }
};

class AiCostTracker {
  constructor(file = null) {
    this.file = file || path.join(__dirname, '..', 'config', 'ai-costs.json');
    this.logs = readJsonList(this.file);
  }

  calculateTurnCost(model, usage, provider = 'openai') {
    if (!usage) return { costUsd: 0, details: {} };

    if (provider === 'elevenlabs' || (model && String(model).startsWith('eleven_'))) {
      const durationSec = usage.durationSec || usage.audioDurationSec || (usage.totalTokens ? usage.totalTokens / 50 : 0);
      const minutes = durationSec / 60;
      const ratePerMinute = 0.08; // Preço padrão ElevenLabs Conversational AI (~$0.08/min)
      const costUsd = Number((minutes * ratePerMinute).toFixed(5));

      return {
        costUsd,
        details: {
          model: model || 'eleven_turbo_v2_5',
          durationSec: Math.round(durationSec),
          totalTokens: usage.total_tokens || Math.round(durationSec * 50),
          audioInputTokens: usage.input_tokens || Math.round(durationSec * 25),
          audioOutputTokens: usage.output_tokens || Math.round(durationSec * 25),
          textInputTokens: 0,
          textOutputTokens: 0,
          costAudioIn: costUsd * 0.5,
          costAudioOut: costUsd * 0.5,
          costTextIn: 0,
          costTextOut: 0
        }
      };
    }

    const pricing = PRICING_PER_1M[model] || PRICING_PER_1M['gpt-realtime-2.1-mini'];

    const inDetails = usage.input_token_details || {};
    const outDetails = usage.output_token_details || {};
    const cachedDetails = inDetails.cached_tokens_details || {};

    const cachedAudio = cachedDetails.audio_tokens || 0;
    const cachedText = cachedDetails.text_tokens || 0;
    const totalAudioIn = inDetails.audio_tokens || 0;
    const totalTextIn = inDetails.text_tokens || (usage.input_tokens || 0) - totalAudioIn;

    const nonCachedAudioIn = Math.max(0, totalAudioIn - cachedAudio);
    const nonCachedTextIn = Math.max(0, totalTextIn - cachedText);

    const audioOut = outDetails.audio_tokens || 0;
    const textOut = outDetails.text_tokens || (usage.output_tokens || 0) - audioOut;

    const costAudioIn = (nonCachedAudioIn * pricing.audioInput + cachedAudio * pricing.audioInputCached) / 1e6;
    const costTextIn = (nonCachedTextIn * pricing.textInput + cachedText * pricing.textInputCached) / 1e6;
    const costAudioOut = (audioOut * pricing.audioOutput) / 1e6;
    const costTextOut = (textOut * pricing.textOutput) / 1e6;

    const totalCost = costAudioIn + costTextIn + costAudioOut + costTextOut;

    return {
      costUsd: totalCost,
      details: {
        model,
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
        totalTokens: usage.total_tokens || 0,
        audioInputTokens: totalAudioIn,
        audioOutputTokens: audioOut,
        textInputTokens: totalTextIn,
        textOutputTokens: textOut,
        costAudioIn,
        costTextIn,
        costAudioOut,
        costTextOut
      }
    };
  }

  recordUsage({ callId, tenantId, provider = 'openai', model, usage }) {
    if (!usage) return null;
    const { costUsd, details } = this.calculateTurnCost(model, usage, provider);

    const record = {
      id: `ai-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      timestamp: new Date().toISOString(),
      callId,
      tenantId: tenantId || 'default',
      provider,
      model: model || 'gpt-realtime-2.1-mini',
      costUsd,
      ...details
    };

    this.logs.push(record);
    // Limita retenção em memória/disco para as últimas 5.000 requisições
    if (this.logs.length > 5000) {
      this.logs = this.logs.slice(-5000);
    }
    writeJsonList(this.file, this.logs);
    return record;
  }

  getCostSummary() {
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth(); // 0-index

    let totalMonthUsd = 0;
    let totalAllTimeUsd = 0;
    let monthTokens = 0;
    let monthCallsSet = new Set();
    let allCallsSet = new Set();

    const providerCosts = {};

    for (const log of this.logs) {
      const dt = new Date(log.timestamp);
      const isThisMonth = dt.getUTCFullYear() === currentYear && dt.getUTCMonth() === currentMonth;

      totalAllTimeUsd += log.costUsd || 0;
      allCallsSet.add(log.callId);

      const prov = log.provider || 'openai';
      if (!providerCosts[prov]) {
        providerCosts[prov] = {
          provider: prov,
          monthUsd: 0,
          allTimeUsd: 0,
          monthTokens: 0,
          callsCount: 0,
          monthCallsSet: new Set()
        };
      }
      providerCosts[prov].allTimeUsd += log.costUsd || 0;

      if (isThisMonth) {
        totalMonthUsd += log.costUsd || 0;
        monthTokens += log.totalTokens || 0;
        monthCallsSet.add(log.callId);

        providerCosts[prov].monthUsd += log.costUsd || 0;
        providerCosts[prov].monthTokens += log.totalTokens || 0;
        providerCosts[prov].monthCallsSet.add(log.callId);
      }
    }

    const providersArray = Object.values(providerCosts).map(p => ({
      provider: p.provider,
      monthUsd: Number(p.monthUsd.toFixed(4)),
      allTimeUsd: Number(p.allTimeUsd.toFixed(4)),
      monthTokens: p.monthTokens,
      monthCallsCount: p.monthCallsSet.size
    }));

    // Garante que OpenAI e ElevenLabs estejam sempre presentes no catálogo de provedores
    if (!providersArray.find(p => p.provider === 'openai')) {
      providersArray.push({
        provider: 'openai',
        monthUsd: 0.0000,
        allTimeUsd: 0.0000,
        monthTokens: 0,
        monthCallsCount: 0
      });
    }
    if (!providersArray.find(p => p.provider === 'elevenlabs')) {
      providersArray.push({
        provider: 'elevenlabs',
        monthUsd: 0.0000,
        allTimeUsd: 0.0000,
        monthTokens: 0,
        monthCallsCount: 0
      });
    }

    return {
      monthUsd: Number(totalMonthUsd.toFixed(4)),
      monthUsdBrl: Number((totalMonthUsd * 5.80).toFixed(2)), // Cotação comercial de referência
      totalAllTimeUsd: Number(totalAllTimeUsd.toFixed(4)),
      monthTokens,
      monthCallsCount: monthCallsSet.size,
      providers: providersArray
    };
  }

  getStatements({ provider = null, tenantId = null, limit = 100 } = {}) {
    let filtered = [...this.logs];
    if (provider) {
      filtered = filtered.filter(l => (l.provider || 'openai').toLowerCase() === provider.toLowerCase());
    }
    if (tenantId) {
      filtered = filtered.filter(l => l.tenantId === tenantId);
    }

    filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return filtered.slice(0, limit);
  }

  getCostByCallId(callId) {
    if (!callId) return { costUsd: 0, totalTokens: 0, turnsCount: 0 };
    const matching = (this.logs || []).filter(l => l.callId === callId);
    if (!matching.length) return { costUsd: 0, totalTokens: 0, turnsCount: 0 };
    const costUsd = matching.reduce((acc, t) => acc + (t.costUsd || 0), 0);
    const totalTokens = matching.reduce((acc, t) => acc + (t.totalTokens || 0), 0);
    return {
      costUsd: Number(costUsd.toFixed(5)),
      totalTokens,
      turnsCount: matching.length
    };
  }
}

module.exports = new AiCostTracker();
module.exports.AiCostTracker = AiCostTracker;
