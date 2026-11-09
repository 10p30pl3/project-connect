INSERT INTO calendars (workspace_id,name,description,timezone,windows,holiday_policy,active)
SELECT w.id,'Comercial Brasil','Segunda a sexta, horário comercial.','America/Sao_Paulo',
       '[{"days":[1,2,3,4,5],"start":"08:00","end":"18:00"}]'::jsonb,'BLOCK',true
FROM workspaces w ON CONFLICT (workspace_id,name) DO NOTHING;

INSERT INTO calendars (workspace_id,name,description,timezone,windows,holiday_policy,active)
SELECT w.id,'Cobrança conservadora','Janela reduzida para operações sensíveis.','America/Sao_Paulo',
       '[{"days":[1,2,3,4,5],"start":"09:00","end":"17:00"}]'::jsonb,'BLOCK',true
FROM workspaces w ON CONFLICT (workspace_id,name) DO NOTHING;

INSERT INTO calendars (workspace_id,name,description,timezone,windows,holiday_policy,active)
SELECT w.id,'Atendimento 24x7','Todos os dias, para operações com disponibilidade contínua.','America/Sao_Paulo',
       '[{"days":[0,1,2,3,4,5,6],"start":"00:00","end":"23:59"}]'::jsonb,'ALLOW',true
FROM workspaces w ON CONFLICT (workspace_id,name) DO NOTHING;