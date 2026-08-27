export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error(error);
  return Response.json({ error: "The server got geographically confused." }, { status: 500 });
}

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Invalid request body.");
  }
}

export function requiredString(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `${key} is required.`);
  return value.trim();
}

export function requiredNumber(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new HttpError(400, `${key} must be a number.`);
  return value;
}
