const str = { type: "string" };
const int = { type: "integer" };
const object = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const array = (items: object) => ({ type: "array", items });
const reference = object({
  id: str,
  title: str,
  servings: int,
  visibility: { type: "string", enum: ["HOUSEHOLD", "PRIVATE"] },
  imageUrl: { type: ["string", "null"] },
});
const book = object({
  id: str,
  name: str,
  description: str,
  revision: int,
  recipes: array(reference),
});
const entry = object({
  id: str,
  date: str,
  slot: str,
  servings: int,
  revision: int,
  recipe: reference,
});
const item = object({
  id: str,
  name: str,
  amount: { type: ["string", "null"] },
  unit: str,
  note: str,
  checked: { type: "boolean" },
});
const list = object({ id: str, name: str, revision: int, items: array(item) });
const event = object({
  id: str,
  cookedAt: str,
  servings: int,
  note: str,
  recipe: reference,
});
const ok = object({ ok: { type: "boolean" } });
const createdBook = object({
  cookbook: object({ id: str, name: str, description: str, revision: int }),
});
const createdList = object({
  list: object({ id: str, name: str, revision: int }),
});
const createdEntry = object({
  entry: object({
    id: str,
    date: { type: "string", format: "date-time" },
    slot: str,
    servings: int,
    revision: int,
  }),
});
const createdEvent = object({
  event: object({
    id: str,
    cookedAt: { type: "string", format: "date-time" },
    servings: int,
    note: str,
  }),
});
export function planningResponse(
  method: string,
  path: string,
): object | undefined {
  const suffix = path.replace(/^\/api\/v1/, "");
  const roots = [
    "/cookbooks",
    "/meal-plan",
    "/shopping-lists",
    "/cooking-history",
  ];
  if (suffix === "/recipes/:id/cooking-history") return createdEvent;
  if (!roots.some((root) => suffix === root || suffix.startsWith(root + "/")))
    return;
  if (method === "GET")
    return (
      {
        "/cookbooks": object({ cookbooks: array(book) }),
        "/meal-plan": object({ entries: array(entry) }),
        "/shopping-lists": object({ lists: array(list) }),
        "/cooking-history": object({ events: array(event) }),
      } as Record<string, object>
    )[suffix];
  if (method === "POST") {
    const create = (
      {
        "/cookbooks": createdBook,
        "/shopping-lists": createdList,
        "/meal-plan": createdEntry,
      } as Record<string, object>
    )[suffix];
    if (create) return create;
  }
  return ok;
}
