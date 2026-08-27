import { adminAuthorized } from "@/lib/auth";
import { errorResponse, HttpError, jsonBody, requiredNumber, requiredString } from "@/lib/http";
import {
  configureTournament,
  assignDraftSlot,
  getAdminState,
  overrideMatchWinner,
  regenerateBracket,
  resetAttempt,
  resetPlayerClaim,
  resetLocationValidation,
  resetTournament,
  saveLocationValidation,
  seedLocationPool,
  startTournament,
  undoDraftSelection,
} from "@/lib/repository";

function authorize(request: Request) {
  if (!adminAuthorized(request)) throw new HttpError(401, "Wrong commissioner secret.");
}

export async function GET(request: Request) {
  try {
    authorize(request);
    return Response.json(await getAdminState(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    authorize(request);
    const body = await jsonBody(request);
    const action = requiredString(body, "action");
    if (action === "configure") {
      const players = body.players;
      if (!Array.isArray(players)) throw new HttpError(400, "players must be an array.");
      return Response.json(
        await configureTournament({
          title: requiredString(body, "title"),
          viewSeconds: requiredNumber(body, "viewSeconds"),
          locationsPerMatch: requiredNumber(body, "locationsPerMatch"),
          players: players.map((player) => {
            if (!player || typeof player !== "object") throw new HttpError(400, "Invalid player.");
            const value = player as Record<string, unknown>;
            return {
              name: requiredString(value, "name"),
              emoji: typeof value.emoji === "string" ? value.emoji : null,
            };
          }),
        }),
      );
    }
    if (action === "seed-locations") return Response.json(await seedLocationPool());
    if (action === "validate-location") {
      const ok = body.ok === true;
      return Response.json(
        await saveLocationValidation({
          locationId: requiredString(body, "locationId"),
          ok,
          panoId: typeof body.panoId === "string" ? body.panoId : undefined,
          lat: typeof body.lat === "number" ? body.lat : undefined,
          lng: typeof body.lng === "number" ? body.lng : undefined,
          heading: typeof body.heading === "number" ? body.heading : undefined,
          error: typeof body.error === "string" ? body.error : undefined,
        }),
      );
    }
    if (action === "start-tournament") return Response.json(await startTournament());
    if (action === "regenerate-bracket") return Response.json(await regenerateBracket());
    if (action === "reset-claim") {
      return Response.json(await resetPlayerClaim(requiredString(body, "playerId")));
    }
    if (action === "reset-attempt") {
      return Response.json(
        await resetAttempt(requiredString(body, "matchId"), requiredString(body, "playerId")),
      );
    }
    if (action === "override-winner") {
      return Response.json(
        await overrideMatchWinner(requiredString(body, "matchId"), requiredString(body, "winnerId")),
      );
    }
    if (action === "undo-draft") {
      return Response.json(await undoDraftSelection(requiredNumber(body, "tournamentRank")));
    }
    if (action === "assign-draft") {
      return Response.json(
        await assignDraftSlot(requiredNumber(body, "tournamentRank"), requiredNumber(body, "draftSlot")),
      );
    }
    if (action === "reset-location") {
      return Response.json(await resetLocationValidation(requiredString(body, "locationId")));
    }
    if (action === "reset-tournament") return Response.json(await resetTournament());
    throw new HttpError(400, "Unknown admin action.");
  } catch (error) {
    return errorResponse(error);
  }
}
