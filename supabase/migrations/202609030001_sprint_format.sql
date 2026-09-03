-- A sprint league skips the bracket entirely: everybody plays the same handful of shared
-- locations whenever they show up, and the total distance is the final ranking. That is the
-- qualifier generalised from one round to N, so the qualifier tables grow a sequence instead
-- of gaining a parallel set of tables that would need every scoring path written twice.

alter table qualifiers add column sequence integer not null default 1 check (sequence > 0);
alter table qualifiers drop constraint qualifiers_tournament_id_key;
alter table qualifiers add constraint qualifiers_tournament_sequence unique (tournament_id, sequence);

-- Same guarantee the bracket gets from challenges: a location is drawn at most once per
-- tournament, so revealing a finished round can never leak a round somebody has left to play.
alter table qualifiers add constraint qualifiers_tournament_location unique (tournament_id, location_id);

create index qualifier_attempts_player on qualifier_attempts (player_id, submitted_at);

comment on table qualifiers is
  'The shared blind rounds every player faces. One round seeds a bracket; several of them are a sprint league whose total distance is the final ranking.';
