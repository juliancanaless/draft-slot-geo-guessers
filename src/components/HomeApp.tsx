"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, readIdentity, saveIdentity } from "@/lib/client-api";
import type { AppState, MatchSummary } from "@/lib/types";
import styles from "./HomeApp.module.css";

function emptyState(): AppState {
  return {
    configured: false,
    tournament: null,
    players: [],
    matches: [],
    draftSelections: [],
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
  const player1Total = totalFor(match, match.player1.id);
  const player2Total = totalFor(match, match.player2.id);
  const winner = match.winnerId === match.player1.id ? match.player1 : match.player2;
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
  const claimedCount = state.players.filter((player) => player.claimed).length;
  const activeSelection = state.draftSelections.find((selection) => selection.status === "active");
  const selectedSlots = new Set(
    state.draftSelections.map((selection) => selection.draftSlot).filter((slot): slot is number => slot !== null),
  );
  const mySelection = state.me
    ? state.draftSelections.find((selection) => selection.playerId === state.me?.id)
    : null;

  return (
    <main className="page-shell">
      <div className="marquee"><span>★★★ NO CHEATING, LOSERS ★★★ WORLDWIDE GEOGRAPHICAL COMBAT ★★★</span></div>
      <header className="hero">
        <p className="hero-kicker">🏈 EST. 2026 • BEST VIEWED ON A PHONE PROBABLY 🏈</p>
        <h1>{tournament?.title ?? "DA GEOGUESSERS"}</h1>
        <p className="hero-subtitle">THE DRAFT SLOT THUNDERDOME</p>
      </header>

      {error && <div className="error-box" role="alert">🚨 {error}</div>}
      {loading ? (
        <section className="panel panel-purple"><h2 className="panel-title">CONNECTING TO THE THUNDERDOME...</h2></section>
      ) : !state.configured || !tournament ? (
        <section className="panel">
          <h2 className="panel-title">THE COMMISSIONER IS SLACKING</h2>
          <p className="pixel-copy">The roster has not been configured yet. Somebody yell at the commissioner.</p>
          <Link className="btn btn-hot" href="/admin">COMMISSIONER CONTROL ROOM</Link>
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
      ) : tournament.status === "tournament" ? (
        <>
          {state.me && activeMatch && (
            <section className={`${styles.yourTurn} panel`}>
              <div className={styles.flash}>🚨 YOUR TURN, BOZO 🚨</div>
              <h2>{activeMatch.player1.name} VS {activeMatch.player2.name}</h2>
              {activeMatch.mySubmittedCount >= tournament.locationsPerMatch ? (
                <p className="pixel-copy">YOUR GUESSES ARE LOCKED. WAITING FOR THIS BUM TO FINISH.</p>
              ) : (
                <Link className="btn" href={`/play/${activeMatch.id}`}>PLAY NOW</Link>
              )}
            </section>
          )}
          {state.me && !activeMatch && (
            <section className="panel notice-box">NO MATCH READY RIGHT NOW. YOU ARE EITHER ADVANCING OR WAITING ON OTHER BOZOS.</section>
          )}
          <section className="panel">
            <h2 className="panel-title">THE BRACKET OF QUESTIONABLE DESTINY</h2>
            <div className={styles.matches}>
              {state.matches.map((match) => (
                <article className={styles.match} key={match.id}>
                  <div>
                    <span className="status-pill">RANKS {match.groupRankStart}–{match.groupRankEnd}</span>
                    <span className="status-pill">{match.phase === "play_in" ? "PLAY-IN" : `ROUND ${match.roundNumber + 1}`}</span>
                  </div>
                  <p className={match.winnerId === match.player1.id ? styles.winner : ""}>{name(match.player1)}</p>
                  <b>VS</b>
                  <p className={match.winnerId === match.player2.id ? styles.winner : ""}>{name(match.player2)}</p>
                  <small>{match.status.replaceAll("_", " ").toUpperCase()}</small>
                </article>
              ))}
            </div>
          </section>
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
        </>
      ) : (
        <FinalBoard state={state} />
      )}

      <footer className={styles.footer}>
        <span>🌎 {tournament?.viewSeconds ?? 60} SECOND NO-MOVE MAYHEM</span>
        <Link href="/admin">COMMISSIONER</Link>
      </footer>
    </main>
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
