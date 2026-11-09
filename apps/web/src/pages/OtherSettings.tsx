import { Compass, Copy, Gauge, MoreHorizontal, Route, SlidersHorizontal, UsersRound } from 'lucide-react';
import { Badge, Button, Card, PageHeader, TableWrap } from '../components/ui';

const advancedStrategies = [
  { name: 'Voz · discador externo conservador', channel: 'Voz', summary: 'Pedido de discagem por API, baixa simultaneidade e retentativa por tabulação.' },
  { name: 'WhatsApp · resposta em 24h', channel: 'WhatsApp', summary: 'Envio por API, webhook de entrega/leitura/resposta e fallback por ausência de retorno.' },
  { name: 'SMS · fallback final', channel: 'SMS', summary: 'Envio por gateway API com DLR e encerramento quando não houver retorno.' },
];

const personalizedJourneys = [
  { journey: 'Cobrança amigável', channel: 'Voz', customization: 'Tentativas por telefone, timeout e regras por tabulação.' },
  { journey: 'Localização CPC', channel: 'WhatsApp', customization: 'Janela de espera, opt-out e fallback para voz.' },
];

export function OtherSettingsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Outras configurações"
        subtitle="Área para ajustes profissionais que não devem aparecer no caminho básico da campanha."
        tooltip="Mantém a experiência simples para usuários básicos e preserva profundidade para usuários profissionais."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <div className="flex items-start gap-3">
            <SlidersHorizontal className="mt-0.5 size-5 text-brand-700" aria-hidden />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Estratégias avançadas guardadas</h2>
              <p className="mt-1 text-xs text-slate-500">Configurações técnicas reutilizáveis por canal, sem aparecer como etapa obrigatória da campanha.</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-start gap-3">
            <Compass className="mt-0.5 size-5 text-brand-700" aria-hidden />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Jornadas personalizadas</h2>
              <p className="mt-1 text-xs text-slate-500">Personalização por jornada e canal, gerando nova versão quando salva.</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-start gap-3">
            <MoreHorizontal className="mt-0.5 size-5 text-brand-700" aria-hidden />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Destinos e capacidade</h2>
              <p className="mt-1 text-xs text-slate-500">Ajustes operacionais avançados mantidos fora da jornada padrão.</p>
            </div>
          </div>
        </Card>
      </div>

      <Card padded={false}>
        <div className="border-b border-slate-100 p-4">
          <h2 className="text-sm font-semibold text-slate-900">Estratégias avançadas guardadas</h2>
          <p className="mt-1 text-xs text-slate-500">Editar ou clonar configurações profissionais por canal.</p>
        </div>
        <TableWrap label="Estratégias avançadas">
          <table className="data">
            <thead>
              <tr>
                <th>Configuração</th>
                <th>Canal</th>
                <th>Resumo</th>
                <th className="text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {advancedStrategies.map((item) => (
                <tr key={item.name}>
                  <td className="font-medium text-slate-800">{item.name}</td>
                  <td><Badge tone="brand">{item.channel}</Badge></td>
                  <td>{item.summary}</td>
                  <td className="text-right"><Button size="sm" variant="secondary" icon={<Copy className="size-3.5" aria-hidden />}>Clonar</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <Card padded={false}>
        <div className="border-b border-slate-100 p-4">
          <h2 className="text-sm font-semibold text-slate-900">Jornadas personalizadas</h2>
          <p className="mt-1 text-xs text-slate-500">Personalizações ficam fora do editor simples de jornada.</p>
        </div>
        <TableWrap label="Personalizações por jornada">
          <table className="data">
            <thead>
              <tr>
                <th>Jornada</th>
                <th>Canal</th>
                <th>Personalização</th>
              </tr>
            </thead>
            <tbody>
              {personalizedJourneys.map((item) => (
                <tr key={`${item.journey}-${item.channel}`}>
                  <td className="font-medium text-slate-800">{item.journey}</td>
                  <td><Badge tone="blue">{item.channel}</Badge></td>
                  <td>{item.customization}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><Route className="size-4" aria-hidden /> Destinos</span>}>
          <p className="text-sm text-slate-600">Regras de alternância de telefone, canal digital e fallback ficam aqui quando exigirem controle profissional.</p>
        </Card>
        <Card title={<span className="flex items-center gap-2"><Gauge className="size-4" aria-hidden /> Capacidade</span>}>
          <p className="text-sm text-slate-600">Limites de concorrência, capacidade do discador externo, API rate limit e proteções globais ficam separados da jornada simples.</p>
        </Card>
        <Card title={<span className="flex items-center gap-2"><UsersRound className="size-4" aria-hidden /> Profissional</span>}>
          <p className="text-sm text-slate-600">Usuários avançados podem aprofundar a configuração sem forçar o usuário básico a entender parâmetros técnicos.</p>
        </Card>
      </div>
    </div>
  );
}
