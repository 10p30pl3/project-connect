const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { formatDateTime } = require('./call-recorder');

const DEFAULT_LOG_FILE = path.join(__dirname, '..', 'recordings', 'calls_history.jsonl');
const MAX_IN_MEMORY_LOGS = 1000;

class CallHistoryManager extends EventEmitter {
  constructor(filePath = null) {
    super();
    this.filePath = filePath || process.env.CALLS_HISTORY_FILE || DEFAULT_LOG_FILE;
    this.inMemoryList = [];
    this.activeCalls = new Map(); // callId -> activeCallEntry
    this.loaded = false;
    this._ensureDir();
    this.loadRecent();
  }

  _ensureDir() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    } catch {}
  }

  loadRecent() {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.inMemoryList = [];
        this.loaded = true;
        return;
      }
      const content = fs.readFileSync(this.filePath, 'utf8');
      const lines = content.split('\n').filter((l) => l.trim().length > 0);
      const items = [];
      for (const line of lines) {
        try {
          items.push(JSON.parse(line));
        } catch {}
      }
      // Ordena decrescente por endTime ou startTime
      items.sort((a, b) => new Date(b.endedAt || b.startedAt || 0) - new Date(a.endedAt || a.startedAt || 0));
      // Deduplica por callId preservando a mais recente/completa
      const seen = new Set();
      const uniqueItems = [];
      for (const item of items) {
        if (item && item.callId) {
          if (seen.has(item.callId)) continue;
          seen.add(item.callId);
        }
        uniqueItems.push(item);
      }
      this.inMemoryList = uniqueItems.slice(0, MAX_IN_MEMORY_LOGS);
      this.loaded = true;
    } catch (err) {
      console.warn('[CallHistoryManager] Erro ao ler histórico de chamadas:', err.message);
      this.inMemoryList = [];
    }
  }

  recordCallStart(callData) {
    if (!callData || !callData.callId) return null;
    try {
      const startedAtDate = callData.startedAt ? new Date(callData.startedAt) : new Date();
      const startedAt = startedAtDate.toISOString();
      const startedAtFormatted = formatDateTime(startedAtDate);

      const activeEntry = {
        callId: callData.callId,
        sipCallId: callData.sipCallId || callData.callId,
        channelUuid: callData.channelUuid || null,
        direction: callData.direction || (callData.isOutbound ? 'outbound' : 'inbound'),
        tenantId: callData.tenantId || 'default',
        caller: callData.caller || 'Desc',
        called: callData.called || '1000',
        remoteAddress: callData.remoteAddress || null,
        userAgent: callData.userAgent || null,
        fsNodeId: callData.fsNodeId || null,
        stsEngine: callData.stsEngine || (callData.tenantId === 'eleven1' ? 'elevenlabs' : 'openai'),
        startedAt,
        startedAtFormatted,
        endedAt: null,
        endedAtFormatted: null,
        durationSec: 0,
        costUsd: 0,
        costBrl: 0,
        totalTokens: 0,
        hangupReason: 'em_andamento',
        hangupBy: 'active',
        codec: callData.codec || 'g711_ulaw',
        deviceMode: callData.deviceMode || 'viva_voz',
        noiseProfile: callData.noiseProfile || 'SILENCE',
        amdResult: callData.amdResult || 'EM_ANALISE',
        sttEnabled: Boolean(callData.sttEnabled),
        transcriptTurnsCount: 0,
        isActive: true,
        transcript: [],
        telephonyLogs: Array.isArray(callData.telephonyLogs) ? callData.telephonyLogs : []
      };

      this.activeCalls.set(callData.callId, activeEntry);
      const enriched = this._enrichRecord(activeEntry);
      this.emit('call_start', enriched);
      return enriched;
    } catch (err) {
      console.error('[CallHistoryManager] Falha ao registrar início da chamada:', err.message);
      return null;
    }
  }

  recordCallUpdate(callId, patch = {}) {
    if (!callId) return null;
    try {
      const active = this.activeCalls.get(callId);
      if (!active) return null;

      if (patch.transcriptTurnsCount !== undefined) active.transcriptTurnsCount = patch.transcriptTurnsCount;
      if (patch.lastTurn) {
        if (!Array.isArray(active.transcript)) active.transcript = [];
        active.transcript.push(patch.lastTurn);
      }
      if (patch.costUsd !== undefined) {
        active.costUsd = Number(patch.costUsd.toFixed(4));
        active.costBrl = Number((active.costUsd * 5.80).toFixed(2));
      }
      if (patch.totalTokens !== undefined) active.totalTokens = patch.totalTokens;
      if (patch.amdResult !== undefined) active.amdResult = patch.amdResult;

      const enriched = this._enrichRecord(active);
      this.emit('call_update', enriched);
      return enriched;
    } catch (err) {
      console.error('[CallHistoryManager] Falha ao atualizar chamada ativa:', err.message);
      return null;
    }
  }

  addTelephonyLog(callId, logEntry) {
    if (!callId || !logEntry) return;
    try {
      const active = this.activeCalls.get(callId);
      if (active) {
        if (!Array.isArray(active.telephonyLogs)) active.telephonyLogs = [];
        const entry = {
          timestamp: logEntry.timestamp || new Date().toISOString(),
          type: logEntry.type || 'INFO',
          message: logEntry.message || String(logEntry),
          details: logEntry.details || null
        };
        active.telephonyLogs.push(entry);
        this.emit('telephony_log', { callId, log: entry });
      }
    } catch {}
  }

  recordCallEnd(callData) {
    try {
      this._ensureDir();
      const endedAtDate = new Date();
      const endedAt = endedAtDate.toISOString();
      const endedAtFormatted = formatDateTime(endedAtDate);

      const existingActive = callData.callId ? this.activeCalls.get(callData.callId) : null;
      if (callData.callId) {
        this.activeCalls.delete(callData.callId);
      }

      let durationSec = callData.durationSec || 0;
      const startedAt = callData.startedAt || (existingActive ? existingActive.startedAt : null);
      if (!durationSec && startedAt) {
        durationSec = Math.max(0, Math.floor((endedAtDate.getTime() - new Date(startedAt).getTime()) / 1000));
      }

      let costUsd = typeof callData.costUsd === 'number' ? callData.costUsd : (existingActive?.costUsd || 0);
      const turnsCount = callData.transcriptTurnsCount || (Array.isArray(callData.transcript) ? callData.transcript.length : (existingActive?.transcriptTurnsCount || 0));
      if (!costUsd && (turnsCount > 0 || durationSec > 0)) {
        costUsd = Number(((turnsCount * 0.00045) + (durationSec * 0.000035)).toFixed(4));
      }
      const costBrl = Number((costUsd * 5.80).toFixed(2));

      const logEntry = {
        callId: callData.callId,
        sipCallId: callData.sipCallId || existingActive?.sipCallId || callData.callId,
        channelUuid: callData.channelUuid || existingActive?.channelUuid || null,
        direction: callData.direction || (callData.isOutbound ? 'outbound' : 'inbound'),
        tenantId: callData.tenantId || existingActive?.tenantId || 'default',
        caller: callData.caller || existingActive?.caller || 'Desc',
        called: callData.called || existingActive?.called || '1000',
        remoteAddress: callData.remoteAddress || existingActive?.remoteAddress || null,
        userAgent: callData.userAgent || existingActive?.userAgent || null,
        fsNodeId: callData.fsNodeId || existingActive?.fsNodeId || null,
        stsEngine: callData.stsEngine || existingActive?.stsEngine || (callData.tenantId === 'eleven1' ? 'elevenlabs' : 'openai'),
        startedAt: startedAt || endedAt,
        endedAt,
        endedAtFormatted,
        durationSec,
        costUsd: Number(costUsd.toFixed(4)),
        costBrl,
        totalTokens: callData.totalTokens || existingActive?.totalTokens || 0,
        hangupReason: callData.hangupReason || 'normal_hangup',
        hangupBy: callData.hangupBy || 'remote',
        codec: callData.codec || existingActive?.codec || 'g711_ulaw',
        deviceMode: callData.deviceMode || existingActive?.deviceMode || 'viva_voz',
        noiseProfile: callData.noiseProfile || existingActive?.noiseProfile || 'SILENCE',
        amdResult: callData.amdResult || existingActive?.amdResult || (callData.amdEnabled ? 'HUMANO' : 'N/A'),
        sttEnabled: Boolean(callData.sttEnabled ?? existingActive?.sttEnabled),
        transcriptTurnsCount: turnsCount,
        recordingFile: callData.recordingFile || null,
        transcriptFile: callData.transcriptFile || null,
        transcript: Array.isArray(callData.transcript) ? callData.transcript : (existingActive?.transcript || []),
        telephonyLogs: Array.isArray(callData.telephonyLogs) && callData.telephonyLogs.length > 0
          ? callData.telephonyLogs
          : (existingActive?.telephonyLogs || []),
        isActive: false
      };

      // Se esta chamada já foi finalizada na lista em memória, atualiza em vez de duplicar linha no jsonl
      const existingEnded = this.inMemoryList.find((c) => c.callId === logEntry.callId && !c.isActive);
      if (existingEnded) {
        if (logEntry.durationSec && (!existingEnded.durationSec || existingEnded.durationSec < logEntry.durationSec)) {
          existingEnded.durationSec = logEntry.durationSec;
        }
        if (logEntry.costUsd > 0) existingEnded.costUsd = logEntry.costUsd;
        if (logEntry.costBrl > 0) existingEnded.costBrl = logEntry.costBrl;
        if (logEntry.totalTokens > 0) existingEnded.totalTokens = logEntry.totalTokens;
        if (logEntry.transcriptTurnsCount > 0) existingEnded.transcriptTurnsCount = logEntry.transcriptTurnsCount;
        if (Array.isArray(logEntry.transcript) && logEntry.transcript.length > 0) {
          existingEnded.transcript = logEntry.transcript;
        }
        if (logEntry.recordingFile) existingEnded.recordingFile = logEntry.recordingFile;
        if (logEntry.transcriptFile) existingEnded.transcriptFile = logEntry.transcriptFile;
        if (logEntry.hangupReason && logEntry.hangupReason !== 'originate_failed' && logEntry.hangupReason !== 'fail_setup') {
          existingEnded.hangupReason = logEntry.hangupReason;
          existingEnded.hangupBy = logEntry.hangupBy;
        }
        const enriched = this._enrichRecord(existingEnded);
        this.emit('call_update', enriched);
        return enriched;
      }

      // Gravação append-only em JSON Lines
      fs.appendFileSync(this.filePath, JSON.stringify(logEntry) + '\n', 'utf8');

      // Remove de inMemoryList caso já estivesse
      this.inMemoryList = this.inMemoryList.filter(c => c.callId !== logEntry.callId);

      // Atualiza lista em memória (no início)
      this.inMemoryList.unshift(logEntry);
      if (this.inMemoryList.length > MAX_IN_MEMORY_LOGS) {
        this.inMemoryList.pop();
      }

      const enriched = this._enrichRecord(logEntry);
      this.emit('call_end', enriched);
      return enriched;
    } catch (err) {
      console.error('[CallHistoryManager] Falha ao registrar log da chamada:', err.message);
      return null;
    }
  }

  _enrichRecord(c) {
    let costUsd = c.costUsd;
    if (typeof costUsd !== 'number') {
      const turns = c.transcriptTurnsCount || (Array.isArray(c.transcript) ? c.transcript.length : 0);
      const dur = c.durationSec || 0;
      if (turns > 0 || dur > 0) {
        costUsd = Number(((turns * 0.00045) + (dur * 0.000035)).toFixed(4));
      } else {
        costUsd = 0.0000;
      }
    }
    const costBrl = typeof c.costBrl === 'number' ? c.costBrl : Number((costUsd * 5.80).toFixed(2));
    return {
      ...c,
      costUsd: Number(costUsd.toFixed(4)),
      costBrl,
      costUsdFormatted: `$${costUsd.toFixed(4)}`,
      costBrlFormatted: `R$ ${costBrl.toFixed(2).replace('.', ',')}`
    };
  }

  getHistory({ limit = 100, tenantId = null, search = '', direction = null } = {}) {
    const now = Date.now();
    const activeList = Array.from(this.activeCalls.values()).map((c) => {
      const dur = c.startedAt ? Math.max(0, Math.floor((now - new Date(c.startedAt).getTime()) / 1000)) : 0;
      return this._enrichRecord({
        ...c,
        durationSec: dur,
        isActive: true,
        hangupReason: 'em_andamento',
        hangupBy: 'active'
      });
    });

    let list = [...activeList, ...this.inMemoryList];

    if (tenantId) {
      list = list.filter((c) => c.tenantId === tenantId);
    }
    if (direction) {
      list = list.filter((c) => c.direction === direction);
    }
    if (search) {
      const q = String(search).toLowerCase().trim();
      list = list.filter(
        (c) =>
          String(c.callId).toLowerCase().includes(q) ||
          String(c.caller).toLowerCase().includes(q) ||
          String(c.called).toLowerCase().includes(q) ||
          String(c.tenantId).toLowerCase().includes(q) ||
          String(c.hangupReason).toLowerCase().includes(q)
      );
    }

    const cappedLimit = Math.min(Math.max(1, parseInt(limit, 10) || 50), MAX_IN_MEMORY_LOGS);
    return {
      total: list.length,
      history: list.slice(0, cappedLimit).map((c) => this._enrichRecord(c))
    };
  }

  getCallDetails(callId) {
    if (!callId) return null;
    const active = this.activeCalls.get(callId);
    if (active) {
      const dur = active.startedAt ? Math.max(0, Math.floor((Date.now() - new Date(active.startedAt).getTime()) / 1000)) : 0;
      return this._enrichRecord({
        ...active,
        durationSec: dur,
        isActive: true,
        hangupReason: 'em_andamento',
        hangupBy: 'active'
      });
    }
    const found = this.inMemoryList.find((c) => c.callId === callId);
    return found ? this._enrichRecord(found) : null;
  }
}

module.exports = CallHistoryManager;
