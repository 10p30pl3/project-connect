# Gateway de voz (antigo voice-app). Roda com network_mode: host por causa de SIP/RTP.
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app/apps/voice-gateway
# contratos compartilhados com o Voll Plan (lidos por utils/voll-contract.js)
COPY packages/shared/contracts /app/packages/shared/contracts
COPY apps/voice-gateway/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY apps/voice-gateway ./
RUN mkdir -p config recordings logs
CMD ["node", "index.js"]
