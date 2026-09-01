"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, readIdentity, saveIdentity } from "@/lib/client-api";
import { byeCount } from "@/lib/tournament";
import type { AppState, MatchSummary } from "@/lib/types";
import BracketView from "./BracketView";
import styles from "./HomeApp.module.css";

const MARQUEE = "★★★ NO CHEATING, LOSERS ★★★ WORLDWIDE GEOGRAPHICAL COMBAT ★★★";

function emptyState(): AppState {
  return {
    configured: false,
    tournament: null,
    players: [],
    matches: [],
    draftSelections: [],
    qualifier: null,
    me: null,
    serverNow: new Date().toISOString(),
  };
}

function name(player: { name: string; emoji: string | null }) {
  return `${player.emoji ? `${player.emoji} ` : ""}${player.name}`;
}

function totalFor(match: MatchSummary, playerId: string) {
  return match.results?.reduce((sum, result) => {
    const guess = result.guesses.find((item) => item.playerId === playerId);
    return sum + (guess?.distanceKm ?? 0);
  }, 0) ?? 0;
}

function ResultCard({ match }: { match: MatchSummary }) {
  if (!match.results) return null;
  const scored = match.results.every((result) => result.guesses.length === 2);
  const winner = match.winnerId === match.player1.id ? match.player1 : match.player2;
  if (!scored) {
    return (
      <div className={styles.resultCard}>
        <p>🏆 {name(winner)} ADVANCED BY COMMISSIONER DECISION</p>
      </div>
    );
  }
  const player1Total = totalFor(match, match.player1.id);
  const player2Total = totalFor(match, match.player2.id);
  return (
    <details className={styles.resultCard}>
      <summary>🏆 {name(winner)} WON — VIEW THE COOKING</summary>
      <div className={styles.resultGrid}>
        {match.results.map((result) => (
          <div key={result.sequence}>
            <strong>LOCATION {result.sequence}: {result.actual.label}, {result.actual.country}</strong>
            {result.guesses.map((guess) => (
              <span key={guess.playerId}>{guess.playerName}: {guess.distanceKm.toFixed(1)} KM</span>
            ))}
          </div>
        ))}
      </div>
      <p className={styles.finalScore}>
        {match.player1.name}: {player1Total.toFixed(1)} KM &nbsp; VS &nbsp;
        {match.player2.name}: {player2Total.toFixed(1)} KM
      </p>
    </details>
  );
}

export default function HomeApp() {
  const [state, setState] = useState<AppState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const next = await apiFetch<AppState>("/api/state");
      setState(next);
      setError("");
      if (readIdentity() && !next.me) saveIdentity(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load the Thunderdome.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(true), 15_000);
    const onFocus = () => void load(true);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const myMatches = useMemo(
    () => state.me
      ? state.matches.filter((match) => [match.player1.id, match.player2.id].includes(state.me?.id ?? ""))
      : [],
    [state.matches, state.me],
  );
  const activeMatch = myMatches.find((match) => match.status !== "complete");
  const completedMatches = state.matches.filter((match) => match.status === "complete").reverse();

  async function claim(playerId: string, playerName: string) {
    if (!window.confirm(`YES, I AM ${playerName.toUpperCase()}?\n\nDo not claim somebody else's name, bozo.`)) return;
    setBusy(true);
    try {
      const identity = await apiFetch<{ playerId: string; token: string }>("/api/actions", {
        method: "POST",
        body: JSON.stringify({ action: "claim-player", playerId }),
      }, null);
      saveIdentity(identity);
      await load(true);
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "Claim failed.");
    } finally {
      setBusy(false);
    }
  }

  async function chooseSlot(slot: number) {
    if (!window.confirm(`DRAFT FROM THE ${slot} SPOT?\n\nTHIS CANNOT BE UNDONE.`)) return;
    setBusy(true);
    try {
      const next = await apiFetch<AppState>("/api/actions", {
        method: "POST",
        body: JSON.stringify({ action: "select-draft-slot", slot }),
      });
      setState(next);
    } catch (slotError) {
      setError(slotError instanceof Error ? slotError.message : "Slot selection failed.");
      await load(true);
    } finally {
      setBusy(false);
    }
  }

  const tournament = state.tournament;
  const myTurn = !!activeMatch && !!tournament && activeMatch.mySubmittedCount < tournament.locationsPerMatch;
  const claimedCount = state.players.filter((player) => player.claimed).length;
  const activeSelection = state.draftSelections.find((selection) => selection.status === "active");
  const selectedSlots = new Set(
    state.draftSelections.map((selection) => selection.draftSlot).filter((slot): slot is number => slot !== null),
  );
  const mySelection = state.me
    ? state.draftSelections.find((selection) => selection.playerId === state.me?.id)
    : null;
  const availablePlayers = state.players.filter((player) => !player.claimed);

  return (
    <main className="page-shell">
      <div className="marquee"><span>{MARQUEE}</span><span aria-hidden="true">{MARQUEE}</span></div>
      <header className="hero">
        <p className="hero-kicker">🏈 EST. 2026 • BEST VIEWED ON A PHONE PROBABLY 🏈</p>
        <h1>{tournament?.title ?? "DA GEOGUESSERS"}</h1>
        <p className="hero-subtitle">THE DRAFT SLOT THUNDERDOME</p>
      </header>

      {error && <div className="error-box" role="alert">🚨 {error}</div>}
      {!loading && tournament && tournament.status !== "lobby" && !state.me && (
        <section className="panel panel-purple">
          <h2 className="panel-title">THIS BROWSER HAS NO WARRIOR</h2>
          {availablePlayers.length ? (
            <>
              <p className="pixel-copy">Pick the name the commissioner reset for you.</p>
              <div className={styles.roster}>
                {availablePlayers.map((player) => (
                  <button className={styles.playerButton} disabled={busy} key={player.id} onClick={() => void claim(player.id, player.name)}>
                    <span>?</span><strong>{name(player)}</strong><small>RECLAIM THIS BOZO</small>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="pixel-copy">Every name is already claimed. Ask the commissioner to reset yours.</p>
          )}
        </section>
      )}
      {loading ? (
        <section className="panel panel-purple"><h2 className="panel-title">CONNECTING TO THE THUNDERDOME...</h2></section>
      ) : !state.configured || !tournament ? (
        <section className="panel">
          <h2 className="panel-title">THE COMMISSIONER IS SLACKING</h2>
          <p className="pixel-copy">The arena is not ready yet. Come back when somebody sends the league the all-clear.</p>
        </section>
      ) : tournament.status === "lobby" ? (
        <>
          <section className="panel panel-purple">
            <h2 className="panel-title">CHOOSE YOUR WARRIOR</h2>
            <p className={styles.arrivalCount}><span className="big-number">{claimedCount}</span> / {state.players.length} IDIOTS HAVE ARRIVED</p>
            {state.me && <p className="notice-box">✓ YOU ARE {name(state.me).toUpperCase()}</p>}
            <div className={styles.roster}>
              {state.players.map((player) => (
                <button
                  className={`${styles.playerButton} ${player.claimed ? styles.claimed : ""}`}
                  disabled={busy || player.claimed || Boolean(state.me)}
                  key={player.id}
                  onClick={() => void claim(player.id, player.name)}
                >
                  <span>{player.claimed ? "✓" : "?"}</span>
                  <strong>{name(player)}</strong>
                  <small>{player.claimed ? "READY TO GET COOKED" : "AVAILABLE"}</small>
                </button>
              ))}
            </div>
          </section>
          <section className="panel pixel-copy">
            <strong>HOW THIS NONSENSE WORKS:</strong> You will play asynchronous worldwide geography matchups. The final ranking decides who chooses a fantasy draft slot first. It does not assign Pick #1 automatically.
          </section>
        </>
      ) : tournament.status === "qualifier" ? (
        <>
          <section className={`${styles.yourTurn} panel`}>
            <div className={styles.flash}>🌍 THE BYE-WEEK BLOODBATH 🌍</div>
            <h2>ONE LOCATION. TOP PLAYERS EARN THE BYES.</h2>
            <p className="pixel-copy">{state.qualifier?.submittedCount ?? 0} / {state.qualifier?.totalPlayers ?? state.players.length} FINISHED</p>
            {state.me ? state.qualifier?.meSubmitted ? <p className="pixel-copy">YOUR GUESS IS LOCKED. SCORES STAY HIDDEN UNTIL EVERY BOZO FINISHES.</p> : <Link className="btn" href="/qualifier">PLAY THE QUALIFIER</Link> : <p className="pixel-copy">CLAIM YOUR RESET NAME ABOVE BEFORE PLAYING.</p>}
          </section>
        </>
      ) : tournament.status === "tournament" ? (
        <>
          <QualifierResults state={state} />
          {state.me && activeMatch && myTurn && (
            <section className={`${styles.yourTurn} panel`}>
              <div className={styles.flash}>🚨 YOUR TURN, BOZO 🚨</div>
              <h2>{activeMatch.player1.name} VS {activeMatch.player2.name}</h2>
              <Link className="btn" href={`/play/${activeMatch.id}`}>PLAY NOW</Link>
            </section>
          )}
          {state.me && !myTurn && (
            <WaitingRoom state={state} rosterSize={tournament.rosterSize} activeMatch={activeMatch} />
          )}
          <BracketView matches={state.matches} rosterSize={tournament.rosterSize} />
          {completedMatches.length > 0 && (
            <section className="panel panel-purple">
              <h2 className="panel-title">RESULTS VAULT</h2>
              {completedMatches.map((match) => <ResultCard match={match} key={match.id} />)}
            </section>
          )}
        </>
      ) : tournament.status === "draft_selection" ? (
        <>
          {mySelection?.status === "active" ? (
            <section className={`${styles.yourTurn} panel`}>
              <div className={styles.flash}>🏈 IT&apos;S YOUR TURN 🏈</div>
              <h2>YOU FINISHED #{mySelection.tournamentRank}. CHOOSE YOUR DRAFT SLOT.</h2>
              <div className={styles.slotGrid}>
                {Array.from({ length: tournament.rosterSize }, (_, index) => index + 1).map((slot) => (
                  <button className="btn" disabled={busy || selectedSlots.has(slot)} key={slot} onClick={() => void chooseSlot(slot)}>
                    {selectedSlots.has(slot) ? "✕" : slot}
                  </button>
                ))}
              </div>
              <p className="pixel-copy">CHOOSE WISELY. THIS CANNOT BE UNDONE BY MORTALS.</p>
            </section>
          ) : (
            <section className="panel panel-purple">
              <h2 className="panel-title">WAITING FOR {activeSelection?.playerName?.toUpperCase() ?? "SOME BUM"}</h2>
              {mySelection && <p className="pixel-copy">YOU&apos;RE #{mySelection.tournamentRank} IN LINE.</p>}
            </section>
          )}
          <DraftBoard state={state} />
          <QualifierResults state={state} />
          <RankingBoard state={state} />
          <BracketView matches={state.matches} rosterSize={tournament.rosterSize} recap />
        </>
      ) : (
        <>
          <FinalBoard state={state} />
          <QualifierResults state={state} />
          <RankingBoard state={state} />
          <BracketView matches={state.matches} rosterSize={tournament.rosterSize} recap />
        </>
      )}

      <footer className={styles.footer}>
        <span>🌎 {tournament?.viewSeconds ?? 60} SECOND NO-MOVE MAYHEM</span>
      </footer>
    </main>
  );
}

function QualifierResults({ state }: { state: AppState }) {
  if (!state.qualifier?.rankings) return null;
  const byes = byeCount(state.players.length);
  return <section className="panel panel-purple"><h2 className="panel-title">BYE-WEEK BLOODBATH RESULTS</h2><div className={styles.rankingBoard}>{state.qualifier.rankings.map((result, index) => <div key={result.playerId}><strong>#{result.seed}</strong><span>{index < byes ? "🎟️ " : ""}{result.playerName} — {result.forfeited ? "NO SHOW" : `${result.distanceKm.toFixed(1)} KM`} {index < byes ? "• BYE EARNED" : ""}</span></div>)}</div></section>;
}

// Groups shrink as a player descends the bracket, so the smallest group a player
// appears in is their current one, and phase then round order it from there.
function byRecency(left: MatchSummary, right: MatchSummary) {
  const size = (match: MatchSummary) => match.groupRankEnd - match.groupRankStart + 1;
  const phaseRank = (match: MatchSummary) => (match.phase === "play_in" ? 0 : 1);
  return size(right) - size(left)
    || phaseRank(left) - phaseRank(right)
    || left.roundNumber - right.roundNumber;
}

function PendingLine({ pending, singular, plural }: { pending: MatchSummary[]; singular: string; plural: string }) {
  if (!pending.length) {
    return <div className="notice-box">The next round is being built. This page refreshes itself every 15 seconds.</div>;
  }
  return (
    <div className="notice-box">
      Still waiting on {pending.length} {pending.length === 1 ? singular : plural}:{" "}
      {pending.map((match) => `${match.player1.name} vs ${match.player2.name}`).join(", ")}.
    </div>
  );
}

function WaitingRoom({ state, rosterSize, activeMatch }: {
  state: AppState;
  rosterSize: number;
  activeMatch?: MatchSummary;
}) {
  const me = state.me;
  if (!me) return null;

  if (activeMatch) {
    const opponent = activeMatch.player1.id === me.id ? activeMatch.player2 : activeMatch.player1;
    return (
      <section className="panel">
        <h2 className="panel-title">⏳ WAITING ON {name(opponent).toUpperCase()}</h2>
        <p className="pixel-copy">Your guesses are locked in. Nothing for you to do until {name(opponent)} plays this match.</p>
        <div className="notice-box">Scores stay hidden until you both finish. This page refreshes itself every 15 seconds.</div>
      </section>
    );
  }

  if (me.tournamentRank !== null) {
    const unranked = state.players.filter((player) => player.tournamentRank === null).length;
    return (
      <section className="panel">
        <h2 className="panel-title">🏁 YOU FINISHED #{me.tournamentRank}</h2>
        <p className="pixel-copy">Your rank is locked. You pick your draft slot {me.tournamentRank === 1 ? "first" : `${ordinal(me.tournamentRank)}`}.</p>
        <div className="notice-box">
          {unranked
            ? `The draft-slot draft opens once the last ${unranked} ${unranked === 1 ? "bozo gets" : "bozos get"} ranked.`
            : "Everybody is ranked. The draft-slot draft is about to open."}
        </div>
      </section>
    );
  }

  const myMatches = state.matches.filter((match) => [match.player1.id, match.player2.id].includes(me.id));

  if (!myMatches.length) {
    const pending = state.matches.filter((match) =>
      match.groupRankStart === 1 && match.groupRankEnd === rosterSize && match.status !== "complete");
    return (
      <section className="panel">
        <h2 className="panel-title">🎟️ YOU EARNED A BYE</h2>
        <p className="pixel-copy">
          Qualifier seed #{me.seed ?? "?"}. The top {byeCount(rosterSize)} skipped the play-in round entirely,
          so you enter straight at the next round against whoever survives.
        </p>
        <PendingLine pending={pending} singular="play-in" plural="play-ins" />
      </section>
    );
  }

  const latest = [...myMatches].sort(byRecency)[myMatches.length - 1];
  const opponent = latest.player1.id === me.id ? latest.player2 : latest.player1;
  const pending = state.matches.filter((match) =>
    match.groupId === latest.groupId
    && match.phase === latest.phase
    && match.roundNumber === latest.roundNumber
    && match.status !== "complete");

  return latest.winnerId === me.id ? (
    <section className="panel">
      <h2 className="panel-title">✅ YOU BEAT {name(opponent).toUpperCase()}</h2>
      <p className="pixel-copy">You advanced. Your next opponent gets decided when the rest of this round finishes.</p>
      <PendingLine pending={pending} singular="match" plural="matches" />
    </section>
  ) : (
    <section className="panel">
      <h2 className="panel-title">💀 {name(opponent).toUpperCase()} COOKED YOU</h2>
      <p className="pixel-copy">You dropped into the placement bracket for the lower ranks. You are still playing, just not for the crown.</p>
      <PendingLine pending={pending} singular="match" plural="matches" />
    </section>
  );
}

function ordinal(value: number) {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${value}th`;
  return `${value}${["th", "st", "nd", "rd"][value % 10] ?? "th"}`;
}

function RankingBoard({ state }: { state: AppState }) {
  const ranked = [...state.players]
    .filter((player) => player.tournamentRank !== null)
    .sort((left, right) => (left.tournamentRank ?? 99) - (right.tournamentRank ?? 99));
  return (
    <section className="panel panel-purple">
      <h2 className="panel-title">FINAL TOURNAMENT RANKING</h2>
      <div className={styles.rankingBoard}>
        {ranked.map((player) => (
          <div key={player.id}><strong>#{player.tournamentRank}</strong><span>{name(player)}</span></div>
        ))}
      </div>
    </section>
  );
}

function DraftBoard({ state }: { state: AppState }) {
  return (
    <section className="panel">
      <h2 className="panel-title">DRAFT SLOT DRAFT</h2>
      <div className={styles.draftBoard}>
        <b>PRIORITY</b><b>PLAYER</b><b>DRAFT POSITION</b>
        {state.draftSelections.map((selection) => (
          <div className={styles.draftRow} key={selection.playerId}>
            <strong>#{selection.tournamentRank}</strong>
            <span>{selection.playerName}</span>
            <span>{selection.draftSlot ? `PICK ${selection.draftSlot}` : selection.status === "active" ? "⏰ ON THE CLOCK" : "WAITING"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function FinalBoard({ state }: { state: AppState }) {
  const selections = [...state.draftSelections].sort((left, right) => (left.draftSlot ?? 99) - (right.draftSlot ?? 99));
  return (
    <section className={`${styles.finalBoard} panel`}>
      <div className={styles.flash}>🏆 THE PROPHECY HAS BEEN FULFILLED 🏆</div>
      <h2 className="panel-title">THE SACRED DRAFT ORDER</h2>
      {selections.map((selection) => (
        <div className={styles.finalPick} key={selection.playerId}>
          <strong>PICK {selection.draftSlot}</strong><span>—</span><b>{selection.playerName}</b>
        </div>
      ))}
    </section>
  );
}
