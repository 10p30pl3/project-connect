const WebSocket = require('ws');
require('dotenv').config({ override: true, path: '.env' });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const url = `wss://api.openai.com/v1/realtime?model=gpt-realtime-mini`;

const ws = new WebSocket(url, {
  headers: {
    Authorization: `Bearer ${OPENAI_API_KEY}`
  }
});

ws.on('open', () => {
  console.log('Connected');
  ws.send(JSON.stringify({
    type: 'session.update',
    session: {
      type: 'realtime', // <--- EXIGIDO NO NOVO GA
      turn_detection: {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500
      }
    }
  }));
});

ws.on('message', (data) => {
  console.log('Received:', data.toString());
  ws.close();
});

ws.on('error', (err) => console.error(err));
