import ArchiveApp, { type ArchiveEntry } from "@/components/ArchiveApp";
import { getArchivedState, getArchivedTournaments } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function ArchivePage() {
  const tournaments = await getArchivedTournaments();
  const leagues: ArchiveEntry[] = await Promise.all(
    tournaments.map(async (tournament) => ({ ...tournament, state: await getArchivedState(tournament.id) })),
  );
  return <ArchiveApp leagues={leagues} />;
}
