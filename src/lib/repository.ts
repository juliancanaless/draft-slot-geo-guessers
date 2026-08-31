import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WORLDWIDE_LOCATION_CANDIDATES } from "@/data/location-candidates";
import { createClaimToken, hashToken } from "./auth";
import { HttpError } from "./http";
import { compareDistanceCards, haversineKm } from "./scoring";
import { hasSupabase, supabaseAdmin } from "./supabase";
import { highestPowerOfTwoAtMost, locationsNeeded, openingRound, pairHighLow, rankingMatchCount, shuffled } from "./tournament";
import type {
  AdminState,
  AppState,
  ChallengeState,
  DraftSelectionSummary,
  Identity,
  LocationCandidate,
  MatchResult,
  MatchSummary,
  PlayState,
  PlayerSummary,
  QualifierPlayState,
  QualifierSummary,
  TournamentSummary,
} from "./types";

type TournamentRow = {
  id: string;
  title: string;
  status: "lobby" | "qualifier" | "tournament" | "draft_selection" | "complete";
  settings: { viewSeconds?: number; locationsPerMatch?: number };
  current_selector_rank: number | null;
  created_at: string;
};

type PlayerRow = {
  id: string;
  tournament_id: string;
  name: string;
  emoji: string | null;
  claim_token_hash: string | null;
  claimed_at: string | null;
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
  advance_key: string | null;
};

type MatchRow = {
  id: string;
  tournament_id: string;
  group_id: string;
  phase: "play_in" | "knockout";
  round_number: number;
  match_index: number;
  player_1_id: string;
  player_2_id: string;
  tie_break_player_id: string;
  winner_id: string | null;
  loser_id: string | null;
  status: "ready" | "in_progress" | "complete";
};

type ChallengeRow = {
  id: string;
  tournament_id: string;
  match_id: string;
  location_id: string;
  sequence: number;
  pano_id: string;
  actual_lat: number;
  actual_lng: number;
  heading: number;
  pitch: number;
  label: string;
  country: string;
};

type AttemptRow = {
  id: string;
  challenge_id: string;
  match_id: string;
  player_id: string;
  prepared_at: string;
  started_at: string | null;
  expires_at: string | null;
  guessed_lat: number | null;
  guessed_lng: number | null;
  distance_km: number | null;
  submitted_at: string | null;
};

type LocationRow = {
  id: string;
  label: string;
  country: string;
  region: string | null;
  lat: number;
  lng: number;
  pano_id: string | null;
  heading: number;
  pitch: number;
  active: boolean;
  validation_error: string | null;
  validated_at: string | null;
};

type DraftRow = {
  player_id: string;
  tournament_rank: number;
  draft_slot: number | null;
  status: "waiting" | "active" | "selected";
  unlocked_at: string | null;
  selected_at: string | null;
};

type QualifierRow = {
  id: string;
  tournament_id: string;
  location_id: string;
  pano_id: string;
  actual_lat: number;
  actual_lng: number;
  heading: number;
  pitch: number;
  label: string;
  country: string;
  status: "open" | "complete";
};

type QualifierAttemptRow = {
  id: string;
  qualifier_id: string;
  player_id: string;
  prepared_at: string;
  started_at: string | null;
  expires_at: string | null;
  guessed_lat: number | null;
  guessed_lng: number | null;
  distance_km: number | null;
  submitted_at: string | null;
};

type ResultLike<T> = { data: T | null; error: { message: string; code?: string } | null };

const DEFAULT_VIEW_SECONDS = 60;
const DEFAULT_LOCATIONS_PER_MATCH = 3;

function take<T>(result: ResultLike<T>, fallbackMessage = "Database request failed."): T {
  if (result.error) {
    console.error(result.error);
    throw new HttpError(500, result.error.message || fallbackMessage);
  }
  // Supabase mutations intentionally return null unless `.select()` is added.
  // A null payload is therefore successful whenever `error` is null.
  return result.data as T;
}

function one<T>(result: ResultLike<T>, message = "That thing no longer exists."): T {
  if (result.error) {
    console.error(result.error);
    throw new HttpError(result.error.code === "PGRST116" ? 404 : 500, result.error.message);
  }
  if (result.data === null) throw new HttpError(404, message);
  return result.data;
}

function asPlayerSummary(player: PlayerRow): PlayerSummary {
  return {
    id: player.id,
    name: player.name,
    emoji: player.emoji,
    claimed: Boolean(player.claim_token_hash),
    seed: player.seed,
    tournamentRank: player.tournament_rank,
  };
}

function asTournamentSummary(tournament: TournamentRow, rosterSize: number): TournamentSummary {
  return {
    id: tournament.id,
    title: tournament.title,
    status: tournament.status,
    viewSeconds: tournament.settings.viewSeconds ?? DEFAULT_VIEW_SECONDS,
    locationsPerMatch: tournament.settings.locationsPerMatch ?? DEFAULT_LOCATIONS_PER_MATCH,
    rosterSize,
    currentSelectorRank: tournament.current_selector_rank,
  };
}

function asLocationCandidate(location: LocationRow): LocationCandidate {
  return {
    id: location.id,
    label: location.label,
    country: location.country,
    region: location.region,
    lat: location.lat,
    lng: location.lng,
    panoId: location.pano_id,
    active: location.active,
    validationError: location.validation_error,
    validatedAt: location.validated_at,
  };
}

async function latestTournament(client: SupabaseClient) {
  const result = await client
    .from("tournaments")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) {
    if (result.error.code === "42P01") return null;
    take(result);
  }
  return (result.data as TournamentRow | null) ?? null;
}

async function verifiedPlayer(client: SupabaseClient, identity: Identity | null) {
  if (!identity) return null;
  const result = await client
    .from("players")
    .select("*")
    .eq("id", identity.playerId)
    .eq("claim_token_hash", hashToken(identity.token))
    .maybeSingle();
  if (result.error) take(result);
  return (result.data as PlayerRow | null) ?? null;
}

async function requirePlayer(client: SupabaseClient, identity: Identity | null) {
  const player = await verifiedPlayer(client, identity);
  if (!player) throw new HttpError(401, "Claim your name first.");
  return player;
}

async function audit(client: SupabaseClient, tournamentId: string | null, action: string, details = {}) {
  const result = await client.from("admin_events").insert({
    tournament_id: tournamentId,
    action,
    details,
  });
  if (result.error) console.error("Could not write admin audit event", result.error);
}

async function queryCoreState(client: SupabaseClient, tournament: TournamentRow, identity: Identity | null) {
  const players = take(
    await client.from("players").select("*").eq("tournament_id", tournament.id).order("created_at"),
  ) as PlayerRow[];
  const meRow = await verifiedPlayer(client, identity);
  const me = meRow?.tournament_id === tournament.id ? meRow : null;

  const [groupResult, matchResult, draftResult] = await Promise.all([
    client.from("ranking_groups").select("*").eq("tournament_id", tournament.id).order("rank_start"),
    client
      .from("matches")
      .select("*")
      .eq("tournament_id", tournament.id)
      .order("created_at"),
    client
      .from("draft_slot_selections")
      .select("*")
      .eq("tournament_id", tournament.id)
      .order("tournament_rank"),
  ]);
  const groups = take(groupResult) as GroupRow[];
  const matches = take(matchResult) as MatchRow[];
  const drafts = take(draftResult) as DraftRow[];

  const matchIds = matches.map((match) => match.id);
  let attempts: AttemptRow[] = [];
  let challenges: ChallengeRow[] = [];
  if (matchIds.length) {
    const [attemptResult, challengeResult] = await Promise.all([
      client.from("attempts").select("*").in("match_id", matchIds),
      client.from("challenges").select("*").in("match_id", matchIds).order("sequence"),
    ]);
    attempts = take(attemptResult) as AttemptRow[];
    challenges = take(challengeResult) as ChallengeRow[];
  }

  return { players, me, groups, matches, drafts, attempts, challenges };
}

function buildMatchSummaries(input: {
  players: PlayerRow[];
  me: PlayerRow | null;
  groups: GroupRow[];
  matches: MatchRow[];
  attempts: AttemptRow[];
  challenges: ChallengeRow[];
}) {
  const playerMap = new Map(input.players.map((player) => [player.id, player]));
  const groupMap = new Map(input.groups.map((group) => [group.id, group]));

  return input.matches.map((match): MatchSummary => {
    const player1 = playerMap.get(match.player_1_id);
    const player2 = playerMap.get(match.player_2_id);
    const group = groupMap.get(match.group_id);
    if (!player1 || !player2 || !group) throw new Error("A bracket row has missing players or group.");
    const matchAttempts = input.attempts.filter((attempt) => attempt.match_id === match.id);
    const mySubmittedCount = input.me
      ? matchAttempts.filter((attempt) => attempt.player_id === input.me?.id && attempt.submitted_at).length
      : 0;
    const opponentSubmittedCount = match.status === "complete" && input.me
      ? matchAttempts.filter((attempt) => attempt.player_id !== input.me?.id && attempt.submitted_at).length
      : null;

    let results: MatchResult[] | null = null;
    if (match.status === "complete") {
      results = input.challenges
        .filter((challenge) => challenge.match_id === match.id)
        .sort((left, right) => left.sequence - right.sequence)
        .map((challenge) => ({
          sequence: challenge.sequence,
          actual: {
            lat: challenge.actual_lat,
            lng: challenge.actual_lng,
            label: challenge.label,
            country: challenge.country,
          },
          guesses: matchAttempts
            .filter((attempt) => attempt.challenge_id === challenge.id && attempt.submitted_at)
            .map((attempt) => ({
              playerId: attempt.player_id,
              playerName: playerMap.get(attempt.player_id)?.name ?? "Unknown Bozo",
              lat: attempt.guessed_lat as number,
              lng: attempt.guessed_lng as number,
              distanceKm: attempt.distance_km as number,
            })),
        }));
    }

    return {
      id: match.id,
      groupId: match.group_id,
      groupRankStart: group.rank_start,
      groupRankEnd: group.rank_end,
      phase: match.phase,
      roundNumber: match.round_number,
      matchIndex: match.match_index,
      player1: asPlayerSummary(player1),
      player2: asPlayerSummary(player2),
      status: match.status,
      winnerId: match.winner_id,
      mySubmittedCount,
      opponentSubmittedCount,
      results,
    };
  });
}

async function qualifierSummary(
  client: SupabaseClient,
  tournamentId: string,
  players: PlayerRow[],
  me: PlayerRow | null,
): Promise<QualifierSummary | null> {
  const qualifierResult = await client
    .from("qualifiers")
    .select("*")
    .eq("tournament_id", tournamentId)
    .maybeSingle();
  if (qualifierResult.error) take(qualifierResult);
  const qualifier = qualifierResult.data as QualifierRow | null;
  if (!qualifier) return null;
  const attempts = take(
    await client.from("qualifier_attempts").select("*").eq("qualifier_id", qualifier.id),
  ) as QualifierAttemptRow[];
  const submitted = attempts.filter((attempt) => attempt.submitted_at);
  const playerMap = new Map(players.map((player) => [player.id, player]));
  const rankings = qualifier.status === "complete"
    ? submitted
      .sort((left, right) => (left.distance_km ?? Infinity) - (right.distance_km ?? Infinity))
      .map((attempt) => ({
        playerId: attempt.player_id,
        playerName: playerMap.get(attempt.player_id)?.name ?? "Unknown Bozo",
        seed: playerMap.get(attempt.player_id)?.seed ?? 0,
        distanceKm: attempt.distance_km as number,
      }))
      .sort((left, right) => left.seed - right.seed)
    : null;
  return {
    status: qualifier.status,
    submittedCount: submitted.length,
    totalPlayers: players.length,
    meSubmitted: Boolean(me && submitted.some((attempt) => attempt.player_id === me.id)),
    rankings,
  };
}

export async function getAppState(identity: Identity | null): Promise<AppState> {
  const serverNow = new Date().toISOString();
  if (!hasSupabase()) {
    return {
      configured: false,
      tournament: null,
      players: [],
      matches: [],
      draftSelections: [],
      qualifier: null,
      me: null,
      serverNow,
      message: "Server environment variables are not configured yet.",
    };
  }

  const client = supabaseAdmin();
  const tournament = await latestTournament(client);
  if (!tournament) {
    return {
      configured: false,
      tournament: null,
      players: [],
      matches: [],
      draftSelections: [],
      qualifier: null,
      me: null,
      serverNow,
      message: "The commissioner still needs to configure the roster.",
    };
  }

  const core = await queryCoreState(client, tournament, identity);
  const playerMap = new Map(core.players.map((player) => [player.id, player]));
  const draftSelections: DraftSelectionSummary[] = core.drafts.map((draft) => ({
    playerId: draft.player_id,
    playerName: playerMap.get(draft.player_id)?.name ?? "Unknown Bozo",
    tournamentRank: draft.tournament_rank,
    draftSlot: draft.draft_slot,
    status: draft.status,
    unlockedAt: draft.unlocked_at,
    selectedAt: draft.selected_at,
  }));
  const qualifier = await qualifierSummary(client, tournament.id, core.players, core.me);

  return {
    configured: true,
    tournament: asTournamentSummary(tournament, core.players.length),
    players: core.players.map(asPlayerSummary),
    matches: buildMatchSummaries(core),
    draftSelections,
    qualifier,
    me: core.me ? asPlayerSummary(core.me) : null,
    serverNow,
  };
}

export async function claimPlayer(playerId: string) {
  const client = supabaseAdmin();
  const token = createClaimToken();
  const result = await client
    .from("players")
    .update({ claim_token_hash: hashToken(token), claimed_at: new Date().toISOString() })
    .eq("id", playerId)
    .is("claim_token_hash", null)
    .select("id, tournament_id")
    .maybeSingle();
  if (result.error) take(result);
  if (!result.data) throw new HttpError(409, "Somebody already claimed that name.");
  return { playerId, token } satisfies Identity;
}

export async function configureTournament(input: {
  title: string;
  players: Array<{ name: string; emoji?: string | null }>;
  viewSeconds: number;
  locationsPerMatch: number;
}) {
  const client = supabaseAdmin();
  const names = input.players.map((player) => player.name.trim()).filter(Boolean);
  if (names.length < 4 || names.length > 32) {
    throw new HttpError(400, "Configure between 4 and 32 players.");
  }
  if (new Set(names.map((name) => name.toLocaleLowerCase())).size !== names.length) {
    throw new HttpError(400, "Player names must be unique.");
  }
  if (!Number.isInteger(input.viewSeconds) || input.viewSeconds < 15 || input.viewSeconds > 300) {
    throw new HttpError(400, "Viewing time must be between 15 and 300 seconds.");
  }
  if (!Number.isInteger(input.locationsPerMatch) || input.locationsPerMatch < 1 || input.locationsPerMatch > 5) {
    throw new HttpError(400, "Use between 1 and 5 locations per match.");
  }

  const existing = await latestTournament(client);
  if (existing && existing.status !== "lobby") {
    throw new HttpError(409, "A tournament is already underway. Finish or reset it first.");
  }
  if (existing) {
    take(await client.from("tournaments").delete().eq("id", existing.id));
  }

  const tournament = one(
    await client
      .from("tournaments")
      .insert({
        title: input.title.trim() || "DA GEOGUESSERS: DRAFT SLOT THUNDERDOME",
        status: "lobby",
        settings: { viewSeconds: input.viewSeconds, locationsPerMatch: input.locationsPerMatch },
      })
      .select("*")
      .single(),
  ) as TournamentRow;

  take(
    await client.from("players").insert(
      input.players.map((player) => ({
        tournament_id: tournament.id,
        name: player.name.trim(),
        emoji: player.emoji?.trim() || null,
      })),
    ),
  );

  const locationCountResult = await client.from("locations").select("id", { count: "exact", head: true });
  if (locationCountResult.error) take(locationCountResult);
  if (!locationCountResult.count) {
    take(
      await client.from("locations").insert(
        WORLDWIDE_LOCATION_CANDIDATES.map((location) => ({
          ...location,
          active: false,
        })),
      ),
    );
  }

  await audit(client, tournament.id, "configure_tournament", {
    rosterSize: names.length,
    viewSeconds: input.viewSeconds,
    locationsPerMatch: input.locationsPerMatch,
  });
  return { tournamentId: tournament.id };
}

async function activeLocations(client: SupabaseClient) {
  return take(
    await client
      .from("locations")
      .select("*")
      .eq("active", true)
      .not("pano_id", "is", null),
  ) as LocationRow[];
}

async function createMatch(
  client: SupabaseClient,
  tournament: TournamentRow,
  groupId: string,
  phase: "play_in" | "knockout",
  roundNumber: number,
  matchIndex: number,
  entrantIds: [string, string],
) {
  const playerResult = await client
    .from("players")
    .select("id, seed")
    .in("id", entrantIds);
  const entrants = take(playerResult) as Array<{ id: string; seed: number }>;
  const first = entrants.find((player) => player.id === entrantIds[0]);
  const second = entrants.find((player) => player.id === entrantIds[1]);
  if (!first || !second) throw new HttpError(500, "A bracket entrant disappeared.");
  const tieBreakPlayerId = first.seed < second.seed ? first.id : second.id;

  const match = one(
    await client
      .from("matches")
      .insert({
        tournament_id: tournament.id,
        group_id: groupId,
        phase,
        round_number: roundNumber,
        match_index: matchIndex,
        player_1_id: entrantIds[0],
        player_2_id: entrantIds[1],
        tie_break_player_id: tieBreakPlayerId,
      })
      .select("id")
      .single(),
  ) as { id: string };

  const usedResult = await client
    .from("challenges")
    .select("location_id")
    .eq("tournament_id", tournament.id);
  const used = new Set((take(usedResult) as Array<{ location_id: string }>).map((row) => row.location_id));
  const qualifierResult = await client
    .from("qualifiers")
    .select("location_id")
    .eq("tournament_id", tournament.id)
    .maybeSingle();
  if (qualifierResult.error) take(qualifierResult);
  if (qualifierResult.data) used.add((qualifierResult.data as { location_id: string }).location_id);
  const challengeCount = tournament.settings.locationsPerMatch ?? DEFAULT_LOCATIONS_PER_MATCH;
  const available = shuffled((await activeLocations(client)).filter((location) => !used.has(location.id)));
  if (available.length < challengeCount) {
    await client.from("matches").delete().eq("id", match.id);
    throw new HttpError(409, "Not enough validated worldwide locations remain.");
  }

  const challengeRows = available.slice(0, challengeCount).map((location, index) => ({
    tournament_id: tournament.id,
    match_id: match.id,
    location_id: location.id,
    sequence: index + 1,
    pano_id: location.pano_id,
    actual_lat: location.lat,
    actual_lng: location.lng,
    heading: location.heading,
    pitch: location.pitch,
    label: location.label,
    country: location.country,
  }));
  const challengeResult = await client.from("challenges").insert(challengeRows);
  if (challengeResult.error) {
    await client.from("matches").delete().eq("id", match.id);
    take(challengeResult);
  }
  return match.id;
}

async function sortedEntrantsBySeed(client: SupabaseClient, entrantIds: string[]) {
  const rows = take(
    await client.from("players").select("id, seed").in("id", entrantIds),
  ) as Array<{ id: string; seed: number }>;
  return rows.sort((left, right) => left.seed - right.seed).map((player) => player.id);
}

async function createRankingGroup(
  client: SupabaseClient,
  tournament: TournamentRow,
  entrants: string[],
  rankStart: number,
  parentGroupId: string | null = null,
) {
  if (entrants.length === 1) {
    take(await client.from("players").update({ tournament_rank: rankStart }).eq("id", entrants[0]));
    return null;
  }

  const seededEntrants = await sortedEntrantsBySeed(client, entrants);
  const plan = openingRound(seededEntrants);
  const group = one(
    await client
      .from("ranking_groups")
      .insert({
        tournament_id: tournament.id,
        parent_group_id: parentGroupId,
        rank_start: rankStart,
        rank_end: rankStart + entrants.length - 1,
        phase: plan.phase,
        current_round: 0,
        target_size: plan.targetSize,
        waiting_player_ids: plan.byes,
      })
      .select("id")
      .single(),
  ) as { id: string };

  for (let index = 0; index < plan.pairings.length; index += 1) {
    await createMatch(client, tournament, group.id, plan.phase, 0, index, plan.pairings[index]);
  }
  if (plan.phase === "play_in") {
    await createKnockoutRound(client, tournament, group.id, [
      ...plan.byes,
      ...Array<null>(plan.pairings.length).fill(null),
    ]);
  }
  return group.id;
}

/**
 * Byes outrank every play-in entrant, so they always take the top knockout slots and the
 * winners land in the holes below them. A pairing of two byes is therefore already decided
 * before the play-in resolves, and holding it back buys nothing. Pass a null for a slot whose
 * occupant is still unknown; the pairings it touches are created on the later call instead.
 */
async function createKnockoutRound(
  client: SupabaseClient,
  tournament: TournamentRow,
  groupId: string,
  slots: Array<string | null>,
) {
  const existing = new Set(
    (take(
      await client
        .from("matches")
        .select("match_index")
        .eq("group_id", groupId)
        .eq("phase", "knockout")
        .eq("round_number", 0),
    ) as Array<{ match_index: number }>).map((match) => match.match_index),
  );
  const pairings = pairHighLow(slots);
  for (let index = 0; index < pairings.length; index += 1) {
    const [first, second] = pairings[index];
    if (first && second && !existing.has(index)) {
      await createMatch(client, tournament, groupId, "knockout", 0, index, [first, second]);
    }
  }
}

export async function startTournament() {
  const client = supabaseAdmin();
  const tournament = await latestTournament(client);
  if (!tournament || tournament.status !== "lobby") {
    throw new HttpError(409, "There is no lobby ready to start.");
  }

  const players = take(
    await client.from("players").select("*").eq("tournament_id", tournament.id).order("created_at"),
  ) as PlayerRow[];
  if (players.length < 4) throw new HttpError(409, "The roster is too small.");
  if (players.some((player) => !player.claim_token_hash)) {
    throw new HttpError(409, "Every player must claim their name before the tournament starts.");
  }

  const expectedMatches = rankingMatchCount(players.length);
  const needsQualifier = highestPowerOfTwoAtMost(players.length) !== players.length;
  const requiredLocations = locationsNeeded(
    players.length,
    tournament.settings.locationsPerMatch ?? DEFAULT_LOCATIONS_PER_MATCH,
  );
  const validatedLocations = await activeLocations(client);
  if (validatedLocations.length < requiredLocations) {
    throw new HttpError(
      409,
      `Validate ${requiredLocations} locations first. Only ${validatedLocations.length} are ready.`,
    );
  }

  take(await client.from("ranking_groups").delete().eq("tournament_id", tournament.id));
  take(
    await client
      .from("players")
      .update({ seed: null, tournament_rank: null })
      .eq("tournament_id", tournament.id),
  );

  const seededPlayers = shuffled(players);
  for (let index = 0; index < seededPlayers.length; index += 1) {
    take(await client.from("players").update({ seed: index + 1 }).eq("id", seededPlayers[index].id));
  }

  if (needsQualifier) {
    const location = shuffled(validatedLocations)[0];
    take(
      await client.from("qualifiers").insert({
        tournament_id: tournament.id,
        location_id: location.id,
        pano_id: location.pano_id,
        actual_lat: location.lat,
        actual_lng: location.lng,
        heading: location.heading,
        pitch: location.pitch,
        label: location.label,
        country: location.country,
      }),
    );
    take(
      await client
        .from("tournaments")
        .update({ status: "qualifier", started_at: new Date().toISOString() })
        .eq("id", tournament.id)
        .eq("status", "lobby"),
    );
    await audit(client, tournament.id, "start_qualifier", { expectedMatches, requiredLocations });
    return { expectedMatches, qualifier: true };
  }

  await createRankingGroup(client, tournament, seededPlayers.map((player) => player.id), 1);
  take(await client.from("tournaments").update({ status: "tournament", started_at: new Date().toISOString() }).eq("id", tournament.id).eq("status", "lobby"));
  await audit(client, tournament.id, "start_tournament", { expectedMatches, requiredLocations });
  return { expectedMatches, qualifier: false };
}

async function maybeStartDraftSelection(client: SupabaseClient, tournamentId: string) {
  const playerResult = await client
    .from("players")
    .select("id, tournament_id, tournament_rank")
    .eq("tournament_id", tournamentId)
    .order("tournament_rank");
  const players = take(playerResult) as Array<{
    id: string;
    tournament_id: string;
    tournament_rank: number | null;
  }>;
  if (!players.length || players.some((player) => player.tournament_rank === null)) return;

  const tournamentResult = await client
    .from("tournaments")
    .select("status")
    .eq("id", tournamentId)
    .single();
  const tournament = one(tournamentResult) as { status: string };
  if (tournament.status !== "tournament") return;

  const draftRows = players.map((player) => ({
    tournament_id: tournamentId,
    player_id: player.id,
    tournament_rank: player.tournament_rank as number,
    status: player.tournament_rank === 1 ? "active" : "waiting",
    unlocked_at: player.tournament_rank === 1 ? new Date().toISOString() : null,
  }));
  const insertResult = await client.from("draft_slot_selections").insert(draftRows);
  if (insertResult.error && insertResult.error.code !== "23505") take(insertResult);
  take(
    await client
      .from("tournaments")
      .update({ status: "draft_selection", current_selector_rank: 1 })
      .eq("id", tournamentId)
      .eq("status", "tournament"),
  );
}

async function advanceGroup(client: SupabaseClient, groupId: string) {
  const group = one(
    await client.from("ranking_groups").select("*").eq("id", groupId).single(),
  ) as GroupRow;
  if (group.phase === "complete") return;

  const matches = take(
    await client
      .from("matches")
      .select("*")
      .eq("group_id", group.id)
      .eq("phase", group.phase)
      .eq("round_number", group.current_round)
      .order("match_index"),
  ) as MatchRow[];
  if (!matches.length || matches.some((match) => match.status !== "complete")) return;

  const advanceKey = `${group.phase}-${group.current_round}`;
  let claimQuery = client
    .from("ranking_groups")
    .update({ advance_key: advanceKey })
    .eq("id", group.id);
  claimQuery = group.advance_key === null
    ? claimQuery.is("advance_key", null)
    : claimQuery.eq("advance_key", group.advance_key);
  const claim = await claimQuery.select("id").maybeSingle();
  if (claim.error) take(claim);
  if (!claim.data || group.advance_key === advanceKey) return;

  const tournament = one(
    await client.from("tournaments").select("*").eq("id", group.tournament_id).single(),
  ) as TournamentRow;
  const winners = matches.map((match) => match.winner_id).filter((id): id is string => Boolean(id));
  const losers = matches.map((match) => match.loser_id).filter((id): id is string => Boolean(id));

  if (group.phase === "play_in") {
    if (losers.length) {
      await createRankingGroup(
        client,
        tournament,
        losers,
        group.rank_start + group.target_size,
        group.id,
      );
    }
    const survivors = await sortedEntrantsBySeed(client, [...group.waiting_player_ids, ...winners]);
    await createKnockoutRound(client, tournament, group.id, survivors);
    take(
      await client
        .from("ranking_groups")
        .update({ phase: "knockout", current_round: 0, waiting_player_ids: [] })
        .eq("id", group.id),
    );
    await maybeStartDraftSelection(client, group.tournament_id);
    return;
  }

  if (winners.length === 1) {
    take(
      await client
        .from("players")
        .update({ tournament_rank: group.rank_start })
        .eq("id", winners[0]),
    );
    take(
      await client
        .from("players")
        .update({ tournament_rank: group.rank_start + 1 })
        .eq("id", losers[0]),
    );
    take(
      await client
        .from("ranking_groups")
        .update({ phase: "complete", completed_at: new Date().toISOString() })
        .eq("id", group.id),
    );
    await maybeStartDraftSelection(client, group.tournament_id);
    return;
  }

  await createRankingGroup(
    client,
    tournament,
    losers,
    group.rank_start + winners.length,
    group.id,
  );
  const pairings = pairHighLow(await sortedEntrantsBySeed(client, winners));
  for (let index = 0; index < pairings.length; index += 1) {
    await createMatch(
      client,
      tournament,
      group.id,
      "knockout",
      group.current_round + 1,
      index,
      pairings[index],
    );
  }
  take(
    await client
      .from("ranking_groups")
      .update({ current_round: group.current_round + 1 })
      .eq("id", group.id),
  );
  await maybeStartDraftSelection(client, group.tournament_id);
}

async function finalizeMatchIfReady(client: SupabaseClient, matchId: string) {
  const match = one(
    await client.from("matches").select("*").eq("id", matchId).single(),
  ) as MatchRow;
  if (match.status === "complete") return;

  const [challengeResult, attemptResult] = await Promise.all([
    client.from("challenges").select("id, sequence").eq("match_id", matchId).order("sequence"),
    client
      .from("attempts")
      .select("player_id, challenge_id, distance_km, submitted_at")
      .eq("match_id", matchId)
      .not("submitted_at", "is", null),
  ]);
  const challenges = take(challengeResult) as Array<{ id: string; sequence: number }>;
  const attempts = take(attemptResult) as Array<{
    player_id: string;
    challenge_id: string;
    distance_km: number;
    submitted_at: string;
  }>;
  const order = new Map(challenges.map((challenge) => [challenge.id, challenge.sequence]));
  const player1 = attempts
    .filter((attempt) => attempt.player_id === match.player_1_id)
    .sort((left, right) => (order.get(left.challenge_id) ?? 0) - (order.get(right.challenge_id) ?? 0));
  const player2 = attempts
    .filter((attempt) => attempt.player_id === match.player_2_id)
    .sort((left, right) => (order.get(left.challenge_id) ?? 0) - (order.get(right.challenge_id) ?? 0));
  if (player1.length !== challenges.length || player2.length !== challenges.length) return;

  const comparison = compareDistanceCards(
    player1.map((attempt) => attempt.distance_km),
    player2.map((attempt) => attempt.distance_km),
  );
  const winnerId = comparison < 0
    ? match.player_1_id
    : comparison > 0
      ? match.player_2_id
      : match.tie_break_player_id;
  const loserId = winnerId === match.player_1_id ? match.player_2_id : match.player_1_id;
  const completion = await client
    .from("matches")
    .update({
      status: "complete",
      winner_id: winnerId,
      loser_id: loserId,
      completed_at: new Date().toISOString(),
    })
    .eq("id", match.id)
    .neq("status", "complete")
    .select("id")
    .maybeSingle();
  if (completion.error) take(completion);
  if (completion.data) await advanceGroup(client, match.group_id);
}

async function qualifierRows(client: SupabaseClient, player: PlayerRow) {
  const qualifier = one(
    await client.from("qualifiers").select("*").eq("tournament_id", player.tournament_id).single(),
    "The bye-week qualifier does not exist.",
  ) as QualifierRow;
  const attemptResult = await client
    .from("qualifier_attempts")
    .select("*")
    .eq("qualifier_id", qualifier.id)
    .eq("player_id", player.id)
    .maybeSingle();
  if (attemptResult.error) take(attemptResult);
  return { qualifier, attempt: attemptResult.data as QualifierAttemptRow | null };
}

export async function getQualifierPlayState(identity: Identity | null): Promise<QualifierPlayState> {
  const client = supabaseAdmin();
  const player = await requirePlayer(client, identity);
  const { qualifier, attempt } = await qualifierRows(client, player);
  const tournament = one(
    await client.from("tournaments").select("settings").eq("id", player.tournament_id).single(),
  ) as { settings: { viewSeconds?: number } };
  const submittedResult = await client
    .from("qualifier_attempts")
    .select("id", { count: "exact", head: true })
    .eq("qualifier_id", qualifier.id)
    .not("submitted_at", "is", null);
  if (submittedResult.error) take(submittedResult);
  const playerCountResult = await client
    .from("players")
    .select("id", { count: "exact", head: true })
    .eq("tournament_id", player.tournament_id);
  if (playerCountResult.error) take(playerCountResult);

  let status: ChallengeState["status"] = "ready";
  if (attempt?.submitted_at) status = "submitted";
  else if (attempt && !attempt.started_at) status = "prepared";
  else if (attempt?.expires_at && new Date(attempt.expires_at).getTime() > Date.now()) status = "viewing";
  else if (attempt?.started_at) status = "guessing";
  const canSeePano = status === "prepared" || status === "viewing";

  let results: QualifierPlayState["results"] = null;
  if (qualifier.status === "complete") {
    const [attemptsResult, playersResult] = await Promise.all([
      client.from("qualifier_attempts").select("*").eq("qualifier_id", qualifier.id),
      client.from("players").select("*").eq("tournament_id", player.tournament_id),
    ]);
    const attempts = take(attemptsResult) as QualifierAttemptRow[];
    const players = take(playersResult) as PlayerRow[];
    const playerMap = new Map(players.map((item) => [item.id, item]));
    results = {
      actual: { lat: qualifier.actual_lat, lng: qualifier.actual_lng, label: qualifier.label, country: qualifier.country },
      rankings: attempts
        .filter((item) => item.submitted_at)
        .map((item) => ({ playerId: item.player_id, playerName: playerMap.get(item.player_id)?.name ?? "Unknown Bozo", seed: playerMap.get(item.player_id)?.seed ?? 0, distanceKm: item.distance_km as number }))
        .sort((left, right) => left.seed - right.seed),
    };
  }

  return {
    challenge: {
      id: qualifier.id,
      sequence: 1,
      status,
      ...(canSeePano ? { panoId: qualifier.pano_id, heading: qualifier.heading, pitch: qualifier.pitch } : {}),
      ...(attempt?.expires_at ? { expiresAt: attempt.expires_at } : {}),
    },
    serverNow: new Date().toISOString(),
    viewSeconds: tournament.settings.viewSeconds ?? DEFAULT_VIEW_SECONDS,
    submittedCount: submittedResult.count ?? 0,
    totalPlayers: playerCountResult.count ?? 0,
    results,
  };
}

export async function prepareQualifier(identity: Identity | null) {
  const client = supabaseAdmin();
  const player = await requirePlayer(client, identity);
  const tournament = await latestTournament(client);
  if (!tournament || tournament.id !== player.tournament_id || tournament.status !== "qualifier") throw new HttpError(409, "The qualifier is not open.");
  const { qualifier, attempt } = await qualifierRows(client, player);
  if (!attempt) {
    const result = await client.from("qualifier_attempts").insert({ qualifier_id: qualifier.id, player_id: player.id });
    if (result.error && result.error.code !== "23505") take(result);
  }
  return getQualifierPlayState(identity);
}

export async function startQualifier(identity: Identity | null) {
  const client = supabaseAdmin();
  const player = await requirePlayer(client, identity);
  const { attempt } = await qualifierRows(client, player);
  if (!attempt) throw new HttpError(409, "Load Street View before starting.");
  if (!attempt.started_at) {
    const tournament = one(await client.from("tournaments").select("settings, status").eq("id", player.tournament_id).single()) as { settings: { viewSeconds?: number }; status: string };
    if (tournament.status !== "qualifier") throw new HttpError(409, "The qualifier is not open.");
    const started = new Date();
    take(await client.from("qualifier_attempts").update({ started_at: started.toISOString(), expires_at: new Date(started.getTime() + (tournament.settings.viewSeconds ?? DEFAULT_VIEW_SECONDS) * 1000).toISOString() }).eq("id", attempt.id).is("started_at", null));
  }
  return getQualifierPlayState(identity);
}

export async function finishQualifierViewing(identity: Identity | null) {
  const client = supabaseAdmin();
  const player = await requirePlayer(client, identity);
  const { attempt } = await qualifierRows(client, player);
  if (!attempt?.started_at) throw new HttpError(409, "The qualifier timer has not started.");
  take(await client.from("qualifier_attempts").update({ expires_at: new Date().toISOString() }).eq("id", attempt.id).is("submitted_at", null));
  return getQualifierPlayState(identity);
}

async function finalizeQualifierIfReady(client: SupabaseClient, qualifier: QualifierRow) {
  const players = take(await client.from("players").select("*").eq("tournament_id", qualifier.tournament_id)) as PlayerRow[];
  const attempts = take(await client.from("qualifier_attempts").select("*").eq("qualifier_id", qualifier.id).not("submitted_at", "is", null)) as QualifierAttemptRow[];
  if (attempts.length !== players.length) return;
  const fallbackSeed = new Map(players.map((player) => [player.id, player.seed ?? Infinity]));
  const ranked = [...attempts].sort((left, right) => (left.distance_km as number) - (right.distance_km as number) || (fallbackSeed.get(left.player_id) ?? Infinity) - (fallbackSeed.get(right.player_id) ?? Infinity));
  const claim = await client.from("qualifiers").update({ status: "complete", completed_at: new Date().toISOString() }).eq("id", qualifier.id).eq("status", "open").select("id").maybeSingle();
  if (claim.error) take(claim);
  if (!claim.data) return;
  take(await client.from("players").update({ seed: null }).eq("tournament_id", qualifier.tournament_id));
  for (let index = 0; index < ranked.length; index += 1) take(await client.from("players").update({ seed: index + 1 }).eq("id", ranked[index].player_id));
  const tournament = one(await client.from("tournaments").select("*").eq("id", qualifier.tournament_id).single()) as TournamentRow;
  await createRankingGroup(client, tournament, ranked.map((attempt) => attempt.player_id), 1);
  take(await client.from("tournaments").update({ status: "tournament" }).eq("id", qualifier.tournament_id).eq("status", "qualifier"));
  await audit(client, qualifier.tournament_id, "complete_qualifier", { earnedByePlayerIds: ranked.slice(0, openingRound(ranked).byes.length).map((attempt) => attempt.player_id) });
}

export async function submitQualifierGuess(identity: Identity | null, guess: { lat: number; lng: number }) {
  if (!Number.isFinite(guess.lat) || guess.lat < -90 || guess.lat > 90 || !Number.isFinite(guess.lng) || guess.lng < -180 || guess.lng > 180) throw new HttpError(400, "That guess is not on Earth.");
  const client = supabaseAdmin();
  const player = await requirePlayer(client, identity);
  const { qualifier, attempt } = await qualifierRows(client, player);
  if (!attempt?.started_at || !attempt.expires_at) throw new HttpError(409, "Start the qualifier before guessing.");
  if (new Date(attempt.expires_at).getTime() > Date.now() + 1000) throw new HttpError(409, "Finish viewing before submitting.");
  const update = await client.from("qualifier_attempts").update({ guessed_lat: guess.lat, guessed_lng: guess.lng, distance_km: haversineKm({ lat: qualifier.actual_lat, lng: qualifier.actual_lng }, guess), submitted_at: new Date().toISOString() }).eq("id", attempt.id).is("submitted_at", null).select("id").maybeSingle();
  if (update.error) take(update);
  if (!update.data) throw new HttpError(409, "That qualifier guess is already locked.");
  await finalizeQualifierIfReady(client, qualifier);
  return getQualifierPlayState(identity);
}

async function playableMatch(client: SupabaseClient, matchId: string, player: PlayerRow) {
  const match = one(
    await client.from("matches").select("*").eq("id", matchId).single(),
    "That matchup does not exist.",
  ) as MatchRow;
  if (![match.player_1_id, match.player_2_id].includes(player.id)) {
    throw new HttpError(403, "This is not your matchup, spectator bozo.");
  }
  if (match.status === "complete") throw new HttpError(409, "That matchup is already complete.");
  return match;
}

export async function getPlayState(matchId: string, identity: Identity | null): Promise<PlayState> {
  const client = supabaseAdmin();
  const player = await requirePlayer(client, identity);
  const state = await getAppState(identity);
  const summary = state.matches.find((match) => match.id === matchId);
  if (!summary) throw new HttpError(404, "That matchup does not exist.");
  if (![summary.player1.id, summary.player2.id].includes(player.id)) {
    throw new HttpError(403, "This is not your matchup, spectator bozo.");
  }

  const challengeRows = take(
    await client.from("challenges").select("*").eq("match_id", matchId).order("sequence"),
  ) as ChallengeRow[];
  const attemptRows = take(
    await client.from("attempts").select("*").eq("match_id", matchId).eq("player_id", player.id),
  ) as AttemptRow[];
  const attemptMap = new Map(attemptRows.map((attempt) => [attempt.challenge_id, attempt]));
  const now = Date.now();
  let priorSubmitted = true;
  const challenges: ChallengeState[] = challengeRows.map((challenge) => {
    const attempt = attemptMap.get(challenge.id);
    let status: ChallengeState["status"] = "locked";
    if (attempt?.submitted_at) status = "submitted";
    else if (!priorSubmitted) status = "locked";
    else if (!attempt) status = "ready";
    else if (!attempt.started_at) status = "prepared";
    else if (attempt.expires_at && new Date(attempt.expires_at).getTime() > now) status = "viewing";
    else status = "guessing";

    const canSeePano = status === "prepared" || status === "viewing";
    priorSubmitted = Boolean(attempt?.submitted_at);
    return {
      id: challenge.id,
      sequence: challenge.sequence,
      status,
      ...(canSeePano
        ? { panoId: challenge.pano_id, heading: challenge.heading, pitch: challenge.pitch }
        : {}),
      ...(attempt?.expires_at ? { expiresAt: attempt.expires_at } : {}),
    };
  });

  return {
    match: summary,
    challenges,
    activeChallenge: challenges.find((challenge) => challenge.status !== "submitted" && challenge.status !== "locked") ?? null,
    serverNow: new Date().toISOString(),
    viewSeconds: state.tournament?.viewSeconds ?? DEFAULT_VIEW_SECONDS,
  };
}

async function currentChallenge(client: SupabaseClient, matchId: string, playerId: string) {
  const challenges = take(
    await client.from("challenges").select("*").eq("match_id", matchId).order("sequence"),
  ) as ChallengeRow[];
  const attempts = take(
    await client.from("attempts").select("*").eq("match_id", matchId).eq("player_id", playerId),
  ) as AttemptRow[];
  const attemptMap = new Map(attempts.map((attempt) => [attempt.challenge_id, attempt]));
  const challenge = challenges.find((item) => !attemptMap.get(item.id)?.submitted_at);
  if (!challenge) throw new HttpError(409, "You already finished this matchup.");
  const prior = challenges.filter((item) => item.sequence < challenge.sequence);
  if (prior.some((item) => !attemptMap.get(item.id)?.submitted_at)) {
    throw new HttpError(409, "Finish the previous location first.");
  }
  return { challenge, attempt: attemptMap.get(challenge.id) ?? null };
}

export async function prepareChallenge(matchId: string, identity: Identity | null) {
  const client = supabaseAdmin();
  const player = await requirePlayer(client, identity);
  const match = await playableMatch(client, matchId, player);
  const current = await currentChallenge(client, matchId, player.id);
  if (!current.attempt) {
    const insertResult = await client.from("attempts").insert({
      challenge_id: current.challenge.id,
      match_id: match.id,
      player_id: player.id,
    });
    if (insertResult.error && insertResult.error.code !== "23505") take(insertResult);
  }
  return getPlayState(matchId, identity);
}

export async function startChallenge(matchId: string, identity: Identity | null) {
  const client = supabaseAdmin();
  const player = await requirePlayer(client, identity);
  const match = await playableMatch(client, matchId, player);
  const current = await currentChallenge(client, matchId, player.id);
  if (!current.attempt) throw new HttpError(409, "Load Street View before starting the timer.");

  if (!current.attempt.started_at) {
    const tournament = one(
      await client.from("tournaments").select("settings").eq("id", match.tournament_id).single(),
    ) as { settings: { viewSeconds?: number } };
    const startedAt = new Date();
    const expiresAt = new Date(
      startedAt.getTime() + (tournament.settings.viewSeconds ?? DEFAULT_VIEW_SECONDS) * 1000,
    );
    const updateResult = await client
      .from("attempts")
      .update({ started_at: startedAt.toISOString(), expires_at: expiresAt.toISOString() })
      .eq("id", current.attempt.id)
      .is("started_at", null);
    take(updateResult);
    take(await client.from("matches").update({ status: "in_progress" }).eq("id", match.id).eq("status", "ready"));
  }
  return getPlayState(matchId, identity);
}

export async function finishViewing(matchId: string, identity: Identity | null) {
  const client = supabaseAdmin();
  const player = await requirePlayer(client, identity);
  await playableMatch(client, matchId, player);
  const current = await currentChallenge(client, matchId, player.id);
  if (!current.attempt?.started_at) throw new HttpError(409, "The timer has not started.");
  if (!current.attempt.submitted_at) {
    take(
      await client
        .from("attempts")
        .update({ expires_at: new Date().toISOString() })
        .eq("id", current.attempt.id)
        .is("submitted_at", null),
    );
  }
  return getPlayState(matchId, identity);
}

export async function submitGuess(
  matchId: string,
  identity: Identity | null,
  guess: { lat: number; lng: number },
) {
  if (!Number.isFinite(guess.lat) || guess.lat < -90 || guess.lat > 90) {
    throw new HttpError(400, "Guess latitude is invalid.");
  }
  if (!Number.isFinite(guess.lng) || guess.lng < -180 || guess.lng > 180) {
    throw new HttpError(400, "Guess longitude is invalid.");
  }

  const client = supabaseAdmin();
  const player = await requirePlayer(client, identity);
  await playableMatch(client, matchId, player);
  const current = await currentChallenge(client, matchId, player.id);
  if (!current.attempt?.started_at || !current.attempt.expires_at) {
    throw new HttpError(409, "Start the location before guessing.");
  }
  if (new Date(current.attempt.expires_at).getTime() > Date.now() + 1000) {
    throw new HttpError(409, "Finish viewing before submitting a guess.");
  }
  if (current.attempt.submitted_at) throw new HttpError(409, "That guess is already locked.");

  const distanceKm = haversineKm(
    { lat: current.challenge.actual_lat, lng: current.challenge.actual_lng },
    guess,
  );
  const update = await client
    .from("attempts")
    .update({
      guessed_lat: guess.lat,
      guessed_lng: guess.lng,
      distance_km: distanceKm,
      submitted_at: new Date().toISOString(),
    })
    .eq("id", current.attempt.id)
    .is("submitted_at", null)
    .select("id")
    .maybeSingle();
  if (update.error) take(update);
  if (!update.data) throw new HttpError(409, "That guess is already locked.");
  await finalizeMatchIfReady(client, matchId);
  return getPlayState(matchId, identity);
}

export async function selectDraftSlot(identity: Identity | null, slot: number) {
  const client = supabaseAdmin();
  const player = await requirePlayer(client, identity);
  const tournament = await latestTournament(client);
  if (!tournament || tournament.id !== player.tournament_id || tournament.status !== "draft_selection") {
    throw new HttpError(409, "Draft-slot selection is not active.");
  }
  const playerCountResult = await client
    .from("players")
    .select("id", { count: "exact", head: true })
    .eq("tournament_id", tournament.id);
  if (playerCountResult.error) take(playerCountResult);
  const rosterSize = playerCountResult.count ?? 0;
  if (!Number.isInteger(slot) || slot < 1 || slot > rosterSize) {
    throw new HttpError(400, "That draft slot is not valid.");
  }

  const selection = await client.rpc("select_draft_slot_atomic", {
    p_tournament_id: tournament.id,
    p_player_id: player.id,
    p_draft_slot: slot,
  });
  if (selection.error) {
    const expected = ["not your turn", "not valid", "just taken", "not active"]
      .some((message) => selection.error.message.toLowerCase().includes(message));
    throw new HttpError(expected ? 409 : 500, selection.error.message);
  }
  return getAppState(identity);
}

export async function getAdminState(): Promise<AdminState> {
  const client = supabaseAdmin();
  const tournament = await latestTournament(client);
  const locations = take(
    await client.from("locations").select("*").order("region").order("country").order("label"),
  ) as LocationRow[];
  if (!tournament) {
    return {
      tournament: null,
      players: [],
      matches: [],
      draftSelections: [],
      qualifierSubmittedPlayerIds: [],
      locations: locations.map(asLocationCandidate),
      activeLocationCount: locations.filter((location) => location.active).length,
      requiredLocationCount: 0,
      expectedMatchCount: 0,
    };
  }

  const core = await queryCoreState(client, tournament, null);
  const expectedMatchCount = rankingMatchCount(core.players.length);
  const requiredLocationCount = locationsNeeded(
    core.players.length,
    tournament.settings.locationsPerMatch ?? DEFAULT_LOCATIONS_PER_MATCH,
  );
  const qualifierResult = await client.from("qualifiers").select("id").eq("tournament_id", tournament.id).maybeSingle();
  if (qualifierResult.error) take(qualifierResult);
  let qualifierSubmittedPlayerIds: string[] = [];
  if (qualifierResult.data) {
    const submitted = take(await client.from("qualifier_attempts").select("player_id").eq("qualifier_id", (qualifierResult.data as { id: string }).id).not("submitted_at", "is", null)) as Array<{ player_id: string }>;
    qualifierSubmittedPlayerIds = submitted.map((row) => row.player_id);
  }
  return {
    tournament: asTournamentSummary(tournament, core.players.length),
    players: core.players.map(asPlayerSummary),
    matches: buildMatchSummaries(core),
    draftSelections: core.drafts.map((draft) => ({
      playerId: draft.player_id,
      playerName: core.players.find((player) => player.id === draft.player_id)?.name ?? "Unknown Bozo",
      tournamentRank: draft.tournament_rank,
      draftSlot: draft.draft_slot,
      status: draft.status,
      unlockedAt: draft.unlocked_at,
      selectedAt: draft.selected_at,
    })),
    qualifierSubmittedPlayerIds,
    locations: locations.map(asLocationCandidate),
    activeLocationCount: locations.filter((location) => location.active).length,
    requiredLocationCount,
    expectedMatchCount,
  };
}

export async function seedLocationPool() {
  const client = supabaseAdmin();
  // Validation moves a row's lat/lng onto the panorama Google actually returned, so the
  // (lat, lng) unique index stops matching the seed it came from. Identity has to be the
  // place name, or re-seeding duplicates every candidate already validated.
  const existing = take(await client.from("locations").select("label,country")) as Array<{ label: string; country: string }>;
  const known = new Set(existing.map((location) => `${location.label}|${location.country}`));
  const fresh = WORLDWIDE_LOCATION_CANDIDATES.filter((location) => !known.has(`${location.label}|${location.country}`));
  if (fresh.length) {
    take(await client.from("locations").upsert(
      fresh.map((location) => ({ ...location, active: false })),
      { onConflict: "lat,lng", ignoreDuplicates: true },
    ));
  }
  return getAdminState();
}

export async function saveLocationValidation(input: {
  locationId: string;
  ok: boolean;
  panoId?: string;
  lat?: number;
  lng?: number;
  heading?: number;
  error?: string;
}) {
  const client = supabaseAdmin();
  if (input.ok) {
    if (
      !input.panoId ||
      !Number.isFinite(input.lat) ||
      !Number.isFinite(input.lng) ||
      !Number.isFinite(input.heading)
    ) {
      throw new HttpError(400, "Successful validation is missing panorama data.");
    }
    take(
      await client
        .from("locations")
        .update({
          pano_id: input.panoId,
          lat: input.lat,
          lng: input.lng,
          heading: input.heading,
          pitch: 0,
          active: true,
          validation_error: null,
          validated_at: new Date().toISOString(),
        })
        .eq("id", input.locationId),
    );
  } else {
    take(
      await client
        .from("locations")
        .update({
          pano_id: null,
          active: false,
          validation_error: input.error?.slice(0, 300) || "No Street View panorama found",
          validated_at: new Date().toISOString(),
        })
        .eq("id", input.locationId),
    );
  }
  return { ok: true };
}

export async function resetPlayerClaim(playerId: string) {
  const client = supabaseAdmin();
  const player = one(
    await client.from("players").select("tournament_id, name").eq("id", playerId).single(),
  ) as { tournament_id: string; name: string };
  take(
    await client
      .from("players")
      .update({ claim_token_hash: null, claimed_at: null })
      .eq("id", playerId),
  );
  await audit(client, player.tournament_id, "reset_player_claim", { playerId, name: player.name });
  return getAdminState();
}

export async function resetAttempt(matchId: string, playerId: string) {
  const client = supabaseAdmin();
  const match = one(
    await client.from("matches").select("*").eq("id", matchId).single(),
  ) as MatchRow;
  if (match.status === "complete") {
    throw new HttpError(409, "Undo the completed match manually before resetting attempts.");
  }
  take(await client.from("attempts").delete().eq("match_id", matchId).eq("player_id", playerId));
  const remainingResult = await client
    .from("attempts")
    .select("id", { count: "exact", head: true })
    .eq("match_id", matchId);
  if (remainingResult.error) take(remainingResult);
  take(
    await client
      .from("matches")
      .update({ status: remainingResult.count ? "in_progress" : "ready" })
      .eq("id", matchId),
  );
  await audit(client, match.tournament_id, "reset_attempt", { matchId, playerId });
  return getAdminState();
}

export async function resetQualifierAttempt(playerId: string) {
  const client = supabaseAdmin();
  const tournament = await latestTournament(client);
  if (!tournament || tournament.status !== "qualifier") throw new HttpError(409, "The qualifier is not open.");
  const qualifier = one(await client.from("qualifiers").select("id").eq("tournament_id", tournament.id).single()) as { id: string };
  take(await client.from("qualifier_attempts").delete().eq("qualifier_id", qualifier.id).eq("player_id", playerId));
  await audit(client, tournament.id, "reset_qualifier_attempt", { playerId });
  return getAdminState();
}

export async function overrideMatchWinner(matchId: string, winnerId: string) {
  const client = supabaseAdmin();
  const match = one(
    await client.from("matches").select("*").eq("id", matchId).single(),
  ) as MatchRow;
  if (match.status === "complete") {
    throw new HttpError(409, "This match already advanced. Adjusting it now would corrupt later rounds.");
  }
  if (![match.player_1_id, match.player_2_id].includes(winnerId)) {
    throw new HttpError(400, "Winner must be a player in the matchup.");
  }
  const loserId = winnerId === match.player_1_id ? match.player_2_id : match.player_1_id;
  take(
    await client
      .from("matches")
      .update({
        status: "complete",
        winner_id: winnerId,
        loser_id: loserId,
        completed_at: new Date().toISOString(),
      })
      .eq("id", matchId)
      .neq("status", "complete"),
  );
  await audit(client, match.tournament_id, "override_match_winner", { matchId, winnerId });
  await advanceGroup(client, match.group_id);
  return getAdminState();
}

export async function undoDraftSelection(tournamentRank: number) {
  const client = supabaseAdmin();
  const tournament = await latestTournament(client);
  if (!tournament || !["draft_selection", "complete"].includes(tournament.status)) {
    throw new HttpError(409, "Draft-slot selection has not started.");
  }
  const rows = take(
    await client
      .from("draft_slot_selections")
      .select("tournament_rank")
      .eq("tournament_id", tournament.id)
      .gte("tournament_rank", tournamentRank),
  ) as Array<{ tournament_rank: number }>;
  if (!rows.length) throw new HttpError(404, "That queue rank does not exist.");

  take(
    await client
      .from("draft_slot_selections")
      .update({ draft_slot: null, status: "waiting", selected_at: null, unlocked_at: null })
      .eq("tournament_id", tournament.id)
      .gte("tournament_rank", tournamentRank),
  );
  take(
    await client
      .from("draft_slot_selections")
      .update({ status: "active", unlocked_at: new Date().toISOString() })
      .eq("tournament_id", tournament.id)
      .eq("tournament_rank", tournamentRank),
  );
  take(
    await client
      .from("tournaments")
      .update({
        status: "draft_selection",
        current_selector_rank: tournamentRank,
        completed_at: null,
      })
      .eq("id", tournament.id),
  );
  await audit(client, tournament.id, "undo_draft_selection", { tournamentRank });
  return getAdminState();
}

export async function assignDraftSlot(tournamentRank: number, draftSlot: number) {
  const client = supabaseAdmin();
  const tournament = await latestTournament(client);
  if (!tournament || !["draft_selection", "complete"].includes(tournament.status)) {
    throw new HttpError(409, "Draft-slot selection has not started.");
  }
  let row = one(
    await client
      .from("draft_slot_selections")
      .select("player_id, status")
      .eq("tournament_id", tournament.id)
      .eq("tournament_rank", tournamentRank)
      .single(),
    "That queue rank does not exist.",
  ) as { player_id: string; status: DraftRow["status"] };
  if (row.status === "selected") {
    await undoDraftSelection(tournamentRank);
    row = { ...row, status: "active" };
  }
  if (row.status !== "active") throw new HttpError(409, "Only the player on the clock can be assigned a slot.");
  const result = await client.rpc("select_draft_slot_atomic", {
    p_tournament_id: tournament.id,
    p_player_id: row.player_id,
    p_draft_slot: draftSlot,
  });
  if (result.error) throw new HttpError(409, result.error.message);
  await audit(client, tournament.id, "assign_draft_slot", { tournamentRank, draftSlot });
  return getAdminState();
}

export async function resetLocationValidation(locationId: string) {
  const client = supabaseAdmin();
  take(
    await client
      .from("locations")
      .update({ pano_id: null, active: false, validation_error: null, validated_at: null })
      .eq("id", locationId),
  );
  return getAdminState();
}

export async function regenerateBracket() {
  const client = supabaseAdmin();
  const tournament = await latestTournament(client);
  if (!tournament || tournament.status !== "tournament") {
    throw new HttpError(409, "There is no active bracket to regenerate.");
  }
  const matchRows = take(
    await client.from("matches").select("id").eq("tournament_id", tournament.id),
  ) as Array<{ id: string }>;
  if (matchRows.length) {
    const attempts = await client
      .from("attempts")
      .select("id", { count: "exact", head: true })
      .in("match_id", matchRows.map((match) => match.id));
    if (attempts.error) take(attempts);
    if (attempts.count) throw new HttpError(409, "Somebody already started playing. Reset individual attempts instead.");
  }
  take(await client.from("ranking_groups").delete().eq("tournament_id", tournament.id));
  take(
    await client
      .from("players")
      .update({ seed: null, tournament_rank: null })
      .eq("tournament_id", tournament.id),
  );
  take(
    await client
      .from("tournaments")
      .update({ status: "lobby", started_at: null })
      .eq("id", tournament.id),
  );
  await audit(client, tournament.id, "regenerate_bracket");
  return startTournament();
}

export async function resetTournament() {
  const client = supabaseAdmin();
  const tournament = await latestTournament(client);
  if (!tournament) return getAdminState();
  take(await client.from("tournaments").delete().eq("id", tournament.id));
  await audit(client, null, "reset_tournament", { deletedTournamentId: tournament.id });
  return getAdminState();
}
