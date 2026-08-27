"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client-api";
import { loadGoogleMaps } from "@/lib/google-maps";
import type { ChallengeState, PlayState } from "@/lib/types";
import styles from "./GameClient.module.css";

type PlayAction = "prepare" | "start" | "finish-viewing" | "submit-guess";

function challengeLabel(challenge: ChallengeState | null, total: number) {
  return challenge ? `LOCATION ${challenge.sequence} OF ${total}` : "MATCH COMPLETE";
}

export default function GameClient({ matchId }: { matchId: string }) {
  const [state, setState] = useState<PlayState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [guess, setGuess] = useState<{ lat: number; lng: number } | null>(null);
  const expiringRef = useRef(false);

  const load = useCallback(async () => {
    try {
      setState(await apiFetch<PlayState>(`/api/play/${matchId}`));
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The match exploded.");
    }
  }, [matchId]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initial);
  }, [load]);

  const act = useCallback(async (action: PlayAction, payload: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const next = await apiFetch<PlayState>(`/api/play/${matchId}`, {
        method: "POST",
        body: JSON.stringify({ action, ...payload }),
      });
      if (action === "submit-guess") setGuess(null);
      setState(next);
      setError("");
      return next;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "That did not work.");
      return null;
    } finally {
      setBusy(false);
    }
  }, [matchId]);

  const startViewing = useCallback(() => { void act("start"); }, [act]);
  const finishViewing = useCallback(() => { void act("finish-viewing"); }, [act]);

  const active = state?.activeChallenge ?? null;
  useEffect(() => {
    expiringRef.current = false;
  }, [active?.id]);

  useEffect(() => {
    if (active?.status !== "viewing" || !active.expiresAt || !state?.serverNow) return;
    const serverOffset = new Date(state.serverNow).getTime() - Date.now();
    const tick = () => {
      const milliseconds = new Date(active.expiresAt as string).getTime() - (Date.now() + serverOffset);
      setRemaining(Math.max(0, Math.ceil(milliseconds / 1000)));
      if (milliseconds <= 0 && !expiringRef.current) {
        expiringRef.current = true;
        void act("finish-viewing");
      }
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [active?.expiresAt, active?.status, act, state?.serverNow]);

  if (!state) {
    return <main className="page-shell"><section className="panel"><h1>LOADING GEOGRAPHICAL NONSENSE...</h1>{error && <p className="error-box">{error}</p>}</section></main>;
  }

  const done = !active;
  return (
    <main className={styles.gameShell}>
      <header className={styles.gameHeader}>
        <Link href="/">← BRACKET</Link>
        <strong>{challengeLabel(active, state.challenges.length)}</strong>
        <span>{state.match.player1.name} VS {state.match.player2.name}</span>
      </header>
      {error && <div className="error-box">🚨 {error}</div>}

      {done ? (
        <section className={`${styles.centerCard} panel`}>
          <h1>MATCH COMPLETE</h1>
          <p className="pixel-copy">YOUR GUESSES ARE LOCKED IN. NO TAKESIES BACKSIES.</p>
          <p>{state.match.status === "complete" ? "THE RESULTS ARE IN." : "WAITING FOR YOUR OPPONENT..."}</p>
          <Link className="btn" href="/">BACK TO BRACKET</Link>
        </section>
      ) : active.status === "ready" ? (
        <section className={`${styles.centerCard} panel`}>
          <h1>LOCATION {active.sequence}</h1>
          <p className="pixel-copy">You get {state.viewSeconds} seconds. Look around, but no moving down the street.</p>
          <button className="btn btn-hot" disabled={busy} onClick={() => void act("prepare")}>LOAD THE WORLD</button>
        </section>
      ) : active.status === "prepared" || active.status === "viewing" ? (
        <StreetView challenge={active} busy={busy} remaining={remaining} onLoaded={startViewing} onGuess={finishViewing} />
      ) : active.status === "guessing" ? (
        <GuessMap busy={busy} guess={guess} setGuess={setGuess} submit={() => {
          if (!guess) return;
          if (window.confirm("LOCK IN THIS GUESS?\n\nYOU CANNOT CHANGE IT.")) void act("submit-guess", guess);
        }} />
      ) : (
        <section className={`${styles.centerCard} panel`}>
          <h1>LOCATION LOCKED</h1>
          <p>Finish the previous location first.</p>
          <button className="btn" onClick={() => void load()}>REFRESH</button>
        </section>
      )}
    </main>
  );
}

function StreetView({ challenge, busy, remaining, onLoaded, onGuess }: {
  challenge: ChallengeState;
  busy: boolean;
  remaining: number;
  onLoaded: () => void;
  onGuess: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(challenge.status === "viewing");
  const [mapError, setMapError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void loadGoogleMaps().then((maps) => {
      if (cancelled || !containerRef.current || !challenge.panoId) return;
      const panorama = new maps.StreetViewPanorama(containerRef.current, {
        pano: challenge.panoId,
        pov: { heading: challenge.heading ?? 0, pitch: challenge.pitch ?? 0 },
        visible: true,
        addressControl: false,
        clickToGo: false,
        linksControl: false,
        showRoadLabels: false,
        motionTracking: false,
        motionTrackingControl: false,
        fullscreenControl: false,
        enableCloseButton: false,
        zoomControl: true,
      });
      const listener = panorama.addListener("status_changed", () => {
        if (panorama.getStatus() === maps.StreetViewStatus.OK && !startedRef.current) {
          startedRef.current = true;
          onLoaded();
        }
      });
      return () => listener.remove();
    }).catch((cause) => setMapError(cause instanceof Error ? cause.message : "Street View failed."));
    return () => { cancelled = true; };
  }, [challenge.heading, challenge.panoId, challenge.pitch, onLoaded]);

  return (
    <section className={styles.playArea}>
      <div ref={containerRef} className={styles.mapCanvas} />
      {challenge.status === "prepared" && <div className={styles.loadingCurtain}>LOADING STREET VIEW...<small>THE TIMER STARTS WHEN THIS DISAPPEARS</small>{mapError && <b>{mapError}</b>}</div>}
      {challenge.status === "viewing" && <div className={styles.timer}>{remaining}</div>}
      {challenge.status === "viewing" && <button className={`${styles.guessButton} btn btn-hot`} disabled={busy} onClick={onGuess}>GUESS NOW</button>}
    </section>
  );
}

function GuessMap({ busy, guess, setGuess, submit }: {
  busy: boolean;
  guess: { lat: number; lng: number } | null;
  setGuess: (guess: { lat: number; lng: number }) => void;
  submit: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadGoogleMaps().then((maps) => {
      if (cancelled || !containerRef.current) return;
      const map = new maps.Map(containerRef.current, {
        center: { lat: 15, lng: 5 },
        zoom: 2,
        minZoom: 2,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
        gestureHandling: "greedy",
      });
      map.addListener("click", (event: google.maps.MapMouseEvent) => {
        const point = event.latLng;
        if (!point) return;
        const selected = { lat: point.lat(), lng: point.lng() };
        setGuess(selected);
        if (!markerRef.current) markerRef.current = new maps.Marker({ map, position: selected });
        else markerRef.current.setPosition(selected);
      });
    });
    return () => { cancelled = true; markerRef.current?.setMap(null); markerRef.current = null; };
  }, [setGuess]);

  return (
    <section className={styles.playArea}>
      <div ref={containerRef} className={styles.mapCanvas} />
      <div className={styles.guessPrompt}>DROP A PIN, GENIUS</div>
      <button className={`${styles.guessButton} btn`} disabled={busy || !guess} onClick={submit}>LOCK THAT SHIT IN</button>
    </section>
  );
}
