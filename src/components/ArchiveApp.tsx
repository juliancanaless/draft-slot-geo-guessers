"use client";

import Link from "next/link";
import type { AppState } from "@/lib/types";
import BracketView from "./BracketView";
import { FinalBoard, QualifierResults, RankingBoard, ResultsVault } from "./HomeApp";

export type ArchiveEntry = { id: string; title: string; playedAt: string; state: AppState };

export default function ArchiveApp({ leagues }: { leagues: ArchiveEntry[] }) {
  return (
    <main className="page-shell">
      <header className="hero">
        <h1>THE ARCHIVE</h1>
        <p className="hero-subtitle">EVERY LEAGUE THAT ALREADY GOT COOKED</p>
      </header>
      <div className="button-row"><Link className="btn" href="/">← BACK TO THE LIVE LEAGUE</Link></div>
      {!leagues.length && (
        <section className="panel">
          <h2 className="panel-title">NOTHING IN HERE YET</h2>
          <p className="pixel-copy">A league lands here once its draft is done.</p>
        </section>
      )}
      {leagues.map((league) => (
        <section key={league.id}>
          <h2 className="panel-title">{league.title}</h2>
          <FinalBoard state={league.state} />
          <QualifierResults state={league.state} />
          <RankingBoard state={league.state} />
          <BracketView matches={league.state.matches} rosterSize={league.state.players.length} recap />
          <ResultsVault matches={league.state.matches.filter((match) => match.status === "complete").reverse()} />
        </section>
      ))}
    </main>
  );
}
