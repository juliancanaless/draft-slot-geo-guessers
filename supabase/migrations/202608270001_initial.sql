create extension if not exists pgcrypto;

create table tournaments (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'DA GEOGUESSERS: DRAFT SLOT THUNDERDOME',
  status text not null default 'lobby'
    check (status in ('lobby', 'tournament', 'draft_selection', 'complete')),
  settings jsonb not null default '{"viewSeconds":60,"locationsPerMatch":3}'::jsonb,
  current_selector_rank integer,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index one_unfinished_tournament
  on tournaments ((true)) where status <> 'complete';

create table players (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  name text not null,
  emoji text,
  claim_token_hash text,
  claimed_at timestamptz,
  seed integer,
  tournament_rank integer,
  created_at timestamptz not null default now(),
  unique (tournament_id, name),
  unique (tournament_id, seed),
  unique (tournament_id, tournament_rank)
);

create table locations (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  country text not null,
  region text,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  pano_id text,
  heading double precision not null default 0,
  pitch double precision not null default 0,
  active boolean not null default false,
  validation_error text,
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (lat, lng)
);

create table ranking_groups (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  parent_group_id uuid references ranking_groups(id) on delete cascade,
  rank_start integer not null check (rank_start > 0),
  rank_end integer not null check (rank_end >= rank_start),
  phase text not null check (phase in ('play_in', 'knockout', 'complete')),
  current_round integer not null default 0,
  target_size integer not null,
  waiting_player_ids jsonb not null default '[]'::jsonb,
  advance_key text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  group_id uuid not null references ranking_groups(id) on delete cascade,
  phase text not null check (phase in ('play_in', 'knockout')),
  round_number integer not null,
  match_index integer not null,
  player_1_id uuid not null references players(id),
  player_2_id uuid not null references players(id),
  tie_break_player_id uuid not null references players(id),
  winner_id uuid references players(id),
  loser_id uuid references players(id),
  status text not null default 'ready' check (status in ('ready', 'in_progress', 'complete')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (player_1_id <> player_2_id),
  check (tie_break_player_id in (player_1_id, player_2_id)),
  unique (group_id, phase, round_number, match_index)
);

create table challenges (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  match_id uuid not null references matches(id) on delete cascade,
  location_id uuid not null references locations(id),
  sequence integer not null check (sequence > 0),
  pano_id text not null,
  actual_lat double precision not null check (actual_lat between -90 and 90),
  actual_lng double precision not null check (actual_lng between -180 and 180),
  heading double precision not null,
  pitch double precision not null default 0,
  label text not null,
  country text not null,
  unique (match_id, sequence),
  unique (tournament_id, location_id)
);

create table attempts (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references challenges(id) on delete cascade,
  match_id uuid not null references matches(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  prepared_at timestamptz not null default now(),
  started_at timestamptz,
  expires_at timestamptz,
  guessed_lat double precision check (guessed_lat between -90 and 90),
  guessed_lng double precision check (guessed_lng between -180 and 180),
  distance_km double precision check (distance_km >= 0),
  submitted_at timestamptz,
  unique (challenge_id, player_id)
);

create table draft_slot_selections (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  tournament_rank integer not null,
  draft_slot integer,
  status text not null check (status in ('waiting', 'active', 'selected')),
  unlocked_at timestamptz,
  selected_at timestamptz,
  unique (tournament_id, player_id),
  unique (tournament_id, tournament_rank)
);

create unique index one_player_per_draft_slot
  on draft_slot_selections (tournament_id, draft_slot)
  where draft_slot is not null;

create unique index one_active_selector
  on draft_slot_selections (tournament_id)
  where status = 'active';

create or replace function select_draft_slot_atomic(
  p_tournament_id uuid,
  p_player_id uuid,
  p_draft_slot integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rank integer;
  v_roster_size integer;
begin
  perform 1 from tournaments
    where id = p_tournament_id and status = 'draft_selection'
    for update;
  if not found then raise exception 'Draft-slot selection is not active.'; end if;

  select count(*) into v_roster_size from players where tournament_id = p_tournament_id;
  if p_draft_slot < 1 or p_draft_slot > v_roster_size then
    raise exception 'That draft slot is not valid.';
  end if;

  select tournament_rank into v_rank
    from draft_slot_selections
    where tournament_id = p_tournament_id
      and player_id = p_player_id
      and status = 'active'
      and draft_slot is null
    for update;
  if v_rank is null then raise exception 'It is not your turn.'; end if;

  if exists (
    select 1 from draft_slot_selections
    where tournament_id = p_tournament_id and draft_slot = p_draft_slot
  ) then raise exception 'That slot was just taken. Pick another.'; end if;

  update draft_slot_selections
    set draft_slot = p_draft_slot, status = 'selected', selected_at = now()
    where tournament_id = p_tournament_id and player_id = p_player_id;

  if v_rank = v_roster_size then
    update tournaments
      set status = 'complete', current_selector_rank = null, completed_at = now()
      where id = p_tournament_id;
  else
    update draft_slot_selections
      set status = 'active', unlocked_at = now()
      where tournament_id = p_tournament_id and tournament_rank = v_rank + 1;
    update tournaments
      set current_selector_rank = v_rank + 1
      where id = p_tournament_id;
  end if;
end;
$$;

revoke all on function select_draft_slot_atomic(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function select_draft_slot_atomic(uuid, uuid, integer) to service_role;

create table admin_events (
  id bigint generated always as identity primary key,
  tournament_id uuid references tournaments(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index matches_players on matches (player_1_id, player_2_id);
create index matches_tournament_status on matches (tournament_id, status);
create index attempts_match_player on attempts (match_id, player_id);
create index ranking_groups_tournament on ranking_groups (tournament_id, rank_start);
create index locations_validation on locations (active, validated_at);

alter table tournaments enable row level security;
alter table players enable row level security;
alter table locations enable row level security;
alter table ranking_groups enable row level security;
alter table matches enable row level security;
alter table challenges enable row level security;
alter table attempts enable row level security;
alter table draft_slot_selections enable row level security;
alter table admin_events enable row level security;

comment on table ranking_groups is
  'Recursive ranking brackets. Each group ranks exactly rank_start through rank_end; loser cohorts become child groups.';
comment on column matches.tie_break_player_id is
  'Precommitted fallback used only if totals and every per-location distance tie exactly.';
comment on column ranking_groups.advance_key is
  'Idempotency claim for the phase and round most recently advanced.';
