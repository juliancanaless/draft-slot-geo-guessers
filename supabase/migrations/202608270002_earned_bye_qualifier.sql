alter table tournaments drop constraint tournaments_status_check;
alter table tournaments add constraint tournaments_status_check
  check (status in ('lobby', 'qualifier', 'tournament', 'draft_selection', 'complete'));

create table qualifiers (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null unique references tournaments(id) on delete cascade,
  location_id uuid not null references locations(id),
  pano_id text not null,
  actual_lat double precision not null check (actual_lat between -90 and 90),
  actual_lng double precision not null check (actual_lng between -180 and 180),
  heading double precision not null,
  pitch double precision not null default 0,
  label text not null,
  country text not null,
  status text not null default 'open' check (status in ('open', 'complete')),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table qualifier_attempts (
  id uuid primary key default gen_random_uuid(),
  qualifier_id uuid not null references qualifiers(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  prepared_at timestamptz not null default now(),
  started_at timestamptz,
  expires_at timestamptz,
  guessed_lat double precision check (guessed_lat between -90 and 90),
  guessed_lng double precision check (guessed_lng between -180 and 180),
  distance_km double precision check (distance_km >= 0),
  submitted_at timestamptz,
  unique (qualifier_id, player_id)
);

create index qualifier_attempts_qualifier on qualifier_attempts (qualifier_id, submitted_at);

alter table qualifiers enable row level security;
alter table qualifier_attempts enable row level security;

comment on table qualifiers is
  'One shared, blind geography challenge used to seed non-power-of-two brackets and award earned byes.';
