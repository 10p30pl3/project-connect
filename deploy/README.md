# Deploy do Voll Plan (servidor único, Ubuntu + Docker)

## Primeira vez

No seu computador, copie o pacote para o servidor:

```bash
scp voll-plan-deploy.tar.gz root@194.163.151.91:/opt/
```

No servidor:

```bash
cd /opt && mkdir -p voll-plan && tar xzf voll-plan-deploy.tar.gz -C voll-plan && cd voll-plan
./deploy/deploy.sh --voice
```

O script pergunta o IP público, o e-mail do administrador, a chave da OpenAI e o caller ID do tronco, gera `deploy/.env.production` com senhas aleatórias e sobe tudo. No fim mostra o endereço (`http://<IP>`) e a senha inicial do administrador.

- Sem `--voice`: só o Voll Plan (Postgres, API, worker, site), sem gateway de voz.
- `--whisper`: inclui AMD e transcrição (imagem grande; o primeiro build demora).

## Atualizar

Copie o pacote novo por cima e rode `./deploy/deploy.sh --voice` de novo. O banco e o `.env.production` são preservados; migrações novas são aplicadas.

## Depois de subir

1. Entre com o administrador e troque a senha.
2. Em **Canais > Agente de voz**, cadastre o roteiro, a voz e os caller IDs e clique em **Publicar**.
3. Configure o tronco SIP da operadora no painel técnico do gateway (`http://<IP>:8090/dashboard`, só pela rede interna ou túnel SSH) e libere a faixa RTP para o IP da operadora no firewall.

## O que fica exposto

| Porta | Serviço | Exposição |
|---|---|---|
| 80/tcp | Voll Plan (site + API) | pública |
| 5060 udp/tcp | SIP (Drachtio) | operadora |
| faixa RTP udp | áudio (FreeSWITCH) | operadora |
| 8090/tcp | API do gateway | só Docker/local, exige `API_AUTH_TOKEN` |
| 8021, 9022/tcp | ESL do FreeSWITCH, controle do Drachtio | só local |

Sem domínio, o acesso é HTTP puro: senha e cookie trafegam sem criptografia. Assim que houver um domínio, coloque HTTPS (Caddy ou Certbot na frente do Nginx) e mude `COOKIE_SECURE=true`.

## Comandos úteis

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production --profile voice ps
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production logs -f api worker
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production --profile voice logs -f gateway
```
