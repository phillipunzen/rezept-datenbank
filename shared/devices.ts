import type { RecipeInput } from "./recipes";
export type ThermomixMode = "MANUAL" | "DOUGH" | "TURBO";
export interface DeviceStep {
  enabled: boolean;
  durationSeconds: number | null;
  temperature: number | "VAROMA" | null;
  speed: number | null;
  reverse: boolean;
  mode: ThermomixMode;
}
export interface DeviceData {
  deviceKey: "thermomix-tm6";
  contentHash: string;
  current: boolean;
  steps: DeviceStep[];
  confirmedAt: string;
}
export function deviceSignature(
  recipe: Pick<RecipeInput, "steps" | "ingredients" | "servings">,
) {
  return JSON.stringify({
    servings: recipe.servings,
    ingredients: recipe.ingredients,
    steps: recipe.steps.map((step) => ({
      instruction: step.instruction,
      durationSeconds: step.durationSeconds,
      ingredientIndexes: step.ingredientIndexes ?? [],
    })),
  });
}
export function suggestedDeviceSteps(
  recipe: Pick<RecipeInput, "steps">,
): DeviceStep[] {
  return recipe.steps.map((step) => ({
    enabled: false,
    durationSeconds:
      step.durationSeconds && step.durationSeconds <= 5999
        ? step.durationSeconds
        : null,
    temperature: null,
    speed: null,
    reverse: false,
    mode: "MANUAL",
  }));
}
export function deviceStepError(step: DeviceStep): string | null {
  if (!step.enabled) return null;
  if (
    step.durationSeconds === null ||
    !Number.isFinite(step.durationSeconds) ||
    step.durationSeconds <= 0 ||
    step.durationSeconds > 5999
  )
    return "Zeit muss zwischen 0,5 und 5999 Sekunden liegen.";
  if (step.mode === "TURBO") {
    if (
      ![0.5, 1, 2].includes(step.durationSeconds) ||
      step.temperature !== null ||
      step.speed !== null ||
      step.reverse
    )
      return "Turbo: 0,5/1/2 Sekunden, ohne Temperatur, Stufe oder Linkslauf.";
    return null;
  }
  if (!Number.isInteger(step.durationSeconds))
    return "Für diesen Modus sind ganze Sekunden erforderlich.";
  if (step.mode === "DOUGH")
    return step.temperature !== null || step.speed !== null || step.reverse
      ? "Kneten verwendet keine Temperatur, Stufe oder Linkslauf."
      : null;
  if (step.mode !== "MANUAL") return "Unbekannter Gerätemodus.";
  if (
    step.speed === null ||
    step.speed < 0.5 ||
    step.speed > 10 ||
    !Number.isInteger(step.speed * 2)
  )
    return "Stufe muss zwischen 0,5 und 10 in halben Schritten liegen.";
  if (
    step.temperature !== null &&
    step.temperature !== "VAROMA" &&
    !(
      step.temperature === 37 ||
      (step.temperature >= 40 &&
        step.temperature <= 120 &&
        step.temperature % 5 === 0)
    )
  )
    return "Temperatur: 37 °C oder 40–120 °C in 5-Grad-Schritten, alternativ Varoma.";
  if (step.temperature !== null && step.speed > 6)
    return "Heizschritte unterstützen hier höchstens Stufe 6.";
  return null;
}

export interface DeviceAdapter {
  key: string;
  label: string;
  suggest: (recipe: Pick<RecipeInput, "steps">) => DeviceStep[];
  validate: (step: DeviceStep) => string | null;
  signature: (
    recipe: Pick<RecipeInput, "steps" | "ingredients" | "servings">,
  ) => string;
}
export const thermomixTm6Adapter: DeviceAdapter = {
  key: "thermomix-tm6",
  label: "Thermomix TM6",
  suggest: suggestedDeviceSteps,
  validate: deviceStepError,
  signature: deviceSignature,
};
export const deviceAdapters: ReadonlyMap<string, DeviceAdapter> = new Map([
  [thermomixTm6Adapter.key, thermomixTm6Adapter],
]);
