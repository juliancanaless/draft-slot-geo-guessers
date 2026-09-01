export type TournamentStatus = "lobby" | "qualifier" | "tournament" | "draft_selection" | "complete";
export type MatchStatus = "ready" | "in_progress" | "complete";

export type PlayerSummary = {
  id: string;
  name: string;
  emoji: string | null;
  claimed: boolean;
  seed: number | null;
  tournamentRank: number | null;
};

/**
 * Where a location actually was plus everyone's pin, published only once nothing can be
 * cheated with it. A location is unique per tournament (`challenges` has a unique constraint
 * on it and the qualifier's is excluded from match draws), so a revealed one never comes back.
 * Forfeits have no coordinates and are simply absent here.
 */
export type Reveal = {
  actual: { lat: number; lng: number; label: string; country: string };
  guesses: Array<{
    playerId: string;
    playerName: string;
    lat: number;
    lng: number;
    distanceKm: number;
  }>;
};

export type MatchResult = Reveal & { sequence: number };

export type MatchSummary = {
  id: string;
  groupId: string;
  groupRankStart: number;
  groupRankEnd: number;
  phase: "play_in" | "knockout";
  roundNumber: number;
  matchIndex: number;
  player1: PlayerSummary;
  player2: PlayerSummary;
  status: MatchStatus;
  winnerId: string | null;
  mySubmittedCount: number;
  opponentSubmittedCount: number | null;
  results: MatchResult[] | null;
};

export type DraftSelectionSummary = {
  playerId: string;
  playerName: string;
  tournamentRank: number;
  draftSlot: number | null;
  status: "waiting" | "active" | "selected";
  unlockedAt: string | null;
  selectedAt: string | null;
};

export type TournamentSummary = {
  id: string;
  title: string;
  status: TournamentStatus;
  viewSeconds: number;
  locationsPerMatch: number;
  rosterSize: number;
  currentSelectorRank: number | null;
};

export type AppState = {
  configured: boolean;
  tournament: TournamentSummary | null;
  players: PlayerSummary[];
  matches: MatchSummary[];
  draftSelections: DraftSelectionSummary[];
  qualifier: QualifierSummary | null;
  me: PlayerSummary | null;
  serverNow: string;
  message?: string;
};

export type QualifierRanking = {
  playerId: string;
  playerName: string;
  seed: number;
  distanceKm: number;
  /** Admin marked them a no-show, so the distance is a placeholder that sorts last. */
  forfeited: boolean;
};

export type QualifierSummary = {
  status: "open" | "complete";
  submittedCount: number;
  totalPlayers: number;
  meSubmitted: boolean;
  rankings: QualifierRanking[] | null;
  reveal: Reveal | null;
};

export type QualifierPlayState = {
  challenge: ChallengeState;
  serverNow: string;
  viewSeconds: number;
  submittedCount: number;
  totalPlayers: number;
  results: {
    actual: Reveal["actual"];
    rankings: QualifierRanking[];
  } | null;
};

export type Identity = { playerId: string; token: string };

export type ChallengeState = {
  id: string;
  sequence: number;
  status: "locked" | "ready" | "prepared" | "viewing" | "guessing" | "submitted";
  panoId?: string;
  heading?: number;
  pitch?: number;
  expiresAt?: string;
};

export type PlayState = {
  match: MatchSummary;
  challenges: ChallengeState[];
  activeChallenge: ChallengeState | null;
  serverNow: string;
  viewSeconds: number;
};

export type LocationCandidate = {
  id: string;
  label: string;
  country: string;
  region: string | null;
  lat: number;
  lng: number;
  panoId: string | null;
  active: boolean;
  validationError: string | null;
  validatedAt: string | null;
};

export type AdminState = {
  tournament: TournamentSummary | null;
  players: PlayerSummary[];
  matches: MatchSummary[];
  draftSelections: DraftSelectionSummary[];
  qualifierSubmittedPlayerIds: string[];
  locations: LocationCandidate[];
  activeLocationCount: number;
  requiredLocationCount: number;
  expectedMatchCount: number;
};
