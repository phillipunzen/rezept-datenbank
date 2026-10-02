"use client";
import { useState } from "react";
import { ChefHat, Download } from "lucide-react";
import type { RecipeDetail } from "../../../shared/recipes";
import {
  deviceStepError,
  suggestedDeviceSteps,
  type DeviceStep,
} from "../../../shared/devices";
import type { Locale } from "../translations";
import { api } from "../api";
import { downloadJson } from "./recipe-tools";
export function RecipeDeviceEditor({
  recipe,
  locale,
  onRecipe,
  onBusy,
}: {
  recipe: RecipeDetail;
  locale: Locale;
  onRecipe: (recipe: RecipeDetail) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const de = locale === "de";
  const saved = recipe.deviceData.find(
    (data) => data.deviceKey === "thermomix-tm6",
  );
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [steps, setSteps] = useState<DeviceStep[]>(
    saved?.current ? saved.steps : suggestedDeviceSteps(recipe),
  );
  const [confirmed, setConfirmed] = useState(false);
  const update = (index: number, patch: Partial<DeviceStep>) => {
    setConfirmed(false);
    setSteps((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };
  async function run(work: () => Promise<void>) {
    setBusy(true);
    onBusy?.(true);
    setError("");
    try {
      await work();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Fehler");
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  }
  return (
    <section className="panel recipe-device-editor no-print">
      <h2>
        <ChefHat size={19} /> Thermomix TM6
      </h2>
      {saved && !saved.current && (
        <p className="technical-note">
          {de
            ? "Das Rezept wurde geändert. Geräteparameter müssen erneut geprüft werden."
            : "The recipe changed. Device parameters need to be reviewed again."}
        </p>
      )}
      <div className="detail-actions">
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => {
            setOpen(!open);
            setSteps(
              saved?.current ? saved.steps : suggestedDeviceSteps(recipe),
            );
            setConfirmed(false);
          }}
        >
          {de ? "Für Thermomix vorbereiten" : "Prepare for Thermomix"}
        </button>
        {saved?.current && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void run(async () =>
                downloadJson(
                  await api(
                    `/recipes/${recipe.id}/devices/thermomix-tm6/export`,
                  ),
                  `thermomix-${recipe.id}.json`,
                ),
              )
            }
          >
            <Download size={17} />
            {de ? "Geräteexport" : "Device export"}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {open && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              for (const step of steps) {
                const error = deviceStepError(step);
                if (error) throw new Error(error);
              }
              const result = await api<{ recipe: RecipeDetail }>(
                `/recipes/${recipe.id}/devices/thermomix-tm6`,
                { revision: recipe.revision, confirmed, steps },
                "PUT",
              );
              onRecipe(result.recipe);
              setOpen(false);
            });
          }}
        >
          <p className="muted">
            {de
              ? "Bekannte Zeiten werden übernommen. Aktiviere passende Schritte und trage geprüfte Einstellungen ein. Beachte die Geräteanleitung; Temperatur und Stufe werden beim Ändern der Portionen nicht automatisch angepasst."
              : "Known durations are copied. Enable suitable steps and enter reviewed settings. Follow the device manual; temperature and speed are not scaled with servings."}
          </p>
          {steps.map((step, index) => (
            <fieldset key={index} disabled={busy} className="device-step panel">
              <legend>
                {de ? "Schritt" : "Step"} {index + 1}
              </legend>
              <p>{recipe.steps[index].instruction}</p>
              <label className="ingredient-checkbox">
                <input
                  type="checkbox"
                  checked={step.enabled}
                  onChange={(event) =>
                    update(index, { enabled: event.target.checked })
                  }
                />
                {de ? "Auf dem Thermomix zubereiten" : "Prepare on Thermomix"}
              </label>
              {step.enabled && (
                <div className="planning-form-grid">
                  <label>
                    {de ? "Modus" : "Mode"}
                    <select
                      value={step.mode}
                      aria-label={`${de ? "Modus" : "Mode"} ${index + 1}`}
                      onChange={(event) =>
                        update(index, {
                          mode: event.target.value as DeviceStep["mode"],
                          temperature: null,
                          speed: null,
                          reverse: false,
                          durationSeconds:
                            event.target.value === "TURBO"
                              ? 1
                              : step.durationSeconds,
                        })
                      }
                    >
                      <option value="MANUAL">
                        {de ? "Manuell" : "Manual"}
                      </option>
                      <option value="DOUGH">{de ? "Kneten" : "Dough"}</option>
                      <option value="TURBO">Turbo</option>
                    </select>
                  </label>
                  <label>
                    {de ? "Zeit (Sekunden)" : "Time (seconds)"}
                    <input
                      type="number"
                      min={step.mode === "TURBO" ? 0.5 : 1}
                      max={step.mode === "TURBO" ? 2 : 5999}
                      step={step.mode === "TURBO" ? 0.5 : 1}
                      required
                      value={step.durationSeconds ?? ""}
                      onChange={(event) =>
                        update(index, {
                          durationSeconds:
                            event.target.value === ""
                              ? null
                              : Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  {step.mode === "MANUAL" && (
                    <>
                      <label>
                        {de ? "Temperatur" : "Temperature"}
                        <select
                          aria-label={`${de ? "Temperatur" : "Temperature"} ${index + 1}`}
                          value={step.temperature ?? ""}
                          onChange={(event) =>
                            update(index, {
                              temperature:
                                event.target.value === ""
                                  ? null
                                  : event.target.value === "VAROMA"
                                    ? "VAROMA"
                                    : Number(event.target.value),
                            })
                          }
                        >
                          <option value="">—</option>
                          {[
                            37,
                            ...Array.from({ length: 17 }, (_, i) => 40 + i * 5),
                          ].map((temp) => (
                            <option key={temp} value={temp}>
                              {temp} °C
                            </option>
                          ))}
                          <option value="VAROMA">Varoma</option>
                        </select>
                      </label>
                      <label>
                        {de ? "Stufe" : "Speed"}
                        <input
                          type="number"
                          min={0.5}
                          max={step.temperature !== null ? 6 : 10}
                          step={0.5}
                          required
                          value={step.speed ?? ""}
                          onChange={(event) =>
                            update(index, {
                              speed:
                                event.target.value === ""
                                  ? null
                                  : Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label className="ingredient-checkbox">
                        <input
                          type="checkbox"
                          checked={step.reverse}
                          onChange={(event) =>
                            update(index, { reverse: event.target.checked })
                          }
                        />
                        {de ? "Linkslauf" : "Reverse"}
                      </label>
                    </>
                  )}
                </div>
              )}
            </fieldset>
          ))}
          <label className="ingredient-checkbox">
            <input
              type="checkbox"
              required
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            {de
              ? "Ich habe alle Geräteeinstellungen geprüft und bestätige sie."
              : "I reviewed and confirm all device settings."}
          </label>
          <button className="button primary" disabled={busy || !confirmed}>
            {de ? "Bestätigt speichern" : "Save confirmed settings"}
          </button>
        </form>
      )}
    </section>
  );
}
