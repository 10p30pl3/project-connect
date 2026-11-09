import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CalendarDays, Plus, Trash2 } from 'lucide-react';
import { del, errorMessage, get, patch, post } from '../lib/api';
import { Badge, Button, Card, PageHeader, useToast } from '../components/ui';

type Window = { days: number[]; start: string; end: string };
type Holiday = { id: string; date: string; name: string; action: 'BLOCK' | 'ALLOW' | 'LIMIT'; startTime?: string | null; endTime?: string | null };
type Calendar = {
  id: string; name: string; description?: string | null; timezone: string;
  windows: Window[]; holidayPolicy: 'BLOCK' | 'ALLOW'; active: boolean; holidays: Holiday[];
};
const days = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const field = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800';

export function CalendarsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['calendars'], queryFn: () => get<{items:Calendar[]}>('/calendars') });
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  const [selectedDays, setSelectedDays] = useState<number[]>([1,2,3,4,5]);
  const [start, setStart] = useState('08:00');
  const [end, setEnd] = useState('18:00');
  const [holidayDraft, setHolidayDraft] = useState<Record<string,{date:string;name:string}>>({});
  const save = useMutation({
    mutationFn: (calendar: Calendar | Omit<Calendar,'id'|'holidays'>) => {
      const payload = { name:calendar.name, description:calendar.description ?? null, timezone:calendar.timezone,
        windows:calendar.windows, holidayPolicy:calendar.holidayPolicy, active:calendar.active };
      return 'id' in calendar ? patch(`/calendars/${calendar.id}`,payload) : post('/calendars',payload);
    },
    onSuccess: async () => { await qc.invalidateQueries({queryKey:['calendars']}); setName(''); toast('success','Calendário salvo.'); },
    onError: (e) => toast('error',errorMessage(e)),
  });
  const addHoliday = useMutation({
    mutationFn: ({calendarId,date,name}:{calendarId:string;date:string;name:string}) =>
      post(`/calendars/${calendarId}/holidays`,{date,name,action:'BLOCK'}),
    onSuccess: async () => { await qc.invalidateQueries({queryKey:['calendars']}); toast('success','Feriado adicionado.'); },
    onError: (e) => toast('error',errorMessage(e)),
  });
  const removeHoliday = useMutation({
    mutationFn: ({calendarId,holidayId}:{calendarId:string;holidayId:string})=>del(`/calendars/${calendarId}/holidays/${holidayId}`),
    onSuccess: async () => { await qc.invalidateQueries({queryKey:['calendars']}); toast('success','Exceção removida.'); },
    onError: (e) => toast('error',errorMessage(e)),
  });
  const toggleDay=(day:number)=>setSelectedDays(v=>v.includes(day)?v.filter(x=>x!==day):[...v,day].sort());

  return <div className="space-y-4">
    <PageHeader title="Calendários" subtitle="Configure dias, horários, fuso e feriados. A campanha escolhe qual calendário aplicar."
      tooltip="Calendário é uma configuração independente da jornada e da estratégia." />
    <Card>
      <div className="mb-3 flex items-center gap-2"><Plus className="size-4 text-brand-700"/><h2 className="text-sm font-semibold">Novo calendário</h2></div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-xs font-medium text-slate-600">Nome<input className={field+' mt-1'} value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: Comercial Brasil"/></label>
        <label className="text-xs font-medium text-slate-600">Fuso horário<input className={field+' mt-1'} value={timezone} onChange={e=>setTimezone(e.target.value)} /></label>
      </div>
      <div className="mt-4"><div className="mb-2 text-xs font-medium text-slate-600">Dias permitidos</div><div className="flex flex-wrap gap-2">{days.map((d,i)=><button key={d} type="button" onClick={()=>toggleDay(i)} className={`rounded-lg border px-3 py-2 text-xs ${selectedDays.includes(i)?'border-brand-500 bg-brand-50 text-brand-700':'border-slate-200 text-slate-500'}`}>{d}</button>)}</div></div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="text-xs font-medium text-slate-600">Início<input type="time" className={field+' mt-1'} value={start} onChange={e=>setStart(e.target.value)}/></label>
        <label className="text-xs font-medium text-slate-600">Fim<input type="time" className={field+' mt-1'} value={end} onChange={e=>setEnd(e.target.value)}/></label>
      </div>
      <div className="mt-3 flex justify-end"><Button variant="primary" disabled={!name.trim()||!selectedDays.length||save.isPending} onClick={()=>save.mutate({name:name.trim(),timezone,windows:[{days:selectedDays,start,end}],holidayPolicy:'BLOCK',active:true})}>Salvar calendário</Button></div>
    </Card>
    {q.isLoading ? <Card>Carregando calendários…</Card> : q.isError ? <Card>Não foi possível carregar calendários: {errorMessage(q.error)}</Card> :
      <div className="grid gap-4 lg:grid-cols-2">{(q.data?.items??[]).map(calendar=><Card key={calendar.id}>
        <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-2"><CalendarDays className="size-4 text-brand-700"/><h2 className="text-sm font-semibold">{calendar.name}</h2><Badge tone={calendar.active?'green':'gray'}>{calendar.active?'Ativo':'Inativo'}</Badge></div></div>
        <p className="mt-1 text-xs text-slate-500">{calendar.timezone} · {calendar.windows.map(w=>`${w.days.map(d=>days[d]).join(', ')} ${w.start}–${w.end}`).join(' · ')} · Feriados bloqueados</p>
        <div className="mt-4 border-t border-slate-100 pt-3"><div className="mb-2 text-xs font-semibold text-slate-700">Feriados e exceções</div>
          {calendar.holidays.length===0?<p className="text-xs text-slate-500">Nenhuma exceção cadastrada.</p>:<ul className="space-y-2">{calendar.holidays.map(h=><li key={h.id} className="flex items-center justify-between text-xs"><span>{h.date.slice(0,10)} · {h.name}</span><button aria-label="Remover feriado" onClick={()=>removeHoliday.mutate({calendarId:calendar.id,holidayId:h.id})} className="text-slate-400 hover:text-rose-600"><Trash2 className="size-4"/></button></li>)}</ul>}
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_2fr_auto]"><input aria-label="Data do feriado" type="date" className={field} value={holidayDraft[calendar.id]?.date??''} onChange={e=>setHolidayDraft(x=>({...x,[calendar.id]:{date:e.target.value,name:x[calendar.id]?.name??''}}))}/><input aria-label="Nome do feriado" className={field} placeholder="Nome do feriado" value={holidayDraft[calendar.id]?.name??''} onChange={e=>setHolidayDraft(x=>({...x,[calendar.id]:{date:x[calendar.id]?.date??'',name:e.target.value}}))}/><Button disabled={!holidayDraft[calendar.id]?.date||!holidayDraft[calendar.id]?.name} onClick={()=>{const h=holidayDraft[calendar.id];if(h)addHoliday.mutate({calendarId:calendar.id,...h});}}>Adicionar</Button></div>
        </div>
      </Card>)}</div>}
  </div>;
}
