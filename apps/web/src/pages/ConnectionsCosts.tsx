import { Cable, Mail, MessageSquare, PhoneCall, Radio, Smartphone, Webhook } from 'lucide-react';
import { Badge, Button, Card, PageHeader, TableWrap } from '../components/ui';

const digitalConnections = [
  {
    name: 'WhatsApp',
    provider: 'Meta Cloud API / BSP',
    cost: 'R$ por envio, conversa ou tentativa',
    limit: 'Limite da API / provedor',
    webhook: 'Entrega, leitura, resposta, falha e opt-out',
    icon: MessageSquare,
  },
  {
    name: 'SMS',
    provider: 'Gateway SMS',
    cost: 'R$ por SMS ou segmento',
    limit: 'TPS / envios por minuto',
    webhook: 'DLR, entregue e falha',
    icon: Smartphone,
  },
  {
    name: 'E-mail',
    provider: 'SMTP / API de envio',
    cost: 'R$ por envio',
    limit: 'Envios por hora / domínio',
    webhook: 'Abertura, clique, bounce e descadastro',
    icon: Mail,
  },
  {
    name: 'RCS',
    provider: 'Provedor RCS',
    cost: 'R$ por envio RCS',
    limit: 'Limite da API / elegibilidade do aparelho',
    webhook: 'Entregue, lido, falha e fallback para SMS',
    icon: Radio,
  },
];

const events = [
  { source: 'Discador externo', event: 'CALL_REQUEST_ACCEPTED', meaning: 'Pedido de discagem aceito pelo discador.' },
  { source: 'Discador externo', event: 'CALL_RESULT', meaning: 'Resultado da chamada, tabulação, duração e custo confirmado.' },
  { source: 'Canal digital', event: 'DELIVERY_CONFIRMED', meaning: 'Mensagem entregue pelo provedor.' },
  { source: 'Canal digital', event: 'OPT_OUT', meaning: 'Contato solicitou bloqueio ou descadastro.' },
];

export function ConnectionsCostsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Conexões e custos"
        subtitle="Infraestrutura, disponibilidade, callbacks e custo por tentativa para cálculo da melhor forma de encontrar a pessoa certa."
        tooltip="Voz é uma integração por API com um discador externo. Canais digitais usam API, webhook, eventos e modelos de mensagem."
        actions={<Button variant="primary">Nova conexão</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-[1.05fr_1.4fr]">
        <Card
          title={
            <span className="flex items-center gap-2">
              <PhoneCall className="size-4 text-brand-700" aria-hidden />
              Voz · discador externo
            </span>
          }
          tooltip="A Voll não disca diretamente. Ela envia um pedido de discagem para o discador integrado e recebe eventos de retorno."
        >
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Telefonia via API</h2>
                  <p className="mt-1 text-xs text-slate-500">Pedido de discagem enviado ao discador externo.</p>
                </div>
                <Badge tone="blue">API</Badge>
              </div>
            </div>

            <dl className="grid gap-3 text-xs sm:grid-cols-2">
              <Info label="Endpoint" value="POST /dialer/call-requests" />
              <Info label="Retorno" value="Webhook de status e tabulação" />
              <Info label="Custo" value="R$ por chamada ou minuto" />
              <Info label="Capacidade" value="Informada pelo discador" />
              <Info label="Parâmetros enviados" value="Contato, telefone, campanha, prioridade" />
              <Info label="Eventos recebidos" value="Aceito, ocupado, não atende, CPC, falha" />
            </dl>

            <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
              A Voll controla prioridade, regras, calendário e auditoria. O discador controla a chamada, telefonia, agentes, fila e resultado operacional.
            </div>
          </div>
        </Card>

        <Card
          title={
            <span className="flex items-center gap-2">
              <Cable className="size-4 text-brand-700" aria-hidden />
              Canais digitais · API e webhook
            </span>
          }
          tooltip="Cada canal digital possui provedor, API, limite de envio, webhook de retorno e custo próprio."
        >
          <div className="grid gap-3 md:grid-cols-2">
            {digitalConnections.map((conn) => {
              const Icon = conn.icon;
              return (
                <div key={conn.name} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Icon className="size-4 text-brand-700" aria-hidden />
                      <h2 className="text-sm font-semibold text-slate-900">{conn.name}</h2>
                    </div>
                    <Badge tone="green">Digital</Badge>
                  </div>
                  <dl className="mt-3 space-y-2 text-xs">
                    <Line label="API" value={conn.provider} />
                    <Line label="Custo" value={conn.cost} />
                    <Line label="Limite" value={conn.limit} />
                    <Line label="Webhook" value={conn.webhook} />
                  </dl>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card padded={false}>
        <div className="flex items-center gap-2 border-b border-slate-100 p-4">
          <Webhook className="size-4 text-brand-700" aria-hidden />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Eventos normalizados</h2>
            <p className="mt-1 text-xs text-slate-500">Eventos de voz e digitais alimentam observabilidade, custo por tentativa e decisões de retentativa.</p>
          </div>
        </div>
        <TableWrap label="Eventos de conexão">
          <table className="data">
            <thead>
              <tr>
                <th>Origem</th>
                <th>Evento</th>
                <th>Uso no Voll Plan</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.event}>
                  <td>{event.source}</td>
                  <td className="font-mono text-xs text-slate-700">{event.event}</td>
                  <td>{event.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <dt className="font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-800">{value}</dd>
    </div>
  );
}
