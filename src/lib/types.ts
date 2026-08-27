export type TournamentStatus = "lobby" | "tournament" | "draft_selection" | "complete";
export type MatchStatus = "ready" | "in_progress" | "complete";

export type PlayerSummary = {
  id: string;
  name: string;
  emoji: string | null;
  claimed: boolean;
  seed: number | null;
  tournamentRank: number | null;
};

export type MatchResult = {
  sequence: number;
  actual: { lat: number; lng: number; label: string; country: string };
  guesses: Array<{
    playerId: string;
    playerName: string;
    lat: number;
    lng: number;
    distanceKm: number;
  }>;
};

export type MatchSummary = {
  id: string;
  groupRankStart: number;
  groupRankEnd: number;
  phase: "play_in" | "knockout";
  roundNumber: number;
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
  me: PlayerSummary | null;
  message?: string;
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
};
