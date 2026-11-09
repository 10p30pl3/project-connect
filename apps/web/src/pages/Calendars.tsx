import { CalendarDays, Copy, Plus, Settings2 } from 'lucide-react';
import { Badge, Button, Card, PageHeader, TableWrap } from '../components/ui';

const calendars = [
  {
    name: 'Comercial Brasil',
    description: 'Padrão para campanhas comerciais e cobrança leve.',
    timezone: 'America/Sao_Paulo',
    windows: 'Seg–Sex · 08:00–18:00',
    holidays: 'Feriados nacionais bloqueados',
    usage: '8 jornadas',
    status: 'Padrão',
  },
  {
    name: 'Comercial estendido',
    description: 'Operações digitais com janela maior e sábado parcial.',
    timezone: 'America/Sao_Paulo',
    windows: 'Seg–Sex · 08:00–20:00 · Sáb 09:00–13:00',
    holidays: 'Feriados nacionais bloqueados',
    usage: '3 jornadas',
    status: 'Ativo',
  },
  {
    name: 'Cobrança conservadora',
    description: 'Contato mais restrito para operações sensíveis.',
    timezone: 'America/Sao_Paulo',
    windows: 'Seg–Sex · 09:00–17:00',
    holidays: 'Nacionais, estaduais e municipais bloqueados',
    usage: '5 jornadas',
    status: 'Ativo',
  },
  {
    name: 'Atendimento 24x7',
    description: 'Uso para fluxos receptivos ou canais assíncronos permitidos.',
    timezone: 'America/Sao_Paulo',
    windows: 'Todos os dias · 00:00–23:59',
    holidays: 'Feriados permitidos',
    usage: '2 jornadas',
    status: 'Ativo',
  },
];

const holidays = [
  { date: '01/01/2027', name: 'Confraternização Universal', type: 'Nacional', action: 'Bloquear dia inteiro' },
  { date: '21/04/2027', name: 'Tiradentes', type: 'Nacional', action: 'Bloquear dia inteiro' },
  { date: '09/07/2027', name: 'Revolução Constitucionalista', type: 'Estadual · SP', action: 'Bloquear dia inteiro' },
  { date: '24/12/2027', name: 'Véspera de Natal', type: 'Cliente', action: 'Bloquear a partir das 13:00' },
];

export function CalendarsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Calendários"
        subtitle="Entidade própria para dias, horários, fuso, feriados e exceções de acionamento."
        tooltip="A campanha seleciona o calendário aplicado. A jornada continua focada na sequência de canais e mensagens."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" aria-hidden />}>
            Novo calendário
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {calendars.map((calendar) => (
          <Card key={calendar.name}>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <CalendarDays className="size-4 text-brand-700" aria-hidden />
                  <h2 className="text-sm font-semibold text-slate-900">{calendar.name}</h2>
                  <Badge tone={calendar.status === 'Padrão' ? 'brand' : 'green'}>{calendar.status}</Badge>
                </div>
                <p className="text-xs text-slate-500">{calendar.description}</p>
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="secondary" icon={<Copy className="size-3.5" aria-hidden />}>Clonar</Button>
                <Button size="sm" variant="secondary" icon={<Settings2 className="size-3.5" aria-hidden />}>Editar</Button>
              </div>
            </div>

            <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
              <Info label="Janela" value={calendar.windows} />
              <Info label="Fuso" value={calendar.timezone} />
              <Info label="Feriados" value={calendar.holidays} />
              <Info label="Uso" value={calendar.usage} />
            </dl>
          </Card>
        ))}
      </div>

      <Card padded={false}>
        <div className="border-b border-slate-100 p-4">
          <h2 className="text-sm font-semibold text-slate-900">Feriados e exceções configuráveis</h2>
          <p className="mt-1 text-xs text-slate-500">Feriados nacionais, estaduais, municipais e bloqueios do cliente podem alterar a próxima janela disponível da campanha.</p>
        </div>
        <TableWrap label="Feriados configurados">
          <table className="data">
            <thead>
              <tr>
                <th>Data</th>
                <th>Nome</th>
                <th>Tipo</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {holidays.map((holiday) => (
                <tr key={`${holiday.date}-${holiday.name}`}>
                  <td className="font-medium text-slate-800">{holiday.date}</td>
                  <td>{holiday.name}</td>
                  <td>{holiday.type}</td>
                  <td>{holiday.action}</td>
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
