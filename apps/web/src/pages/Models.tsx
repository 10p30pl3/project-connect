import { Copy, LayoutTemplate, Play, Plus } from 'lucide-react';
import { Badge, Button, Card, PageHeader, TableWrap } from '../components/ui';

const models = [
  {
    name: 'Cobrança amigável multicanal',
    channels: 'WhatsApp → Voz → SMS',
    contains: 'Objetivo, jornada, canais, mensagens, regras, calendário, capacidade e exceções',
    mailing: 'Escolher mailing atualizado ao usar',
    status: 'Ativo',
  },
  {
    name: 'Localização de pessoa certa',
    channels: 'Voz → WhatsApp',
    contains: 'Jornada, tabulações, regras de avanço e critérios de parada',
    mailing: 'Escolher mailing atualizado ao usar',
    status: 'Ativo',
  },
  {
    name: 'Confirmação de serviço',
    channels: 'WhatsApp → E-mail',
    contains: 'Mensagem, calendário, fallback, limites e revisão final',
    mailing: 'Escolher mailing atualizado ao usar',
    status: 'Rascunho',
  },
];

export function ModelsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Modelos de campanha"
        subtitle="Pacotes completos de configuração para reutilizar campanhas sem recriar regras a cada execução."
        tooltip="O modelo guarda a configuração da campanha. O mailing é a variável atualizada no momento de usar o modelo."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" aria-hidden />}>
            Novo modelo
          </Button>
        }
      />

      <Card>
        <div className="flex items-start gap-3">
          <LayoutTemplate className="mt-0.5 size-5 text-brand-700" aria-hidden />
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-slate-900">Modelo = modelo de campanha</h2>
            <p className="text-sm text-slate-600">
              Um modelo armazena objetivo, canais, jornada, mensagens, tabulações, calendário, regras operacionais, capacidade,
              destinos e exceções. Ao usar o modelo, a base de contatos é escolhida ou atualizada para aquela nova campanha.
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {models.map((model) => (
          <Card key={model.name} className="flex flex-col">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-slate-900">{model.name}</h2>
                <p className="text-xs font-medium text-slate-500">{model.channels}</p>
              </div>
              <Badge tone={model.status === 'Ativo' ? 'green' : 'gray'}>{model.status}</Badge>
            </div>
            <dl className="mt-4 space-y-3 text-xs">
              <div>
                <dt className="font-medium text-slate-500">Contém</dt>
                <dd className="mt-1 text-slate-800">{model.contains}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Atualizado no uso</dt>
                <dd className="mt-1 text-slate-800">{model.mailing}</dd>
              </div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              <Button size="sm" variant="primary" icon={<Play className="size-3.5" aria-hidden />}>Usar modelo</Button>
              <Button size="sm" variant="secondary" icon={<Copy className="size-3.5" aria-hidden />}>Clonar</Button>
            </div>
          </Card>
        ))}
      </div>

      <Card padded={false}>
        <div className="border-b border-slate-100 p-4">
          <h2 className="text-sm font-semibold text-slate-900">Fluxo ao usar um modelo</h2>
          <p className="mt-1 text-xs text-slate-500">A configuração é reaplicada e o usuário escolhe a base atual antes da revisão.</p>
        </div>
        <TableWrap label="Uso de modelo de campanha">
          <table className="data">
            <thead>
              <tr>
                <th>Etapa</th>
                <th>Comportamento</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="font-medium">1. Selecionar modelo</td><td>Carrega objetivo, jornada, canais, mensagens e regras.</td></tr>
              <tr><td className="font-medium">2. Atualizar mailing</td><td>Escolhe mailing, lista ou importação atualizada.</td></tr>
              <tr><td className="font-medium">3. Revisar e iniciar</td><td>Confere calendário, estimativas, exceções e limites antes de executar.</td></tr>
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </div>
  );
}
