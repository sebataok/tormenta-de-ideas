-- Tormenta de Ideas — schema Postgres para Supabase.
-- Copiá TODO este archivo al SQL Editor de Supabase y ejecutá.

create extension if not exists "pgcrypto";

create table if not exists ideas (
  id            uuid primary key default gen_random_uuid(),
  title         text,
  text          text not null,
  priority      int not null default 0,
  status        text not null default 'pending_research',
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists ideas_priority_idx  on ideas (priority desc, updated_at desc);
create index if not exists ideas_status_idx    on ideas (status);

create table if not exists advances (
  id            uuid primary key default gen_random_uuid(),
  idea_id       uuid not null references ideas(id) on delete cascade,
  text          text not null,
  created_at    timestamptz not null default now()
);
create index if not exists advances_idea_idx on advances (idea_id, created_at);

create table if not exists episodes (
  id             uuid primary key default gen_random_uuid(),
  idea_id        uuid not null references ideas(id) on delete cascade,
  number         int  not null,
  title          text,
  summary        text,
  script         text,
  audio_url      text,
  delivery_error text,
  created_at     timestamptz not null default now(),
  unique (idea_id, number)
);
create index if not exists episodes_idea_idx on episodes (idea_id, number desc);

-- RLS (Row Level Security).
-- Al ser una app personal, dejamos la anon key con acceso completo.
-- Si un día se vuelve multi-usuario, agregar auth de Supabase y policies por auth.uid().
alter table ideas    enable row level security;
alter table advances enable row level security;
alter table episodes enable row level security;

drop policy if exists "anon rw ideas"    on ideas;
drop policy if exists "anon rw advances" on advances;
drop policy if exists "anon rw episodes" on episodes;

create policy "anon rw ideas"    on ideas    for all using (true) with check (true);
create policy "anon rw advances" on advances for all using (true) with check (true);
create policy "anon rw episodes" on episodes for all using (true) with check (true);

-- Storage bucket para los podcasts.
-- Crear manualmente en Storage → New bucket → Nombre 'podcasts' → Public bucket.
