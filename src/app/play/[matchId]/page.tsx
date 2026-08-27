import GameClient from "@/components/GameClient";

export default async function PlayPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  return <GameClient matchId={matchId} />;
}
