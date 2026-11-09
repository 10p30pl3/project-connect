const path = require('path');
const { readJsonList, writeJsonList } = require('./json-store');

const DEFAULT_AI_PROVIDERS = [
  {
    id: 'openai',
    name: 'OpenAI (Speech-to-Speech Realtime)',
    icon: '⚡',
    type: 'realtime_speech',
    active: true,
    defaultModel: 'gpt-realtime-2.1-mini',
    models: [
      'gpt-realtime-2.1-mini',
      'gpt-realtime-2.1',
      'gpt-live-1',
      'gpt-live-1-mini',
      'gpt-realtime-2',
      'gpt-realtime-mini',
      'gpt-realtime'
    ],
    defaultVoice: 'marin',
    voices: [
      'marin',
      'alloy',
      'echo',
      'shimmer',
      'ash',
      'ballad',
      'coral',
      'sage',
      'verse',
      'cedar'
    ],
    apiKey: '',
    audioCodec: 'pcm24k',
    pricingDescription: 'Audio In: $10/M | Audio Out: $20/M | Text In: $0.60/M | Text Out: $2.40/M'
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs (STS / Conversational AI)',
    icon: '🎙️',
    type: 'sts_conversational',
    active: false,
    defaultModel: 'eleven_turbo_v2_5',
    models: [
      'eleven_turbo_v2_5',
      'eleven_multilingual_v2',
      'eleven_flash_v2_5'
    ],
    defaultVoice: 'Rachel',
    voices: [
      'Rachel',
      'Aria',
      'Roger',
      'Sarah',
      'Laura',
      'Charlie',
      'George',
      'Callum',
      'Custom'
    ],
    apiKey: '',
    audioCodec: 'pcm24k',
    pricingDescription: 'Voz Duplex em Tempo Real: ~$0.08 / min'
  }
];

class AiProviderManager {
  constructor(filePath = null) {
    this.filePath = filePath || path.join(__dirname, '..', 'config', 'ai-providers.json');
    this.providers = new Map();
    this.init();
  }

  init() {
    let list = readJsonList(this.filePath);
    if (!list || list.length === 0) {
      list = DEFAULT_AI_PROVIDERS;
      // Preenche com variáveis de ambiente se disponíveis
      if (process.env.OPENAI_API_KEY) {
        list[0].apiKey = process.env.OPENAI_API_KEY;
        list[0].active = true;
      }
      if (process.env.OPENAI_REALTIME_MODEL) {
        list[0].defaultModel = process.env.OPENAI_REALTIME_MODEL;
      }
      if (process.env.ELEVENLABS_API_KEY) {
        list[1].apiKey = process.env.ELEVENLABS_API_KEY;
        list[1].active = true;
      }
      writeJsonList(this.filePath, list);
    }

    this.providers.clear();
    for (const p of list) {
      if (p && p.id) {
        // Assegura campos essenciais
        if (p.id === 'openai' && !p.apiKey && process.env.OPENAI_API_KEY) {
          p.apiKey = process.env.OPENAI_API_KEY;
        }
        if (p.id === 'elevenlabs' && !p.apiKey && process.env.ELEVENLABS_API_KEY) {
          p.apiKey = process.env.ELEVENLABS_API_KEY;
        }
        if (!p.audioCodec) {
          p.audioCodec = process.env.AUDIO_CODEC_MODE || 'pcm24k';
        }
        this.providers.set(p.id, p);
      }
    }
  }

  persist() {
    writeJsonList(this.filePath, [...this.providers.values()]);
  }

  maskKey(key) {
    if (!key || typeof key !== 'string') return '';
    const clean = key.trim();
    if (clean.length <= 10) return '********';
    return `${clean.slice(0, 6)}...${clean.slice(-4)}`;
  }

  mask(provider) {
    if (!provider) return null;
    return {
      ...provider,
      apiKey: provider.apiKey ? this.maskKey(provider.apiKey) : '',
      hasApiKey: Boolean(provider.apiKey && provider.apiKey.trim().length > 0)
    };
  }

  list() {
    return [...this.providers.values()].map((p) => this.mask(p));
  }

  get(id) {
    return this.providers.get(id) || null;
  }

  getRaw(id) {
    return this.providers.get(id) || null;
  }

  addModel(providerId, newModel) {
    const existing = this.providers.get(providerId);
    if (!existing) {
      throw new Error(`Provedor desconhecido: ${providerId}`);
    }
    const cleanModel = String(newModel || '').trim();
    if (!cleanModel) {
      throw new Error('Nome do modelo inválido');
    }
    if (!existing.models) existing.models = [];
    if (!existing.models.includes(cleanModel)) {
      existing.models.unshift(cleanModel);
    }
    existing.defaultModel = cleanModel;
    this.persist();
    return this.mask(existing);
  }

  update(id, data = {}) {
    const existing = this.providers.get(id);
    if (!existing) {
      throw new Error(`Provedor de IA desconhecido: "${id}"`);
    }

    // Se a chave recebida for valor mascarado com reticências ou asteriscos, preserva a chave anterior
    let newApiKey = existing.apiKey;
    if (data.apiKey !== undefined && data.apiKey !== null) {
      const trimmed = String(data.apiKey).trim();
      if (trimmed && !trimmed.includes('...') && !trimmed.startsWith('***')) {
        newApiKey = trimmed;
      }
    }

    const updated = {
      ...existing,
      ...data,
      id: existing.id, // Não permite alterar o ID
      apiKey: newApiKey,
      active: data.active !== undefined ? Boolean(data.active) : existing.active
    };

    if (data.defaultModel) {
      const modelClean = String(data.defaultModel).trim();
      updated.defaultModel = modelClean;
      if (!updated.models) updated.models = [];
      if (!updated.models.includes(modelClean)) {
        updated.models.unshift(modelClean);
      }
    }
    if (Array.isArray(data.models) && data.models.length > 0) {
      updated.models = Array.from(new Set([...data.models.map(m => String(m).trim()).filter(Boolean), ...(updated.models || [])]));
    }
    if (data.defaultVoice) updated.defaultVoice = String(data.defaultVoice).trim();
    if (data.audioCodec) updated.audioCodec = String(data.audioCodec).trim();

    this.providers.set(id, updated);
    this.persist();
    return this.mask(updated);
  }
}

const aiProviderManagerSingleton = new AiProviderManager();

module.exports = aiProviderManagerSingleton;
module.exports.AiProviderManager = AiProviderManager;
