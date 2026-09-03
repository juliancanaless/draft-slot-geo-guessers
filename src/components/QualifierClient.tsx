"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client-api";
import type { QualifierPlayState } from "@/lib/types";
import { GuessMap, StreetView } from "./GameClient";
import styles from "./GameClient.module.css";

type Action = "prepare" | "start" | "finish-viewing" | "submit-guess";

export default function QualifierClient() {
  const [state, setState] = useState<QualifierPlayState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [guess, setGuess] = useState<{ lat: number; lng: number } | null>(null);
  const expiring = useRef(false);
  const load = useCallback(async () => {
    try { setState(await apiFetch<QualifierPlayState>("/api/qualifier")); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Qualifier failed to load."); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const act = useCallback(async (action: Action, payload: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const next = await apiFetch<QualifierPlayState>("/api/qualifier", { method: "POST", body: JSON.stringify({ action, ...payload }) });
      setState(next); setError(""); if (action === "submit-guess") setGuess(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Qualifier action failed."); }
    finally { setBusy(false); }
  }, []);
  const start = useCallback(() => void act("start"), [act]);
  const finish = useCallback(() => void act("finish-viewing"), [act]);
  useEffect(() => {
    const challenge = state?.challenge;
    if (challenge?.status !== "viewing" || !challenge.expiresAt || !state) return;
    const offset = new Date(state.serverNow).getTime() - Date.now();
    const tick = () => {
      const milliseconds = new Date(challenge.expiresAt as string).getTime() - (Date.now() + offset);
      setRemaining(Math.max(0, Math.ceil(milliseconds / 1000)));
      if (milliseconds <= 0 && !expiring.current) { expiring.current = true; void act("finish-viewing"); }
    };
    tick(); const timer = window.setInterval(tick, 250); return () => window.clearInterval(timer);
  }, [act, state]);
  useEffect(() => { expiring.current = false; }, [state?.challenge.id]);

  if (!state) return <main className="page-shell"><section className="panel"><h1>LOADING...</h1>{error && <p className="error-box">{error}</p>}</section></main>;
  const challenge = state.challenge;
  const sprint = state.format === "sprint";
  const title = sprint ? "THE SPRINT" : "THE BYE-WEEK BLOODBATH";
  const round = `LOCATION ${challenge.sequence} OF ${state.totalRounds}`;
  return <main className={styles.gameShell}>
    <header className={styles.gameHeader}><Link href="/">← HOME</Link><strong>{title}</strong><span>{sprint ? `${round} • LOWEST TOTAL WINS` : "ONE LOCATION • TOP SEEDS EARN BYES"}</span></header>
    {error && <div className="error-box">🚨 {error}</div>}
    {state.finished ? <section className={`${styles.centerCard} panel`}><h1>{sprint ? "THE SPRINT IS OVER" : "QUALIFIER COMPLETE"}</h1><p>{sprint ? "EVERY CARD IS IN. GO PICK YOUR SLOT." : "THE BYES HAVE BEEN EARNED. THE BRACKET IS LIVE."}</p><Link className="btn" href="/">{sprint ? "VIEW THE RESULTS" : "VIEW THE BRACKET"}</Link></section>
      : challenge.status === "submitted" ? <section className={`${styles.centerCard} panel`}><h1>{sprint ? "CARD LOCKED" : "GUESS LOCKED"}</h1><p className="pixel-copy">{state.submittedCount} / {state.totalPlayers} FINISHED. SCORES STAY SECRET UNTIL EVERYONE IS DONE.</p><Link className="btn" href="/">BACK HOME</Link></section>
      : challenge.status === "ready" ? <section className={`${styles.centerCard} panel`}><h1>{sprint ? round : "ONE LOCATION. FOUR BYES."}</h1><p className="pixel-copy">{sprint ? `Your distances across all ${state.totalRounds} locations add up, and the lowest total drafts first.` : "Closest guesses earn the byes."} You have {state.viewSeconds} seconds. Nobody sees any score until all players finish.</p><button className="btn btn-hot" disabled={busy} onClick={() => void act("prepare")}>{sprint && challenge.sequence > 1 ? "LOAD THE NEXT ONE" : "LOAD THE FIRST LOCATION"}</button></section>
      : challenge.status === "prepared" || challenge.status === "viewing" ? <StreetView challenge={challenge} busy={busy} remaining={remaining} onLoaded={start} onGuess={finish} />
      : challenge.status === "guessing" ? <GuessMap busy={busy} guess={guess} setGuess={setGuess} submit={() => { if (guess && window.confirm(`LOCK IN ${round}?`)) void act("submit-guess", guess); }} />
      : null}
  </main>;
}
