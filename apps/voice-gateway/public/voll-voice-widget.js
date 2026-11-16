(function (global) {
  'use strict';

  const DEFAULT_ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

  class VollWebRtcClient {
    constructor(opts = {}) {
      this.serverUrl = (opts.serverUrl || global.location?.origin || '').replace(/\/+$/, '');
      this.tenantId = opts.tenantId || opts.agentId || 'default';
      this.sessionToken = opts.sessionToken || null;
      this.publicWidgetKey = opts.publicWidgetKey || null;
      this.apiPrefix = (opts.apiPrefix || (this.publicWidgetKey ? '/api/public/webrtc' : '/v1/webrtc')).replace(/\/+$/, '');
      this.apiToken = opts.apiToken || null;
      this.getToken = typeof opts.getToken === 'function' ? opts.getToken : null;
      this.caller = opts.caller || 'web-visitor';
      this.metadata = opts.metadata || {};
      this.onStateChange = opts.onStateChange || (() => {});
      this.onTranscript = opts.onTranscript || (() => {});
      this.onError = opts.onError || (() => {});

      this.pc = null;
      this.dc = null;
      this.localStream = null;
      this.remoteAudio = null;
      this.callId = null;
      this.controlToken = null;
      this.muted = false;
      this.state = 'idle';
    }

    _setState(next) {
      this.state = next;
      try { this.onStateChange(next, this.callId); } catch {}
    }

    async start() {
      if (this.state === 'connecting' || this.state === 'connected') return;
      this._setState('connecting');

      try {
        let token = this.sessionToken;
        if (!token && this.getToken) {
          token = await this.getToken();
        }

        if (!global.navigator?.mediaDevices?.getUserMedia) {
          throw new Error('Navegador sem suporte a WebRTC/Microfone (HTTPS obrigatório fora de localhost).');
        }

        this.localStream = await global.navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });

        this.pc = new global.RTCPeerConnection({ iceServers: DEFAULT_ICE });
        this.localStream.getTracks().forEach((track) => this.pc.addTrack(track, this.localStream));

        this.dc = this.pc.createDataChannel('voll-events');
        this.dc.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === 'transcript') {
              this.onTranscript(msg);
            } else if (msg.type === 'transferred_to_sip') {
              this._setState('transferred');
            }
          } catch {}
        };

        this.remoteAudio = global.document.createElement('audio');
        this.remoteAudio.autoplay = true;
        this.remoteAudio.playsInline = true;
        this.pc.ontrack = (ev) => {
          if (ev.streams && ev.streams[0]) {
            this.remoteAudio.srcObject = ev.streams[0];
          } else {
            const ms = new global.MediaStream([ev.track]);
            this.remoteAudio.srcObject = ms;
          }
          this.remoteAudio.play().catch(() => {});
        };

        this.pc.onconnectionstatechange = () => {
          const st = this.pc?.connectionState;
          if (st === 'connected') this._setState('connected');
          else if (st === 'failed' || st === 'closed' || st === 'disconnected') {
            this.stop(true);
          }
        };

        const offer = await this.pc.createOffer({ offerToReceiveAudio: true });
        await this.pc.setLocalDescription(offer);

        await new Promise((resolve) => {
          if (this.pc.iceGatheringState === 'complete') return resolve();
          const timer = setTimeout(resolve, 1200);
          this.pc.onicegatheringstatechange = () => {
            if (this.pc.iceGatheringState === 'complete') {
              clearTimeout(timer);
              resolve();
            }
          };
        });

        const headers = { 'Content-Type': 'application/json' };
        if (this.apiToken) headers['Authorization'] = `Bearer ${this.apiToken}`;
        if (this.publicWidgetKey) headers['X-Widget-Key'] = this.publicWidgetKey;

        const resp = await global.fetch(`${this.serverUrl}${this.apiPrefix}/offer`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ...(this.publicWidgetKey ? {} : { tenantId: this.tenantId }),
            sessionToken: token || undefined,
            publicWidgetKey: this.publicWidgetKey || undefined,
            caller: this.caller,
            metadata: this.metadata,
            sdpOffer: this.pc.localDescription.sdp
          })
        });

        const data = await resp.json();
        if (!resp.ok || !data.sdpAnswer) {
          throw new Error(data.message || 'Falha na sinalização WebRTC');
        }

        this.callId = data.callId;
        this.controlToken = data.controlToken || null;
        await this.pc.setRemoteDescription({ type: 'answer', sdp: data.sdpAnswer });
        this._setState('connected');
      } catch (err) {
        this.onError(err);
        await this.stop(true);
        throw err;
      }
    }

    setMuted(mute) {
      this.muted = Boolean(mute);
      if (this.localStream) {
        this.localStream.getAudioTracks().forEach((t) => {
          t.enabled = !this.muted;
        });
      }
      if (this.dc && this.dc.readyState === 'open') {
        this.dc.send(JSON.stringify({ type: 'mute', muted: this.muted }));
      }
    }

    interrupt() {
      if (this.dc && this.dc.readyState === 'open') {
        this.dc.send(JSON.stringify({ type: 'interrupt' }));
      }
    }

    async stop(skipRemote = false) {
      const cid = this.callId;
      const ctrl = this.controlToken;
      this.callId = null;
      this.controlToken = null;

      if (!skipRemote && cid) {
        try {
          if (this.dc && this.dc.readyState === 'open') {
            this.dc.send(JSON.stringify({ type: 'hangup' }));
          }
          const delHeaders = {};
          if (ctrl) delHeaders['X-WebRTC-Control-Token'] = ctrl;
          if (this.publicWidgetKey) delHeaders['X-Widget-Key'] = this.publicWidgetKey;
          if (this.apiToken) delHeaders['Authorization'] = `Bearer ${this.apiToken}`;
          global.fetch(`${this.serverUrl}${this.apiPrefix}/${encodeURIComponent(cid)}`, {
            method: 'DELETE',
            headers: delHeaders
          }).catch(() => {});
        } catch {}
      }

      try { this.dc?.close(); } catch {}
      try { this.pc?.close(); } catch {}
      try { this.localStream?.getTracks().forEach((t) => t.stop()); } catch {}
      if (this.remoteAudio) {
        this.remoteAudio.srcObject = null;
      }

      this.dc = null;
      this.pc = null;
      this.localStream = null;
      this.muted = false;
      this._setState('idle');
    }
  }

  function mountWidget(options = {}) {
    const existing = global.document.getElementById('voll-voice-widget-host');
    if (existing) existing.remove();

    const host = global.document.createElement('div');
    host.id = 'voll-voice-widget-host';
    const shadow = host.attachShadow({ mode: 'open' });
    const accent = options.accentColor || '#e11d48';
    const title = options.title || 'Atendente IA · Voll';
    const posRight = options.position !== 'bottom-left';

    shadow.innerHTML = `
      <style>
        :host { all: initial; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        .wrap { position: fixed; bottom: 20px; ${posRight ? 'right: 20px;' : 'left: 20px;'} z-index: 999999; display: flex; flex-direction: column; align-items: ${posRight ? 'flex-end' : 'flex-start'}; gap: 10px; }
        .panel { width: 320px; background: #0f172a; color: #f8fafc; border-radius: 16px; box-shadow: 0 20px 45px rgba(15, 23, 42, 0.35); border: 1px solid rgba(255,255,255,0.12); overflow: hidden; display: none; flex-direction: column; }
        .panel.open { display: flex; }
        .hdr { padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.04); border-bottom: 1px solid rgba(255,255,255,0.08); }
        .hdr-title { font-size: 13px; font-weight: 600; }
        .hdr-status { font-size: 11px; color: #94a3b8; }
        .transcript { height: 180px; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; font-size: 12px; line-height: 1.4; }
        .msg { padding: 7px 10px; border-radius: 10px; max-width: 88%; }
        .msg.ai { background: rgba(255,255,255,0.08); align-self: flex-start; }
        .msg.user { background: ${accent}; color: #fff; align-self: flex-end; }
        .controls { padding: 12px; display: flex; gap: 8px; border-top: 1px solid rgba(255,255,255,0.08); }
        button { cursor: pointer; border: none; font-family: inherit; font-weight: 600; border-radius: 10px; transition: opacity .15s; }
        button:hover { opacity: 0.9; }
        .btn-main { flex: 1; padding: 10px 14px; background: ${accent}; color: #fff; font-size: 13px; }
        .btn-sec { padding: 10px 12px; background: rgba(255,255,255,0.1); color: #f8fafc; font-size: 12px; }
        .fab { height: 54px; padding: 0 18px; border-radius: 999px; background: ${accent}; color: #fff; font-size: 14px; display: flex; align-items: center; gap: 8px; box-shadow: 0 10px 25px rgba(225, 29, 72, 0.35); }
      </style>
      <div class="wrap">
        <div class="panel" id="panel">
          <div class="hdr">
            <div>
              <div class="hdr-title">${title}</div>
              <div class="hdr-status" id="status">Pronto para iniciar</div>
            </div>
            <button class="btn-sec" id="closeBtn" style="padding:4px 8px;">✕</button>
          </div>
          <div class="transcript" id="transcript">
            <div class="hdr-status" style="text-align:center;margin:auto;">Clique em "Falar agora" para iniciar a chamada WebRTC.</div>
          </div>
          <div class="controls">
            <button class="btn-main" id="callBtn">🎙️ Falar agora</button>
            <button class="btn-sec" id="muteBtn" style="display:none;">Mudo</button>
          </div>
        </div>
        <button class="fab" id="fab">🎙️ Falar com IA</button>
      </div>
    `;

    global.document.body.appendChild(host);

    const panel = shadow.getElementById('panel');
    const fab = shadow.getElementById('fab');
    const closeBtn = shadow.getElementById('closeBtn');
    const callBtn = shadow.getElementById('callBtn');
    const muteBtn = shadow.getElementById('muteBtn');
    const statusEl = shadow.getElementById('status');
    const transcriptEl = shadow.getElementById('transcript');

    const client = new VollWebRtcClient({
      ...options,
      onStateChange: (st) => {
        if (st === 'connecting') {
          statusEl.textContent = 'Conectando WebRTC...';
          callBtn.textContent = 'Conectando...';
          callBtn.disabled = true;
        } else if (st === 'connected') {
          statusEl.textContent = 'Em chamada (WebRTC)';
          callBtn.textContent = 'Encerrar';
          callBtn.disabled = false;
          muteBtn.style.display = 'inline-block';
          fab.innerHTML = '🟢 Em chamada';
        } else if (st === 'transferred') {
          statusEl.textContent = 'Transferido para atendente';
        } else {
          statusEl.textContent = 'Pronto para iniciar';
          callBtn.textContent = '🎙️ Falar agora';
          callBtn.disabled = false;
          muteBtn.style.display = 'none';
          muteBtn.textContent = 'Mudo';
          fab.innerHTML = '🎙️ Falar com IA';
        }
      },
      onTranscript: (msg) => {
        if (transcriptEl.children.length === 1 && transcriptEl.children[0].classList.contains('hdr-status')) {
          transcriptEl.innerHTML = '';
        }
        const div = global.document.createElement('div');
        div.className = `msg ${msg.speaker === 'Cliente' ? 'user' : 'ai'}`;
        div.textContent = msg.text;
        transcriptEl.appendChild(div);
        transcriptEl.scrollTop = transcriptEl.scrollHeight;
      },
      onError: (err) => {
        statusEl.textContent = `Erro: ${err.message}`;
      }
    });

    fab.onclick = () => {
      panel.classList.toggle('open');
    };
    closeBtn.onclick = () => panel.classList.remove('open');
    callBtn.onclick = async () => {
      if (client.state === 'idle') {
        transcriptEl.innerHTML = '';
        await client.start().catch(() => {});
      } else {
        await client.stop();
      }
    };
    muteBtn.onclick = () => {
      client.setMuted(!client.muted);
      muteBtn.textContent = client.muted ? 'Ativar mic' : 'Mudo';
    };

    if (options.autoOpen) {
      panel.classList.add('open');
    }

    return { client, host, open: () => panel.classList.add('open') };
  }

  global.VollVoiceWidget = {
    Client: VollWebRtcClient,
    mount: mountWidget
  };

  // Auto-mount se carregado via <script data-voll-auto="true"> ou <script data-widget-key="...">
  if (global.document && global.document.currentScript) {
    const s = global.document.currentScript;
    const scriptUrl = s.src ? new URL(s.src, global.location?.href) : null;
    const widgetKey = s.getAttribute('data-widget-key') || scriptUrl?.searchParams.get('key') || undefined;
    const shouldAutoMount =
      s.getAttribute('data-voll-auto') === 'true' ||
      (Boolean(widgetKey) && s.getAttribute('data-voll-auto') !== 'false');
    if (shouldAutoMount) {
      const init = () => mountWidget({
        serverUrl: s.getAttribute('data-server-url') || scriptUrl?.origin || '',
        tenantId: s.getAttribute('data-agent-id') || 'default',
        publicWidgetKey: widgetKey,
        apiPrefix: s.getAttribute('data-api-prefix') || undefined,
        accentColor: s.getAttribute('data-accent') || undefined,
        title: s.getAttribute('data-title') || undefined
      });
      if (global.document.readyState === 'loading') {
        global.document.addEventListener('DOMContentLoaded', init);
      } else {
        init();
      }
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
