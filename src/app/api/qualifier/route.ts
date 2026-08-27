import { parseIdentity } from "@/lib/auth";
import { errorResponse, HttpError, jsonBody, requiredNumber, requiredString } from "@/lib/http";
import { finishQualifierViewing, getQualifierPlayState, prepareQualifier, startQualifier, submitQualifierGuess } from "@/lib/repository";

export async function GET(request: Request) {
  try {
    return Response.json(await getQualifierPlayState(parseIdentity(request)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = parseIdentity(request);
    const body = await jsonBody(request);
    const action = requiredString(body, "action");
    if (action === "prepare") return Response.json(await prepareQualifier(identity));
    if (action === "start") return Response.json(await startQualifier(identity));
    if (action === "finish-viewing") return Response.json(await finishQualifierViewing(identity));
    if (action === "submit-guess") return Response.json(await submitQualifierGuess(identity, { lat: requiredNumber(body, "lat"), lng: requiredNumber(body, "lng") }));
    throw new HttpError(400, "Unknown qualifier action.");
  } catch (error) {
    return errorResponse(error);
  }
}
