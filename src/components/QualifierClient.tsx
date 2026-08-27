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

  if (!state) return <main className="page-shell"><section className="panel"><h1>LOADING THE BYE-WEEK BLOODBATH...</h1>{error && <p className="error-box">{error}</p>}</section></main>;
  const challenge = state.challenge;
  return <main className={styles.gameShell}>
    <header className={styles.gameHeader}><Link href="/">← HOME</Link><strong>THE BYE-WEEK BLOODBATH</strong><span>ONE LOCATION • TOP SEEDS EARN BYES</span></header>
    {error && <div className="error-box">🚨 {error}</div>}
    {state.results ? <section className={`${styles.centerCard} panel`}><h1>QUALIFIER COMPLETE</h1><p>THE BYES HAVE BEEN EARNED. THE BRACKET IS LIVE.</p><Link className="btn" href="/">VIEW THE BRACKET</Link></section>
      : challenge.status === "submitted" ? <section className={`${styles.centerCard} panel`}><h1>GUESS LOCKED</h1><p className="pixel-copy">{state.submittedCount} / {state.totalPlayers} FINISHED. SCORES STAY SECRET UNTIL EVERYONE IS DONE.</p><Link className="btn" href="/">BACK HOME</Link></section>
      : challenge.status === "ready" ? <section className={`${styles.centerCard} panel`}><h1>ONE LOCATION. FOUR BYES.</h1><p className="pixel-copy">Closest guesses earn the byes. You have {state.viewSeconds} seconds. Nobody sees any score until all players finish.</p><button className="btn btn-hot" disabled={busy} onClick={() => void act("prepare")}>LOAD THE QUALIFIER</button></section>
      : challenge.status === "prepared" || challenge.status === "viewing" ? <StreetView challenge={challenge} busy={busy} remaining={remaining} onLoaded={start} onGuess={finish} />
      : challenge.status === "guessing" ? <GuessMap busy={busy} guess={guess} setGuess={setGuess} submit={() => { if (guess && window.confirm("LOCK IN THIS QUALIFIER GUESS?")) void act("submit-guess", guess); }} />
      : null}
  </main>;
}
