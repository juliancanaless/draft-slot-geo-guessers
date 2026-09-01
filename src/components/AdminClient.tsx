"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadGoogleMaps } from "@/lib/google-maps";
import { rosterCapacity } from "@/lib/tournament";
import type { AdminState, LocationCandidate } from "@/lib/types";
import styles from "./AdminClient.module.css";

const SECRET_KEY = "draft-slot-admin-secret";
const DEFAULT_NAMES = Array.from({ length: 12 }, (_, index) => `Player ${index + 1}`).join("\n");

async function adminFetch<T>(secret: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-admin-secret", secret);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch("/api/admin", { ...init, headers, cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Admin request failed (${response.status}).`);
  return body;
}

export default function AdminClient() {
  const [secret, setSecret] = useState("");
  const [draftSecret, setDraftSecret] = useState("");
  const [state, setState] = useState<AdminState | null>(null);
  const [title, setTitle] = useState("DA GEOGUESSERS");
  const [names, setNames] = useState(DEFAULT_NAMES);
  const [viewSeconds, setViewSeconds] = useState(60);
  const [locationsPerMatch, setLocationsPerMatch] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");

  const load = useCallback(async (value = secret) => {
    if (!value) return;
    try {
      setState(await adminFetch<AdminState>(value));
      setError("");
    } catch (cause) {
      setState(null);
      setError(cause instanceof Error ? cause.message : "Could not enter control room.");
    }
  }, [secret]);

  useEffect(() => {
    const initial = window.setTimeout(() => {
      const saved = sessionStorage.getItem(SECRET_KEY);
      if (saved) { setSecret(saved); setDraftSecret(saved); void load(saved); }
    }, 0);
    return () => window.clearTimeout(initial);
  }, [load]);

  useEffect(() => {
    if (!secret) return;
    const timer = window.setInterval(() => void load(secret), 10_000);
    return () => window.clearInterval(timer);
  }, [load, secret]);

  async function action(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return null;
    setBusy(true);
    try {
      const result = await adminFetch<Record<string, unknown>>(secret, { method: "POST", body: JSON.stringify(body) });
      await load();
      setError("");
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Admin action failed.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  function login() {
    sessionStorage.setItem(SECRET_KEY, draftSecret);
    setSecret(draftSecret);
    void load(draftSecret);
  }

  async function configure() {
    const players = names.split("\n").map((name) => name.trim()).filter(Boolean).map((name) => ({ name }));
    await action({ action: "configure", title, viewSeconds, locationsPerMatch, players }, `Replace the lobby roster with ${players.length} players?`);
  }

  async function validateLocations() {
    if (!state) return;
    let adminState = state;
    setBusy(true);
    setError("");
    try {
      // Seeding is an ignore-duplicates upsert, so running it every time is how new
      // candidates in the data file reach the pool.
      await adminFetch(secret, { method: "POST", body: JSON.stringify({ action: "seed-locations" }), headers: { "Content-Type": "application/json" } });
      const fresh = await adminFetch<AdminState>(secret);
      setState(fresh);
      adminState = fresh;
      const maps = await loadGoogleMaps();
      const service = new maps.StreetViewService();
      const pending = adminState.locations.filter((location) => !location.validatedAt);
      let active = adminState.activeLocationCount;
      for (let index = 0; index < pending.length; index += 1) {
        const location = pending[index];
        setProgress(`CHECKING ${index + 1}/${pending.length}: ${location.label}, ${location.country} — ${active} READY`);
        try {
          const response = await service.getPanorama({
            location: { lat: location.lat, lng: location.lng },
            radius: 2500,
            preference: maps.StreetViewPreference.NEAREST,
            sources: [maps.StreetViewSource.GOOGLE],
          });
          const panoLocation = response.data.location;
          const latLng = panoLocation?.latLng;
          const panoId = panoLocation?.pano;
          if (!latLng || !panoId) throw new Error("No panorama location returned.");
          const heading = Math.abs(Math.round((location.lat * 97 + location.lng * 53) * 10)) % 360;
          await saveValidation(location, { ok: true, panoId, lat: latLng.lat(), lng: latLng.lng(), heading });
          active += 1;
        } catch (cause) {
          await saveValidation(location, { ok: false, error: cause instanceof Error ? cause.message : "No Street View nearby." });
        }
      }
      setProgress(`DONE: ${active} WORLDWIDE LOCATIONS READY`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Validation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveValidation(location: LocationCandidate, result: Record<string, unknown>) {
    await adminFetch(secret, {
      method: "POST",
      body: JSON.stringify({ action: "validate-location", locationId: location.id, ...result }),
      headers: { "Content-Type": "application/json" },
    });
  }

  const allClaimed = useMemo(() => Boolean(state?.players.length && state.players.every((player) => player.claimed)), [state]);
  // Who the tournament is currently waiting on, and therefore who forfeiting would unblock.
  const forfeitable = useMemo(() => {
    if (state?.tournament?.status === "qualifier") {
      return new Set(state.players.map((player) => player.id).filter((id) => !state.qualifierSubmittedPlayerIds.includes(id)));
    }
    if (state?.tournament?.status === "tournament") {
      return new Set(state.matches.filter((match) => match.status !== "complete").flatMap((match) => [match.player1.id, match.player2.id]));
    }
    return new Set<string>();
  }, [state]);

  if (!state) {
    return (
      <main className="page-shell">
        <header className="hero"><h1>COMMISSIONER CONTROL ROOM</h1><p className="hero-subtitle">AUTHORIZED BOZOS ONLY</p></header>
        {error && <div className="error-box">{error}</div>}
        <section className="panel">
          <label className={styles.label}>ADMIN SECRET<input className={styles.input} type="password" value={draftSecret} onChange={(event) => setDraftSecret(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") login(); }} /></label>
          <div className="button-row"><button className="btn" onClick={login}>ENTER THE LAIR</button><Link className="btn btn-blue" href="/">ESCAPE</Link></div>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <header className="hero"><h1>COMMISSIONER CONTROL ROOM</h1><p className="hero-subtitle">WITH GREAT POWER COMES GREAT OPPORTUNITY TO BREAK STUFF</p></header>
      {error && <div className="error-box">🚨 {error}</div>}
      {progress && <div className="notice-box">{progress}</div>}

      {!state.tournament && (
        <section className="panel">
          <h2 className="panel-title">1. CONFIGURE THE LOBBY</h2>
          <label className={styles.label}>SEASON TITLE<input className={styles.input} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className={styles.label}>PLAYER NAMES — ONE PER LINE<textarea className={styles.textarea} value={names} onChange={(event) => setNames(event.target.value)} /></label>
          <div className={styles.settings}>
            <label className={styles.label}>VIEW SECONDS<input className={styles.input} type="number" min="15" max="300" value={viewSeconds} onChange={(event) => setViewSeconds(Number(event.target.value))} /></label>
            <label className={styles.label}>LOCATIONS / MATCH<input className={styles.input} type="number" min="1" max="5" value={locationsPerMatch} onChange={(event) => setLocationsPerMatch(Number(event.target.value))} /></label>
          </div>
          <button className="btn" disabled={busy} onClick={() => void configure()}>CREATE THIS BEAUTIFUL DISASTER</button>
        </section>
      )}

      {/* Outside the tournament gate on purpose — the vault has to be fillable before a
          lobby exists, and toppable up mid-season. */}
      <section className="panel">
        <h2 className="panel-title">LOCATION VAULT</h2>
        <p className="pixel-copy">{state.activeLocationCount} READY / {state.locations.length} CANDIDATES</p>
        <div className="notice-box">Validating checks every candidate that has not been checked yet. {state.activeLocationCount} ready covers a season of up to {rosterCapacity(state.activeLocationCount, state.tournament?.locationsPerMatch ?? locationsPerMatch)} players.</div>
        <div className="button-row"><button className="btn btn-blue" disabled={busy} onClick={() => void validateLocations()}>VALIDATE WORLDWIDE LOCATIONS</button></div>
      </section>

      {state.tournament && (
        <>
          <section className="panel panel-purple">
            <h2 className="panel-title">TOURNAMENT STATE: {state.tournament.status}</h2>
            <p className="pixel-copy">{state.players.length} PLAYERS • {state.expectedMatchCount} TOTAL MATCHES • {state.requiredLocationCount} UNIQUE LOCATIONS NEEDED</p>
            {state.tournament.status === "lobby" && <><div className="notice-box">{!allClaimed ? `${state.players.filter((player) => player.claimed).length} / ${state.players.length} players claimed — everybody must claim before starting.` : state.activeLocationCount < state.requiredLocationCount ? `${state.activeLocationCount} / ${state.requiredLocationCount} locations ready — validate more before starting.` : `READY TO START: all ${state.players.length} players claimed and ${state.activeLocationCount} locations validated.`}</div><div className="button-row"><button className="btn" disabled={busy || !allClaimed || state.activeLocationCount < state.requiredLocationCount} onClick={() => void action({ action: "start-tournament" }, "Randomize seeds and start? The bracket becomes real now.")}>START THE THUNDERDOME</button></div></>}
            {state.tournament.status === "tournament" && state.matches.every((match) => match.status === "ready") && <div className="button-row"><button className="btn btn-danger" disabled={busy} onClick={() => void action({ action: "regenerate-bracket" }, "Nobody has started. Reroll the bracket and all assigned locations?")}>REROLL UNPLAYED BRACKET</button></div>}
          </section>

          <section className="panel">
            <h2 className="panel-title">ROSTER REPAIR SHOP</h2>
            <div className={styles.adminList}>{state.players.map((player) => <div key={player.id}><span>{player.claimed ? "✓" : "○"} {player.name}{player.tournamentRank ? ` — RANK ${player.tournamentRank}` : ""}{state.qualifierSubmittedPlayerIds.includes(player.id) ? " — QUALIFIER LOCKED" : ""}</span><span className="button-row"><button className="btn btn-danger" disabled={busy || !player.claimed} onClick={() => void action({ action: "reset-claim", playerId: player.id }, `Reset ${player.name}'s browser claim?`)}>RESET CLAIM</button>{forfeitable.has(player.id) && <button className="btn btn-danger" disabled={busy} onClick={() => void action({ action: "forfeit-player", playerId: player.id }, `Forfeit ${player.name}? In the qualifier they get placed last. In a match their opponent advances.`)}>FORFEIT</button>}{state.tournament?.status === "qualifier" && state.qualifierSubmittedPlayerIds.includes(player.id) && <button className="btn btn-danger" disabled={busy} onClick={() => void action({ action: "reset-qualifier-attempt", playerId: player.id }, `Delete ${player.name}'s qualifier guess so they can replay it?`)}>RESET QUALIFIER</button>}</span></div>)}</div>
          </section>

          {state.matches.length > 0 && <section className="panel"><h2 className="panel-title">MATCH EMERGENCY LEVERS</h2><div className={styles.adminList}>{state.matches.map((match) => <div key={match.id}><span>{match.player1.name} VS {match.player2.name} — {match.status}</span><span className="button-row"><button className="btn btn-danger" disabled={busy || match.status === "complete"} onClick={() => void action({ action: "reset-attempt", matchId: match.id, playerId: match.player1.id }, `Reset ${match.player1.name}'s whole attempt in this match?`)}>RESET {match.player1.name}</button><button className="btn btn-danger" disabled={busy || match.status === "complete"} onClick={() => void action({ action: "reset-attempt", matchId: match.id, playerId: match.player2.id }, `Reset ${match.player2.name}'s whole attempt in this match?`)}>RESET {match.player2.name}</button>{match.status !== "complete" && [match.player1, match.player2].map((player) => <button className="btn btn-blue" key={player.id} disabled={busy} onClick={() => void action({ action: "override-winner", matchId: match.id, winnerId: player.id }, `Force ${player.name} to win?`)}>FORCE {player.name}</button>)}</span></div>)}</div></section>}

          {state.draftSelections.length > 0 && <section className="panel"><h2 className="panel-title">DRAFT QUEUE REPAIR SHOP</h2><div className={styles.adminList}>{state.draftSelections.map((selection) => <div key={selection.playerId}><span>#{selection.tournamentRank} {selection.playerName} — {selection.draftSlot ? `PICK ${selection.draftSlot}` : selection.status.toUpperCase()}</span><span className="button-row"><button className="btn btn-blue" disabled={busy || selection.status === "waiting"} onClick={() => { const value = window.prompt(`Assign which draft slot to ${selection.playerName}?`); if (value) void action({ action: "assign-draft", tournamentRank: selection.tournamentRank, draftSlot: Number(value) }, `Lock ${selection.playerName} into Pick ${value}? Later choices will be rewound if needed.`); }}>ASSIGN / REPLACE</button>{selection.status === "selected" && <button className="btn btn-danger" disabled={busy} onClick={() => void action({ action: "undo-draft", tournamentRank: selection.tournamentRank }, `Undo rank ${selection.tournamentRank} and every choice after it?`)}>UNDO FROM HERE</button>}</span></div>)}</div></section>}

          {state.locations.some((location) => location.validationError) && <section className="panel"><h2 className="panel-title">BAD LOCATION PILE</h2><div className={styles.adminList}>{state.locations.filter((location) => location.validationError).slice(0, 20).map((location) => <div key={location.id}><span>{location.label}, {location.country} — {location.validationError}</span><button className="btn btn-blue" disabled={busy} onClick={() => void action({ action: "reset-location", locationId: location.id })}>RETRY LATER</button></div>)}</div></section>}

          <section className="panel"><h2 className="panel-title">NUCLEAR OPTION</h2><p className="pixel-copy">Deletes the current tournament, players, matches, and picks. The validated worldwide location pool survives.</p><button className="btn btn-danger" disabled={busy} onClick={() => void action({ action: "reset-tournament" }, "DELETE THE ENTIRE CURRENT TOURNAMENT? This cannot be undone.")}>RESET THE WHOLE DAMN THING</button></section>
        </>
      )}
      <footer className={styles.footer}><Link href="/">← PUBLIC THUNDERDOME</Link><button onClick={() => { sessionStorage.removeItem(SECRET_KEY); setSecret(""); setState(null); }}>LOCK CONTROL ROOM</button></footer>
    </main>
  );
}
