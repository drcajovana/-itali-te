-- 0004 — direktne preporuke između povezanih čitalaca.
--
-- Nema slobodnog dopisivanja (plan, tačka 3): poruka uvek visi o konkretnoj
-- knjizi. Ili je preporuka, ili odgovor na preporuku.

create table public.preporuke (
  id            uuid primary key default gen_random_uuid(),
  posiljalac_id uuid not null references public.clanovi(id) on delete cascade,
  primalac_id   uuid not null references public.clanovi(id) on delete cascade,
  knjiga_id     uuid not null references public.knjige(id) on delete cascade,
  poruka        text,
  procitana     boolean not null default false,
  odgovor       text,
  skrivena      boolean not null default false,
  kreirana      timestamptz not null default now(),

  constraint preporuke_ne_salje_sebi check (posiljalac_id <> primalac_id)
);

create index preporuke_primalac_idx  on public.preporuke (primalac_id, kreirana desc);
create index preporuke_posiljalac_idx on public.preporuke (posiljalac_id, kreirana desc);

-- Pošiljalac ne menja preporuku pošto je poslata, niti prima odgovor u svoje ime.
create or replace function public.preporuke_zastita()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if public.je_bibliotekar() then
    return new;
  end if;

  new.posiljalac_id := old.posiljalac_id;
  new.primalac_id   := old.primalac_id;
  new.knjiga_id     := old.knjiga_id;
  new.poruka        := old.poruka;
  new.skrivena      := old.skrivena;
  return new;
end;
$fn$;

create trigger preporuke_zastita_bu
  before update on public.preporuke
  for each row execute function public.preporuke_zastita();

alter table public.preporuke enable row level security;

-- Preporuke vidi samo pošiljalac i primalac (plan, tačka 4).
create policy preporuke_ucesnici_select on public.preporuke
  for select to authenticated
  using (posiljalac_id = auth.uid() or primalac_id = auth.uid());

-- Izuzetak: bibliotekar vidi samo onu preporuku koja je prijavljena. Moderacija
-- ne sme da znači uvid u svu prepisku.
create policy preporuke_prijavljene_select on public.preporuke
  for select to authenticated
  using (
    public.je_bibliotekar()
    and exists (
      select 1 from public.prijave p
       where p.tip = 'preporuka' and p.stavka_id = preporuke.id
    )
  );

-- Ključno pravilo: preporuka se može upisati samo ako veza postoji.
-- Provera stoji u politici, ne u aplikaciji (plan, tačka 4).
create policy preporuke_insert on public.preporuke
  for insert to authenticated
  with check (
    posiljalac_id = auth.uid()
    and public.aktivan_clan()
    and public.su_povezani(auth.uid(), primalac_id)
  );

-- Primalac označava pročitano i upisuje odgovor; trigger iznad čuva ostalo.
create policy preporuke_primalac_update on public.preporuke
  for update to authenticated
  using (primalac_id = auth.uid())
  with check (primalac_id = auth.uid());

create policy preporuke_bibliotekar_update on public.preporuke
  for update to authenticated
  using (public.je_bibliotekar())
  with check (public.je_bibliotekar());

create policy preporuke_delete on public.preporuke
  for delete to authenticated
  using (posiljalac_id = auth.uid() or public.je_bibliotekar());

revoke all on public.preporuke from anon;
grant select, insert, update, delete on public.preporuke to authenticated;
