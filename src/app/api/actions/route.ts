import { parseIdentity } from "@/lib/auth";
import { errorResponse, HttpError, jsonBody, requiredNumber, requiredString } from "@/lib/http";
import { claimPlayer, selectDraftSlot } from "@/lib/repository";

export async function POST(request: Request) {
  try {
    const body = await jsonBody(request);
    const action = requiredString(body, "action");
    if (action === "claim-player") {
      return Response.json(await claimPlayer(requiredString(body, "playerId")));
    }
    if (action === "select-draft-slot") {
      return Response.json(
        await selectDraftSlot(parseIdentity(request), requiredNumber(body, "slot")),
      );
    }
    throw new HttpError(400, "Unknown action.");
  } catch (error) {
    return errorResponse(error);
  }
}
