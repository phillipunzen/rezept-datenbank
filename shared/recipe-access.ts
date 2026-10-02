export interface RecipeAccess {
  members: { userId: string; name: string; role: string }[];
  grants: { userId: string; permission: "VIEW" | "EDIT" }[];
}
