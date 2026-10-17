-- Selaras: skema database untuk Supabase.
-- Cara pakai: Supabase Dashboard > SQL Editor > New query > tempel seluruh isi file ini > Run.
-- Aman dijalankan ulang (tidak menghapus data).
--
-- Desain keamanan singkat:
--  * Semua tabel memakai Row Level Security tanpa policy, sehingga kunci publik (publishable/anon)
--    TIDAK bisa membaca atau menulis tabel secara langsung.
--  * Aplikasi hanya memanggil fungsi di bawah (RPC). Tiap fungsi memeriksa dan membatasi isinya.
--  * Jawaban benar kuis tidak pernah dikirim ke pemain sebelum babak jawaban dibuka.
--  * Waktu dan skor kuis dihitung server, bukan perangkat pemain.

-- ---------- Tabel ----------
create table if not exists public.sel_settings (
  k text primary key,
  v text not null
);

create table if not exists public.sel_participants (
  id text primary key,                      -- id rahasia perangkat (tidak pernah ditampilkan)
  data jsonb not null default '{}'::jsonb,  -- nick, seg, pts, mods, dst.
  updated_at timestamptz not null default now()
);

create table if not exists public.sel_games (
  code text primary key,                    -- kode 6 digit
  host_token text not null,
  title text not null,
  questions jsonb not null,                 -- [{q,o:[..],a,t}]
  state text not null default 'lobby',      -- lobby | question | reveal | end
  qi int not null default 0,
  q_started timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.sel_players (
  code text not null references public.sel_games(code) on delete cascade,
  pid text not null,
  nick text not null,
  score int not null default 0,
  streak int not null default 0,
  joined timestamptz not null default now(),
  primary key (code, pid)
);
create unique index if not exists sel_players_nick_uq on public.sel_players (code, lower(nick));

create table if not exists public.sel_answers (
  code text not null,
  qi int not null,
  pid text not null,
  choice int not null,
  pts int not null,
  ms int not null,
  primary key (code, qi, pid),
  foreign key (code, pid) references public.sel_players(code, pid) on delete cascade
);

alter table public.sel_settings enable row level security;
alter table public.sel_participants enable row level security;
alter table public.sel_games enable row level security;
alter table public.sel_players enable row level security;
alter table public.sel_answers enable row level security;

-- ---------- Pembantu ----------
create or replace function public.sel__pub(p_id text) returns text
language sql immutable as $$
  select substr(encode(sha256(convert_to(p_id, 'UTF8')), 'hex'), 1, 24)
$$;

create or replace function public.sel__admin(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from sel_settings where k = 'admin_key' and v = p_key and length(p_key) >= 8)
$$;

-- Status efektif kuis: babak otomatis ditutup saat waktu habis (+1 detik toleransi jaringan)
-- atau saat semua pemain sudah menjawab.
create or replace function public.sel__eff(g public.sel_games) returns text
language plpgsql stable security definer set search_path = public as $$
declare lim int; np int; na int; el numeric;
begin
  if g.state <> 'question' then return g.state; end if;
  lim := coalesce((g.questions -> g.qi ->> 't')::int, 20);
  el := extract(epoch from (clock_timestamp() - g.q_started));
  if el >= lim + 1 then return 'reveal'; end if;
  select count(*) into np from sel_players where code = g.code;
  select count(*) into na from sel_answers where code = g.code and qi = g.qi;
  if np > 0 and na >= np then return 'reveal'; end if;
  return 'question';
end $$;

-- ---------- Peringkat dan rekap ----------
-- Peringkat publik: hanya nama panggilan, segmen, poin, badge. id yang tampil adalah hash, bukan id rahasia.
create or replace function public.sel_board() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', sel__pub(id),
    'data', jsonb_build_object('nick', data -> 'nick', 'seg', data -> 'seg', 'pts', data -> 'pts',
                               'badges', data -> 'badges', 'upd', data -> 'upd'))), '[]'::jsonb)
  from (select * from sel_participants
        order by coalesce((data ->> 'pts')::int, 0) desc, updated_at asc limit 500) t
$$;

-- Rekap lengkap untuk kader (butuh kunci admin).
create or replace function public.sel_rekap(p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not sel__admin(p_key) then raise exception 'Kunci admin salah'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', sel__pub(id), 'data', data)), '[]'::jsonb)
          from (select * from sel_participants order by updated_at desc limit 5000) t);
end $$;

create or replace function public.sel_admin_check(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select sel__admin(p_key)
$$;

create or replace function public.sel_upsert(p_uid text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d jsonb := p_data;
begin
  if p_uid is null or length(p_uid) < 12 or length(p_uid) > 64 then raise exception 'id tidak valid'; end if;
  if d is null or jsonb_typeof(d) <> 'object' then raise exception 'data tidak valid'; end if;
  if octet_length(d::text) > 6000 then raise exception 'data terlalu besar'; end if;
  if length(coalesce(d ->> 'nick', '')) > 16 then raise exception 'nama terlalu panjang'; end if;
  insert into sel_participants (id, data, updated_at) values (p_uid, d, now())
  on conflict (id) do update set data = excluded.data, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.sel_delete(p_uid text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_uid is null or length(p_uid) < 12 then raise exception 'id tidak valid'; end if;
  delete from sel_participants where id = p_uid;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- Kuis live ----------
create or replace function public.sel_quiz_create(p_title text, p_questions jsonb, p_host text) returns text
language plpgsql security definer set search_path = public as $$
declare q jsonb; n int; c text; tries int := 0; i int := 0;
begin
  if p_host is null or length(p_host) < 12 then raise exception 'token host tidak valid'; end if;
  if p_title is null or length(trim(p_title)) < 1 or length(p_title) > 80 then raise exception 'Judul kuis 1 sampai 80 karakter'; end if;
  if p_questions is null or jsonb_typeof(p_questions) <> 'array' then raise exception 'Soal tidak valid'; end if;
  n := jsonb_array_length(p_questions);
  if n < 1 or n > 40 then raise exception 'Jumlah soal harus 1 sampai 40'; end if;
  for q in select * from jsonb_array_elements(p_questions) loop
    i := i + 1;
    if jsonb_typeof(q) <> 'object'
       or jsonb_typeof(q -> 'q') <> 'string' or length(q ->> 'q') not between 1 and 220
       or jsonb_typeof(q -> 'o') <> 'array' or jsonb_array_length(q -> 'o') not between 2 and 4
       or jsonb_typeof(q -> 'a') <> 'number' or (q ->> 'a')::int not between 0 and jsonb_array_length(q -> 'o') - 1
       or (q ? 't' and (jsonb_typeof(q -> 't') <> 'number' or (q ->> 't')::int not between 5 and 120))
       or exists (select 1 from jsonb_array_elements(q -> 'o') e
                  where jsonb_typeof(e) <> 'string' or length(e #>> '{}') not between 1 and 120)
    then raise exception 'Soal nomor % tidak valid', i; end if;
  end loop;
  delete from sel_games where created_at < now() - interval '1 day';
  if (select count(*) from sel_games where created_at > now() - interval '1 minute') > 60 then
    raise exception 'Terlalu banyak kuis dibuat. Coba lagi sebentar.';
  end if;
  loop
    c := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
    begin
      insert into sel_games (code, host_token, title, questions)
      values (c, p_host, trim(p_title),
              (select jsonb_agg(jsonb_build_object('q', e ->> 'q', 'o', e -> 'o', 'a', (e ->> 'a')::int,
                                                   't', coalesce((e ->> 't')::int, 20)))
               from jsonb_array_elements(p_questions) e));
      return c;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 20 then raise exception 'Gagal membuat kode. Coba lagi.'; end if;
    end;
  end loop;
end $$;

create or replace function public.sel_quiz_join(p_code text, p_pid text, p_nick text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g sel_games; nk text := trim(coalesce(p_nick, ''));
begin
  if p_pid is null or length(p_pid) < 8 or length(p_pid) > 64 then raise exception 'id pemain tidak valid'; end if;
  if length(nk) < 2 or length(nk) > 16 then raise exception 'Nama 2 sampai 16 karakter'; end if;
  select * into g from sel_games where code = p_code;
  if not found then raise exception 'Kode kuis tidak ditemukan'; end if;
  if g.state = 'end' then raise exception 'Kuis ini sudah selesai'; end if;
  if exists (select 1 from sel_players where code = p_code and pid = p_pid) then
    update sel_players set nick = nk where code = p_code and pid = p_pid;
  else
    if (select count(*) from sel_players where code = p_code) >= 200 then raise exception 'Ruangan penuh (maksimal 200 pemain)'; end if;
    begin
      insert into sel_players (code, pid, nick) values (p_code, p_pid, nk);
    exception when unique_violation then
      raise exception 'Nama itu sudah dipakai di kuis ini. Pilih nama lain.';
    end;
  end if;
  return jsonb_build_object('ok', true, 'title', g.title, 'total', jsonb_array_length(g.questions));
end $$;

create or replace function public.sel_quiz_host(p_code text, p_token text, p_action text, p_arg text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g sel_games; e text; total int;
begin
  select * into g from sel_games where code = p_code for update;
  if not found then raise exception 'Kode kuis tidak ditemukan'; end if;
  if g.host_token <> p_token then raise exception 'Kamu bukan host kuis ini'; end if;
  e := sel__eff(g); total := jsonb_array_length(g.questions);
  if p_action = 'start' then
    if g.state = 'lobby' then
      if (select count(*) from sel_players where code = p_code) < 1 then raise exception 'Belum ada pemain yang bergabung'; end if;
      update sel_games set state = 'question', qi = 0, q_started = clock_timestamp() where code = p_code;
    end if;
  elsif p_action = 'skip' then
    if e = 'question' then update sel_games set state = 'reveal' where code = p_code; end if;
  elsif p_action = 'next' then
    if e = 'reveal' then
      if g.qi + 1 >= total then
        update sel_games set state = 'end' where code = p_code;
      else
        update sel_games set state = 'question', qi = g.qi + 1, q_started = clock_timestamp() where code = p_code;
      end if;
    end if;
  elsif p_action = 'end' then
    update sel_games set state = 'end' where code = p_code;
  elsif p_action = 'kick' then
    delete from sel_players where code = p_code and pid = p_arg;
  else
    raise exception 'Aksi tidak dikenal';
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.sel_quiz_answer(p_code text, p_pid text, p_qi int, p_choice int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g sel_games; pl sel_players; el numeric; lim int; q jsonb; ok boolean; pts int := 0; bonus int := 0; ms int;
begin
  select * into g from sel_games where code = p_code;
  if not found then return jsonb_build_object('ok', false, 'why', 'kode'); end if;
  select * into pl from sel_players where code = p_code and pid = p_pid for update;
  if not found then return jsonb_build_object('ok', false, 'why', 'belum_gabung'); end if;
  if g.qi <> p_qi or sel__eff(g) <> 'question' then return jsonb_build_object('ok', false, 'why', 'waktu'); end if;
  if exists (select 1 from sel_answers where code = p_code and qi = p_qi and pid = p_pid) then
    return jsonb_build_object('ok', false, 'why', 'sudah');
  end if;
  q := g.questions -> g.qi;
  lim := coalesce((q ->> 't')::int, 20);
  el := extract(epoch from (clock_timestamp() - g.q_started));
  ms := least(greatest(round(el * 1000), 0), 600000)::int;
  ok := (p_choice = (q ->> 'a')::int);
  if ok then
    pts := round(1000 * (1 - (least(el, lim) / lim) / 2))::int;
    bonus := 100 * least(pl.streak, 5);
    pts := pts + bonus;
  end if;
  insert into sel_answers (code, qi, pid, choice, pts, ms) values (p_code, p_qi, p_pid, p_choice, pts, ms);
  update sel_players set score = score + pts, streak = case when ok then streak + 1 else 0 end
  where code = p_code and pid = p_pid;
  return jsonb_build_object('ok', true);
end $$;

-- Satu panggilan untuk semua yang dibutuhkan layar (dipanggil tiap ~1 detik).
create or replace function public.sel_quiz_poll(p_code text, p_pid text default null, p_token text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g sel_games; e text; r jsonb; total int; np int; na int; me sel_players; my sel_answers; q jsonb;
        counts jsonb; top jsonb; lob jsonb; fin jsonb; rk int;
begin
  select * into g from sel_games where code = p_code;
  if not found then return jsonb_build_object('error', 'Kode kuis tidak ditemukan'); end if;
  e := sel__eff(g); total := jsonb_array_length(g.questions);
  select count(*) into np from sel_players where code = p_code;
  select count(*) into na from sel_answers where code = p_code and qi = g.qi;
  r := jsonb_build_object('state', e, 'qi', g.qi, 'total', total, 'title', g.title, 'players', np, 'answered', na,
        'now', round(extract(epoch from clock_timestamp()) * 1000),
        'host', (p_token is not null and p_token = g.host_token));
  if e = 'lobby' then
    select coalesce(jsonb_agg(jsonb_build_object('pid', pid, 'nick', nick) order by joined), '[]'::jsonb) into lob
    from (select * from sel_players where code = p_code order by joined limit 200) t;
    r := r || jsonb_build_object('lobby', lob);
  end if;
  if e in ('question', 'reveal') then
    q := g.questions -> g.qi;
    r := r || jsonb_build_object('started', round(extract(epoch from g.q_started) * 1000),
                                 'limit', coalesce((q ->> 't')::int, 20),
                                 'q', jsonb_build_object('q', q ->> 'q', 'o', q -> 'o'));
  end if;
  if e = 'reveal' then
    select jsonb_agg(coalesce(c.n, 0) order by i.i) into counts
    from generate_series(0, jsonb_array_length(q -> 'o') - 1) i(i)
    left join (select choice, count(*) n from sel_answers where code = p_code and qi = g.qi group by choice) c on c.choice = i.i;
    select coalesce(jsonb_agg(jsonb_build_object('nick', nick, 'score', score) order by score desc, joined), '[]'::jsonb) into top
    from (select * from sel_players where code = p_code order by score desc, joined limit 5) t;
    r := r || jsonb_build_object('a', (q ->> 'a')::int, 'counts', counts, 'top', top);
  end if;
  if e = 'end' then
    select coalesce(jsonb_agg(jsonb_build_object('nick', nick, 'score', score) order by score desc, joined), '[]'::jsonb) into fin
    from (select * from sel_players where code = p_code order by score desc, joined limit 10) t;
    r := r || jsonb_build_object('final', fin);
  end if;
  if p_pid is not null then
    select * into me from sel_players where code = p_code and pid = p_pid;
    if found then
      select count(*) + 1 into rk from sel_players where code = p_code and (score > me.score or (score = me.score and joined < me.joined));
      r := r || jsonb_build_object('me', jsonb_build_object('nick', me.nick, 'score', me.score, 'streak', me.streak, 'rank', rk));
      if e in ('question', 'reveal') then
        select * into my from sel_answers where code = p_code and qi = g.qi and pid = p_pid;
        if found then
          r := jsonb_set(r, '{me}', (r -> 'me') || jsonb_build_object('choice', my.choice)
                 || case when e = 'reveal' then jsonb_build_object('gained', my.pts, 'correct', my.pts > 0) else '{}'::jsonb end);
        elsif e = 'reveal' then
          r := jsonb_set(r, '{me}', (r -> 'me') || jsonb_build_object('gained', 0, 'correct', false));
        end if;
      end if;
    else
      r := r || jsonb_build_object('me', null);
    end if;
  end if;
  return r;
end $$;

-- Hasil lengkap untuk host (untuk unduh CSV).
create or replace function public.sel_quiz_results(p_code text, p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g sel_games;
begin
  select * into g from sel_games where code = p_code;
  if not found then raise exception 'Kode kuis tidak ditemukan'; end if;
  if g.host_token <> p_token then raise exception 'Kamu bukan host kuis ini'; end if;
  return jsonb_build_object(
    'title', g.title, 'questions', g.questions,
    'players', (select coalesce(jsonb_agg(jsonb_build_object(
        'nick', p.nick, 'score', p.score,
        'answers', (select coalesce(jsonb_agg(jsonb_build_object('qi', a.qi, 'choice', a.choice, 'pts', a.pts, 'ms', a.ms) order by a.qi), '[]'::jsonb)
                    from sel_answers a where a.code = p.code and a.pid = p.pid)) order by p.score desc), '[]'::jsonb)
                from sel_players p where p.code = p_code));
end $$;

-- ---------- Hak akses ----------
revoke all on function public.sel__pub(text) from public;
revoke all on function public.sel__admin(text) from public;
revoke all on function public.sel__eff(public.sel_games) from public;
do $$
declare f text;
begin
  foreach f in array array[
    'sel_board()', 'sel_rekap(text)', 'sel_admin_check(text)', 'sel_upsert(text,jsonb)', 'sel_delete(text)',
    'sel_quiz_create(text,jsonb,text)', 'sel_quiz_join(text,text,text)', 'sel_quiz_host(text,text,text,text)',
    'sel_quiz_answer(text,text,int,int)', 'sel_quiz_poll(text,text,text)', 'sel_quiz_results(text,text)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

-- ---------- Kunci admin kader ----------
-- Setelah menjalankan skema ini, jalankan SATU baris di bawah (ganti dengan kata sandi panjang buatanmu,
-- minimal 8 karakter), lalu hapus baris itu dari riwayat query bila perlu:
--   insert into public.sel_settings (k, v) values ('admin_key', 'GANTI-DENGAN-KATA-SANDI-PANJANG')
--   on conflict (k) do update set v = excluded.v;
