import { PublicRecipeView } from "../../../components/public-recipe-view";
import { notFound } from "next/navigation";
import type { PublicRecipeResponse } from "../../../../shared/public-recipes";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Geteiltes Rezept · Rezeptdatenbank",
  robots: { index: false, follow: false },
};
export default async function PublicRecipePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token)) notFound();
  const response = await fetch(
    `http://127.0.0.1:3001/api/v1/public-recipes/${token}`,
    { cache: "no-store" },
  );
  if (response.status === 404 || response.status === 400) notFound();
  if (!response.ok) throw new Error("Rezept konnte nicht geladen werden.");
  const { recipe, schemaOrg } = (await response.json()) as PublicRecipeResponse;
  return <PublicRecipeView recipe={recipe} schemaOrg={schemaOrg} />;
}
