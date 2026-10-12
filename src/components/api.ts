export interface User {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  locale: string;
}
export interface System {
  version: string;
  setupRequired: boolean;
  registrationEnabled: boolean;
  publicCatalogEnabled: boolean;
}
export interface Membership {
  role: string;
  household: { id: string; name: string };
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  body?: object,
  method?: string,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: method ?? (body ? "POST" : "GET"),
    credentials: "same-origin",
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof result === "object" && result && "message" in result
        ? String(result.message)
        : `HTTP ${response.status}`;
    throw new ApiError(message, response.status);
  }
  return result as T;
}
