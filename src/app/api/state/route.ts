import { parseIdentity } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { getAppState } from "@/lib/repository";

export async function GET(request: Request) {
  try {
    const state = await getAppState(parseIdentity(request));
    return Response.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
