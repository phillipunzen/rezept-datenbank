import { notFound } from "next/navigation";
import { PublicRecipeView } from "../../../components/public-recipe-view";
import type { PublicRecipeResponse } from "../../../../shared/public-recipes";
export const dynamic = "force-dynamic";
export const metadata = { title: "Öffentliches Rezept · Rezeptdatenbank" };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]{1,30}$/.test(id)) notFound();
  const response = await fetch(
    `http://127.0.0.1:3001/api/v1/catalog/recipes/${encodeURIComponent(id)}`,
    { cache: "no-store" },
  );
  if (response.status === 404 || response.status === 400) notFound();
  if (!response.ok) throw new Error("Rezept konnte nicht geladen werden.");
  const data: PublicRecipeResponse = await response.json();
  return <PublicRecipeView {...data} catalog />;
}
