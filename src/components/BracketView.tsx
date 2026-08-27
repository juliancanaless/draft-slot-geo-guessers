import type { MatchSummary } from "@/lib/types";
import styles from "./BracketView.module.css";

type BracketColumn = {
  key: string;
  phase: MatchSummary["phase"];
  roundNumber: number;
  matches: MatchSummary[];
};

function playerName(player: MatchSummary["player1"]) {
  return `${player.emoji ? `${player.emoji} ` : ""}${player.name}`;
}

function total(match: MatchSummary, playerId: string) {
  if (!match.results?.every((location) => location.guesses.some((guess) => guess.playerId === playerId))) return null;
  return match.results.reduce((sum, location) => (
    sum + (location.guesses.find((guess) => guess.playerId === playerId)?.distanceKm ?? 0)
  ), 0);
}

function columnTitle(column: BracketColumn, rankStart: number, rankEnd: number) {
  if (column.phase === "play_in") return "PLAY-IN ROUND";
  const groupSize = rankEnd - rankStart + 1;
  const targetSize = 2 ** Math.floor(Math.log2(groupSize));
  const totalKnockoutRounds = Math.log2(targetSize);
  const remaining = totalKnockoutRounds - column.roundNumber - 1;
  if (rankStart === 1) {
    if (remaining === 0) return "CHAMPIONSHIP";
    if (remaining === 1) return "SEMIFINALS";
    if (remaining === 2) return "QUARTERFINALS";
  }
  if (remaining === 0) return `${ordinal(rankStart)} PLACE MATCH`;
  if (remaining === 1) return "PLACEMENT SEMIFINALS";
  return `PLACEMENT ROUND ${column.roundNumber + 1}`;
}

function ordinal(value: number) {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${value}TH`;
  if (value % 10 === 1) return `${value}ST`;
  if (value % 10 === 2) return `${value}ND`;
  if (value % 10 === 3) return `${value}RD`;
  return `${value}TH`;
}

function MatchCard({ match, hasNextColumn }: { match: MatchSummary; hasNextColumn: boolean }) {
  const firstTotal = total(match, match.player1.id);
  const secondTotal = total(match, match.player2.id);
  const complete = match.status === "complete";
  const firstWon = match.winnerId === match.player1.id;
  const secondWon = match.winnerId === match.player2.id;
  return (
    <article className={`${styles.matchCard} ${complete ? styles.complete : ""}`}>
      <div className={`${styles.playerRow} ${firstWon ? styles.winner : ""}`}>
        <span>{firstWon ? "★ " : ""}{playerName(match.player1)}</span>
        <strong>{firstTotal === null ? "" : `${Math.round(firstTotal)} km`}</strong>
      </div>
      <div className={`${styles.playerRow} ${secondWon ? styles.winner : ""}`}>
        <span>{secondWon ? "★ " : ""}{playerName(match.player2)}</span>
        <strong>{secondTotal === null ? "" : `${Math.round(secondTotal)} km`}</strong>
      </div>
      <div className={styles.matchStatus}>{complete ? "FINAL" : match.status === "in_progress" ? "IN PROGRESS" : "READY"}</div>
      {hasNextColumn && <span className={styles.advanceArrow} aria-hidden="true">→</span>}
    </article>
  );
}

export default function BracketView({ matches, rosterSize, recap = false }: {
  matches: MatchSummary[];
  rosterSize: number;
  recap?: boolean;
}) {
  const groups = new Map<string, MatchSummary[]>();
  for (const match of matches) {
    const key = `${match.groupRankStart}-${match.groupRankEnd}`;
    groups.set(key, [...(groups.get(key) ?? []), match]);
  }
  const orderedGroups = [...groups.values()].sort((left, right) => {
    if (left[0].groupRankStart === 1) return -1;
    if (right[0].groupRankStart === 1) return 1;
    return left[0].groupRankStart - right[0].groupRankStart;
  });

  return (
    <section className="panel">
      <h2 className="panel-title">{recap ? "HOW THE GEOGRAPHICAL CARNAGE UNFOLDED" : "THE BRACKET OF QUESTIONABLE DESTINY"}</h2>
      <div className={styles.legend}>
        <span>WINNERS MOVE RIGHT <b>→</b></span>
        <span>LOSERS DROP INTO PLACEMENT BRACKETS <b>↓</b></span>
      </div>
      {orderedGroups.map((groupMatches) => {
        const first = groupMatches[0];
        const columnsByKey = new Map<string, BracketColumn>();
        for (const match of groupMatches) {
          const key = `${match.phase}-${match.roundNumber}`;
          const existing = columnsByKey.get(key);
          if (existing) existing.matches.push(match);
          else columnsByKey.set(key, { key, phase: match.phase, roundNumber: match.roundNumber, matches: [match] });
        }
        const columns = [...columnsByKey.values()].sort((left, right) => {
          if (left.phase !== right.phase) return left.phase === "play_in" ? -1 : 1;
          return left.roundNumber - right.roundNumber;
        });
        const main = first.groupRankStart === 1 && first.groupRankEnd === rosterSize;
        const placementDepth = main ? 0 : orderedGroups.filter((candidate) => {
          const parent = candidate[0];
          return parent.groupRankStart > 1
            && parent.groupRankStart <= first.groupRankStart
            && parent.groupRankEnd >= first.groupRankEnd
            && (parent.groupRankStart !== first.groupRankStart || parent.groupRankEnd !== first.groupRankEnd);
        }).length;
        return (
          <section className={`${styles.bracketGroup} ${main ? styles.mainGroup : styles.placementGroup}`} key={`${first.groupRankStart}-${first.groupRankEnd}`} style={{ "--placement-depth": placementDepth } as React.CSSProperties}>
            <header className={styles.groupHeader}>
              <strong>{main ? "🏆 MAIN CHAMPIONSHIP BRACKET" : groupMatches.length === 1 ? `↳ ${ordinal(first.groupRankStart)} PLACE DECIDER` : "↳ PLACEMENT PATH"}</strong>
              <span>FINAL RANKS {first.groupRankStart}–{first.groupRankEnd}</span>
            </header>
            <div className={styles.scrollHint}>← SWIPE TO SEE EVERY ROUND →</div>
            <div className={styles.bracketScroller}>
              <div className={styles.rounds}>
                {columns.map((column, columnIndex) => (
                  <section className={styles.roundColumn} key={column.key}>
                    <h3>{columnTitle(column, first.groupRankStart, first.groupRankEnd)}</h3>
                    <div className={styles.matchStack}>
                      {column.matches.sort((a, b) => a.matchIndex - b.matchIndex).map((match) => (
                        <MatchCard match={match} hasNextColumn={columnIndex < columns.length - 1} key={match.id} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </section>
        );
      })}
    </section>
  );
}
