import "server-only";
import type { Sql, TransactionSql } from "postgres";
import { createClaimToken, hashToken } from "./auth";
import { db, hasDatabase } from "./db";
import { HttpError } from "./http";
import { compareDistanceCards, haversineKm } from "./scoring";
import { openingRound, pair, rankingMatchCount, shuffled } from "./tournament";
import type {
  AppState,
  ChallengeState,
  Identity,
  MatchResult,
  MatchSummary,
  PlayState,
  PlayerSummary,
} from "./types";

type Queryable = Sql | TransactionSql;

type TournamentRow = {
  id: string;
  title: string;
  status: "lobby" | "tournament" | "draft_selection" | "complete";
  settings: { viewSeconds?: number; locationsPerMatch?: number };
  current_selector_rank: number | null;
};

type PlayerRow = {
  id: string;
  tournament_id: string;
  name: string;
  emoji: string | null;
  claim_token_hash: string | null;
  seed: number | null;
  tournament_rank: number | null;
};

type GroupRow = {
  id: string;
  tournament_id: string;
  rank_start: number;
  rank_end: number;
  phase: "play_in" | "knockout" | "complete";
  current_round: number;
  target_size: number;
  waiting_player_ids: string[];
};

const DEFAULT_VIEW_SECONDS = 60;
const DEFAULT_LOCATIONS_PER_MATCH = 3;

function playerSummary(player: PlayerRow): PlayerSummary {
  return {
    id: player.id,
    name: player.name,
    emoji: player.emoji,
    claimed: Boolean(player.claim_token_hash),
    seed: player.seed,
    tournamentRank: player.tournament_rank,
  };
}

async function latestTournament(sql: Queryable) {
  const [tournament] = await sql<TournamentRow[]>`
    select id, title, status, settings, current_selector_rank
    from tournaments
    order by created_at desc
    limit 1
  `;
  return tournament ?? null;
}

async function requireIdentity(sql: Queryable, identity: Identity | null) {
  if (!identity) throw new HttpError(401, "Claim your name first.");
  const [player] = await sql<PlayerRow[]>`
    select id, tournament_id, name, emoji, claim_token_hash, seed, tournament_rank
    from players
    where id = ${identity.playerId} and claim_token_hash = ${hashToken(identity.token)}
  `;
  if (!player) throw new HttpError(401, "That player claim is no longer valid.");
  return player;
}

async function activeLocationCount(sql: Queryable) {
  const [row] = await sql<{ count: number }[]>`
    select count(*)::integer as count from locations where active and pano_id is not null
  `;
  return row.count;
}

async function createMatch(
  sql: TransactionSql,
  tournament: TournamentRow,
  groupId: string,
  phase: "play_in" | "knockout",
  roundNumber: number,
  matchIndex: number,
  players: [string, string],
) {
  const challengeCount = tournament.settings.locationsPerMatch ?? DEFAULT_LOCATIONS_PER_MATCH;
  const locations = await sql<
    Array<{
      id: string;
      label: string;
      country: string;
      lat: number;
      lng: number;
      pano_id: string;
      heading: number;
      pitch: number;
    }>
  >`
    select l.id, l.label, l.country, l.lat, l.lng, l.pano_id, l.heading, l.pitch
    from locations l
    where l.active and l.pano_id is not null
      and not exists (
        select 1 from challenges c
        where c.tournament_id = ${tournament.id} and c.location_id = l.id
      )
    order by random()
    limit ${challengeCount}
    for update skip locked
  `;
  if (locations.length !== challengeCount) {
    throw new HttpError(409, "Not enough validated worldwide locations remain for this tournament.");
  }

  const tieBreakPlayerId = Math.random() < 0.5 ? players[0] : players[1];
  const [match] = await sql<{ id: string }[]>`
    insert into matches (
      tournament_id, group_id, phase, round_number, match_index,
      player_1_id, player_2_id, tie_break_player_id
    ) values (
      ${tournament.id}, ${groupId}, ${phase}, ${roundNumber}, ${matchIndex},
      ${players[0]}, ${players[1]}, ${tieBreakPlayerId}
    ) returning id
  `;

  for (let index = 0; index < locations.length; index += 1) {
    const location = locations[index];
    await sql`
      insert into challenges (
        tournament_id, match_id, location_id, sequence, pano_id,
        actual_lat, actual_lng, heading, pitch, label, country
      ) values (
        ${tournament.id}, ${match.id}, ${location.id}, ${index + 1}, ${location.pano_id},
        ${location.lat}, ${location.lng}, ${location.heading}, ${location.pitch},
        ${location.label}, ${location.country}
      )
    `;
  }
  return match.id;
}

async function createRankingGroup(
  sql: TransactionSql,
  tournament: TournamentRow,
  entrants: string[],
  rankStart: number,
  parentGroupId: string | null = null,
) {
  if (entrants.length === 1) {
    await sql`update players set tournament_rank = ${rankStart} where id = ${entrants[0]}`;
    return null;
  }

  const plan = openingRound(entrants);
  const [group] = await sql<{ id: string }[]>`
    insert into ranking_groups (
      tournament_id, parent_group_id, rank_start, rank_end, phase,
      current_round, target_size, waiting_player_ids
    ) values (
      ${tournament.id}, ${parentGroupId}, ${rankStart}, ${rankStart + entrants.length - 1},
      ${plan.phase}, 0, ${plan.targetSize}, ${sql.json(plan.byes)}
    ) returning id
  `;

  for (let index = 0; index < plan.pairings.length; index += 1) {
    await createMatch(sql, tournament, group.id, plan.phase, 0, index, plan.pairings[index]);
  }
  return group.id;
}

async function maybeStartDraftSelection(sql: TransactionSql, tournamentId: string) {
  const [remaining] = await sql<{ count: number }[]>`
    select count(*)::integer as count
    from players where tournament_id = ${tournamentId} and tournament_rank is null
  `;
  if (remaining.count > 0) return;

  const [tournament] = await sql<TournamentRow[]>`
    select id, title, status, settings, current_selector_rank
    from tournaments where id = ${tournamentId} for update
  `;
  if (!tournament || tournament.status !== "tournament") return;

  await sql`
    insert into draft_slot_selections (
      tournament_id, player_id, tournament_rank, status, unlocked_at
    )
    select tournament_id, id, tournament_rank,
      case when tournament_rank = 1 then 'active' else 'waiting' end,
      case when tournament_rank = 1 then now() else null end
    from players where tournament_id = ${tournamentId}
    order by tournament_rank
  `;
  await sql`
    update tournaments
    set status = 'draft_selection', current_selector_rank = 1
    where id = ${tournamentId}
  `;
}

async function advanceGroup(sql: TransactionSql, groupId: string) {
  const [group] = await sql<GroupRow[]>`
    select id, tournament_id, rank_start, rank_end, phase, current_round,
      target_size, waiting_player_ids
    from ranking_groups where id = ${groupId} for update
  `;
  if (!group || group.phase === "complete") return;

  const matches = await sql<Array<{ winner_id: string | null; loser_id: string | null; status: string }>>`
    select winner_id, loser_id, status from matches
    where group_id = ${group.id} and phase = ${group.phase}
      and round_number = ${group.current_round}
    order by match_index
  `;
  if (!matches.length || matches.some((match) => match.status !== "complete")) return;

  const tournament = await latestTournament(sql);
  if (!tournament || tournament.id !== group.tournament_id) throw new Error("Tournament disappeared.");
  const winners = matches.map((match) => match.winner_id).filter((id): id is string => Boolean(id));
  const losers = matches.map((match) => match.loser_id).filter((id): id is string => Boolean(id));

  if (group.phase === "play_in") {
    if (losers.length) {
      await createRankingGroup(sql, tournament, losers, group.rank_start + group.target_size, group.id);
    }
    const survivors = [...group.waiting_player_ids, ...winners];
    const pairings = pair(survivors);
    for (let index = 0; index < pairings.length; index += 1) {
      await createMatch(sql, tournament, group.id, "knockout", 0, index, pairings[index]);
    }
    await sql`
      update ranking_groups
      set phase = 'knockout', current_round = 0, waiting_player_ids = '[]'::jsonb
      where id = ${group.id}
    `;
    await maybeStartDraftSelection(sql, group.tournament_id);
    return;
  }

  if (winners.length === 1) {
    await sql`update players set tournament_rank = ${group.rank_start} where id = ${winners[0]}`;
    await sql`update players set tournament_rank = ${group.rank_start + 1} where id = ${losers[0]}`;
    await sql`
      update ranking_groups set phase = 'complete', completed_at = now() where id = ${group.id}
    `;
    await maybeStartDraftSelection(sql, group.tournament_id);
    return;
  }

  await createRankingGroup(sql, tournament, losers, group.rank_start + winners.length, group.id);
  const pairings = pair(winners);
  for (let index = 0; index < pairings.length; index += 1) {
    await createMatch(sql, tournament, group.id, "knockout", group.current_round + 1, index, pairings[index]);
  }
  await sql`
    update ranking_groups set current_round = ${group.current_round + 1} where id = ${group.id}
  `;
  await maybeStartDraftSelection(sql, group.tournament_id);
}

async function finalizeMatchIfReady(sql: TransactionSql, matchId: string) {
  const [match] = await sql<
    Array<{
      id: string;
      group_id: string;
      player_1_id: string;
      player_2_id: string;
      tie_break_player_id: string;
      status: string;
    }>
  >`
    select id, group_id, player_1_id, player_2_id, tie_break_player_id, status
    from matches where id = ${matchId} for update
  `;
  if (!match || match.status === "complete") return;

  const rows = await sql<Array<{ player_id: string; sequence: number; distance_km: number }>>`
    select a.player_id, c.sequence, a.distance_km
    from attempts a join challenges c on c.id = a.challenge_id
    where a.match_id = ${matchId} and a.submitted_at is not null
    order by a.player_id, c.sequence
  `;
  const [challengeCount] = await sql<{ count: number }[]>`
    select count(*)::integer as count from challenges where match_id = ${matchId}
  `;
  const player1 = rows.filter((row) => row.player_id === match.player_1_id);
  const player2 = rows.filter((row) => row.player_id === match.player_2_id);
  if (player1.length !== challengeCount.count || player2.length !== challengeCount.count) return;

  const comparison = compareDistanceCards(
    player1.map((row) => row.distance_km),
    player2.map((row) => row.distance_km),
  );
  const winnerId = comparison < 0
    ? match.player_1_id
    : comparison > 0
      ? match.player_2_id
      : match.tie_break_player_id;
  const loserId = winnerId === match.player_1_id ? match.player_2_id : match.player_1_id;

  await sql`
    update matches set status = 'complete', winner_id = ${winnerId}, loser_id = ${loserId}, completed_at = now()
    where id = ${match.id}
  `;
  await advanceGroup(sql, match.group_id);
}
