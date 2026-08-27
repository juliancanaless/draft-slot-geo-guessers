import { parseIdentity } from "@/lib/auth";
import { errorResponse, HttpError, jsonBody, requiredNumber, requiredString } from "@/lib/http";
import {
  finishViewing,
  getPlayState,
  prepareChallenge,
  startChallenge,
  submitGuess,
} from "@/lib/repository";

type MatchContext = { params: Promise<{ matchId: string }> };

export async function GET(request: Request, context: MatchContext) {
  try {
    const { matchId } = await context.params;
    return Response.json(await getPlayState(matchId, parseIdentity(request)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: MatchContext) {
  try {
    const { matchId } = await context.params;
    const body = await jsonBody(request);
    const action = requiredString(body, "action");
    const identity = parseIdentity(request);
    if (action === "prepare") return Response.json(await prepareChallenge(matchId, identity));
    if (action === "start") return Response.json(await startChallenge(matchId, identity));
    if (action === "finish-viewing") return Response.json(await finishViewing(matchId, identity));
    if (action === "submit-guess") {
      return Response.json(
        await submitGuess(matchId, identity, {
          lat: requiredNumber(body, "lat"),
          lng: requiredNumber(body, "lng"),
        }),
      );
    }
    throw new HttpError(400, "Unknown gameplay action.");
  } catch (error) {
    return errorResponse(error);
  }
}
