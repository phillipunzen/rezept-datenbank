"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { RecipePage, RecipeSummary } from "../../../shared/recipes";
export function usePlanningResource<T>(path: string, initial: T) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => setGeneration((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    let sequence = 0;
    async function load() {
      const ticket = ++sequence;
      try {
        const result = await api<T>(path);
        if (active && ticket === sequence) {
          setData(result);
          setLoadError("");
        }
      } catch (error) {
        if (active && ticket === sequence)
          setLoadError(
            error instanceof Error
              ? error.message
              : "Verbindung fehlgeschlagen.",
          );
      } finally {
        if (active && ticket === sequence) setLoading(false);
      }
    }
    void load();
    const interval = window.setInterval(() => void load(), 10000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [path, generation]);
  async function run(work: () => Promise<unknown>) {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      await work();
      refresh();
      return true;
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Verbindung fehlgeschlagen.",
      );
      refresh();
      return false;
    } finally {
      setBusy(false);
    }
  }
  return {
    data,
    error: error || loadError,
    setError,
    loading,
    busy,
    refresh,
    run,
  };
}
export function useRecipeChoices(householdId: string) {
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    async function load() {
      const result: RecipeSummary[] = [];
      for (let page = 1; page <= 100; page++) {
        const batch = await api<RecipePage>(
          `/recipes?householdId=${encodeURIComponent(householdId)}&pageSize=48&page=${page}`,
        );
        result.push(...batch.recipes);
        if (result.length >= batch.total || !batch.recipes.length) break;
      }
      if (active) setRecipes(result);
    }
    void load().catch((error) => {
      if (active)
        setError(
          error instanceof Error ? error.message : "Verbindung fehlgeschlagen.",
        );
    });
    return () => {
      active = false;
    };
  }, [householdId]);
  return { recipes, error };
}
