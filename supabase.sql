-- Executa isto no SQL Editor do Supabase, de uma só vez.

create table if not exists public.ledger_doc (
  id          text primary key,
  data        jsonb not null default '{"txs":[],"skips":{}}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.ledger_doc enable row level security;

-- Só utilizadores autenticados neste projeto podem ler e escrever.
drop policy if exists "ler autenticados"      on public.ledger_doc;
drop policy if exists "inserir autenticados"  on public.ledger_doc;
drop policy if exists "atualizar autenticados" on public.ledger_doc;

create policy "ler autenticados" on public.ledger_doc
  for select to authenticated using (true);

create policy "inserir autenticados" on public.ledger_doc
  for insert to authenticated with check (true);

create policy "atualizar autenticados" on public.ledger_doc
  for update to authenticated using (true) with check (true);

-- Linha inicial do livro de contas.
insert into public.ledger_doc (id) values ('casa') on conflict (id) do nothing;
