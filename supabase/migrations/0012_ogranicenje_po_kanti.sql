-- 0012 — ograničenje zahteva se broji po kanti (p_akcija), ne zbirno po članu.
--
-- Zašto: bibliotekari i administratori imaju veći limit za api/iz-linka.js (200 na sat)
-- nego čitaoci (30 na sat), a Google pretraga ostaje na 30 za sve. Dok je 0007 brojala
-- sve zahteve člana zajedno, jedna kanta bi pojela drugu (bibliotekar sa 150 čitanja
-- linkova više ne bi mogao nijednom da pretraži Google, jer se 150 poredi sa 30).
--
-- Kante koje api/ koristi (api/_lib/zajednicko.js):
--   'api'                    čitaoci (obe funkcije zajedno, kao do sada) i Google pretraga svih
--   'iz-linka:bibliotekar'   iz-linka za bibliotekare i administratore (veći limit)
-- Kanta je zasebna i za ulogu: član čija se uloga promeni ne nasleđuje tuđe brojanje.
--
-- Jedina razlika od 0007: upit koji broji ima `and akcija = p_akcija`, a zaključavanje je
-- po (član, kanta). Potpis, povratna vrednost i prava su isti.
--
-- Ovo je NOVA migracija: 0001 do 0011 se ne menjaju.

create or replace function public.uzmi_zahtev(
  p_clan            uuid,
  p_akcija          text,
  p_najvise         integer default 30,
  p_prozor_sekundi  integer default 3600
)
returns jsonb
language plpgsql
volatile
set search_path = public, pg_temp
as $fn$
declare
  prozor       interval := make_interval(secs => p_prozor_sekundi);
  upotrebljeno integer;
  najstariji   timestamptz;
begin
  -- Serijalizuje istovremene zahteve istog člana u istoj kanti: bez ovoga bi dva zahteva
  -- koja stignu zajedno, kad je upotrebljeno 29 od 30, oba izbrojala 29 i oba prošla.
  perform pg_advisory_xact_lock(hashtextextended(p_clan::text || ':' || p_akcija, 0));

  select count(*), min(vreme)
    into upotrebljeno, najstariji
    from public.zahtevi_api
   where clan_id = p_clan
     and akcija = p_akcija
     and vreme > now() - prozor;

  if upotrebljeno >= p_najvise then
    return jsonb_build_object(
      'dozvoljeno', false,
      'preostalo', 0,
      'ponovo_za_sekundi', greatest(1, ceil(extract(epoch from (najstariji + prozor - now())))::integer)
    );
  end if;

  insert into public.zahtevi_api (clan_id, akcija) values (p_clan, p_akcija);

  -- Povremeno čišćenje starih redova (u proseku svaki 50. poziv), da tabela ne raste.
  if random() < 0.02 then
    delete from public.zahtevi_api where vreme < now() - interval '1 day';
  end if;

  return jsonb_build_object(
    'dozvoljeno', true,
    'preostalo', p_najvise - upotrebljeno - 1,
    'ponovo_za_sekundi', 0
  );
end;
$fn$;

create index if not exists zahtevi_api_clan_kanta_vreme_idx
  on public.zahtevi_api (clan_id, akcija, vreme desc);

-- Prava ostaju ista kao u 0007 (create or replace ih čuva); ponovljeno radi jasnoće.
revoke all on function public.uzmi_zahtev(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.uzmi_zahtev(uuid, text, integer, integer) to service_role;
