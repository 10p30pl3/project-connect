#!/usr/bin/env bash
# Implanta o Voll Plan num servidor Ubuntu com Docker.
#
#   ./deploy/deploy.sh            Voll Plan (Postgres, API, worker, site)
#   ./deploy/deploy.sh --voice    + gateway de voz (Drachtio, FreeSWITCH, agente de IA)
#   ./deploy/deploy.sh --voice --whisper   + AMD/transcrição (imagem grande, alguns minutos)
#
# Na primeira execução gera deploy/.env.production com segredos aleatórios e pergunta a chave da
# OpenAI e o caller ID. Rodar de novo atualiza o código, aplica migrações e reinicia, sem perder dados.
set -euo pipefail

cd "$(dirname "$0")"
DEPLOY_DIR="$(pwd)"
ENV_FILE="$DEPLOY_DIR/.env.production"
COMPOSE=(docker compose -f "$DEPLOY_DIR/docker-compose.prod.yml" --env-file "$ENV_FILE")

VOICE=false
WHISPER=false
for arg in "$@"; do
  case "$arg" in
    --voice) VOICE=true ;;
    --whisper) WHISPER=true; VOICE=true ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "opção desconhecida: $arg"; exit 1 ;;
  esac
done

say() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || fail "Docker não encontrado."
docker compose version >/dev/null 2>&1 || fail "Plugin 'docker compose' não encontrado (apt install docker-compose-plugin)."
command -v openssl >/dev/null || fail "openssl não encontrado (apt install openssl)."

rand() { openssl rand -hex "${1:-24}"; }

if [[ ! -f "$ENV_FILE" ]]; then
  say "Primeira instalação: gerando $ENV_FILE"
  SERVER_IP_DEFAULT="$(hostname -I 2>/dev/null | awk '{print $1}')"
  read -r -p "IP público do servidor [$SERVER_IP_DEFAULT]: " SERVER_IP
  SERVER_IP="${SERVER_IP:-$SERVER_IP_DEFAULT}"
  read -r -p "E-mail do administrador [admin@vollsolutions.com.br]: " ADMIN_EMAIL
  ADMIN_EMAIL="${ADMIN_EMAIL:-admin@vollsolutions.com.br}"
  read -r -s -p "Chave da OpenAI para o agente de voz (Enter para depois): " OPENAI_KEY; echo
  read -r -p "Caller ID padrão do tronco, com DDI (ex.: +551130001000, Enter para depois): " CALLER_ID
  GATEWAY_TOKEN="$(rand 32)"
  ADMIN_PASSWORD="$(rand 9)"
  umask 077
  cat > "$ENV_FILE" <<EOF
# Gerado por deploy.sh em $(date -Iseconds). Guarde em local seguro; não versionar.
SERVER_IP=$SERVER_IP
POSTGRES_PASSWORD=$(rand 24)

# --- API Voll Plan ---
JWT_SECRET=$(rand 32)
AUTH_DISABLED=false
COOKIE_SECURE=false
WEB_ORIGIN=http://$SERVER_IP
# a API recebe os retornos do gateway por aqui (Nginx na porta 80 do próprio servidor)
API_PUBLIC_URL=http://127.0.0.1
SEED_DEMO=false
SEED_ADMIN_EMAIL=$ADMIN_EMAIL
SEED_ADMIN_PASSWORD=$ADMIN_PASSWORD
OPENAI_API_KEY=$OPENAI_KEY

# --- conexão do Voll Plan com o gateway de voz ---
VOICE_APP_BASE_URL=http://host.docker.internal:8090
VOICE_APP_TOKEN=$GATEWAY_TOKEN
VOICE_APP_CALLER_ID=$CALLER_ID

# --- gateway de voz ---
API_AUTH_TOKEN=$GATEWAY_TOKEN
DRACHTIO_SECRET=$(rand 16)
DRACHTIO_EXTERNAL_IP=$SERVER_IP
DEFAULT_CALLER_ID=$CALLER_ID
OPENAI_REALTIME_MODEL=gpt-realtime-mini
AMD_DEFAULT_ENABLED=false
STT_DEFAULT_ENABLED=false
LEGACY_OUTREACH_ENABLED=false
EOF
  echo "Arquivo criado. Senha inicial do administrador ($ADMIN_EMAIL): $ADMIN_PASSWORD"
fi

set -a; source "$ENV_FILE"; set +a

PROFILES=()
$VOICE && PROFILES+=(--profile voice)
$WHISPER && PROFILES+=(--profile whisper)

say "Construindo imagens"
"${COMPOSE[@]}" "${PROFILES[@]}" build

say "Subindo o banco"
"${COMPOSE[@]}" up -d db
for i in $(seq 1 60); do
  "${COMPOSE[@]}" exec -T db pg_isready -U voll -d voll_plan >/dev/null 2>&1 && break
  sleep 2
  [[ $i == 60 ]] && fail "Postgres não respondeu."
done

say "Backup pré-migração (rotação automática das 3 últimas cópias)"
BACKUP_DIR="$DEPLOY_DIR/backups"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/voll_plan_$(date +%Y%m%d_%H%M%S).sql.gz"
"${COMPOSE[@]}" exec -T db pg_dump -U voll -d voll_plan | gzip -c > "$BACKUP_FILE"
ls -1t "$BACKUP_DIR"/voll_plan_*.sql.gz 2>/dev/null | tail -n +4 | xargs -r rm -f
ls -lh "$BACKUP_FILE"

say "Aplicando migrações"
"${COMPOSE[@]}" run --rm --no-deps api node dist/db/migrate.js

say "Dados iniciais (organização, administrador, catálogo)"
"${COMPOSE[@]}" run --rm --no-deps api node dist/db/seed.js

say "Subindo API, worker e site"
"${COMPOSE[@]}" up -d api worker web

if $VOICE; then
  [[ -n "${OPENAI_API_KEY:-}" ]] || echo "Aviso: OPENAI_API_KEY vazia em $ENV_FILE; o agente não vai falar até ser preenchida."
  say "Subindo gateway de voz (Drachtio, FreeSWITCH, gateway)"
  "${COMPOSE[@]}" "${PROFILES[@]}" up -d drachtio freeswitch gateway
  $WHISPER && "${COMPOSE[@]}" "${PROFILES[@]}" up -d whisper
fi

# Firewall: só fecha o que não deve ficar exposto, se o ufw estiver ativo.
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  say "Ajustando ufw (ufw ativo)"
  ufw allow 22/tcp >/dev/null
  ufw allow 80/tcp >/dev/null
  if $VOICE; then
    # API do gateway: só a rede interna do Docker (a API do Voll Plan); ESL do FreeSWITCH: só local
    ufw allow from 172.16.0.0/12 to any port 8090 proto tcp >/dev/null
    ufw deny 8090/tcp >/dev/null
    ufw deny 8021/tcp >/dev/null
    ufw deny 9022/tcp >/dev/null
    ufw allow 5060 >/dev/null
    echo "Libere também a faixa RTP do FreeSWITCH para o IP da operadora (ex.: ufw allow from <IP do tronco> to any port 16384:32768 proto udp)."
  fi
fi

say "Limpando cache antigo do Docker Builder"
docker builder prune -af >/dev/null 2>&1 || true

say "Verificando"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1/api/health" >/dev/null 2>&1; then
    echo "Voll Plan no ar: http://$SERVER_IP"
    echo "Login: $SEED_ADMIN_EMAIL (senha em $ENV_FILE, SEED_ADMIN_PASSWORD; troque no primeiro acesso)"
    $VOICE && echo "Gateway de voz: em Canais > Agente de voz, cadastre o roteiro e clique em Publicar."
    exit 0
  fi
  sleep 2
done
"${COMPOSE[@]}" ps
fail "A API não respondeu em /api/health. Veja: docker compose -f deploy/docker-compose.prod.yml logs api"
