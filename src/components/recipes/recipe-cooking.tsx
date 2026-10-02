"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  Pause,
  Play,
  RotateCcw,
  X,
} from "lucide-react";
import type { RecipeDetail } from "../../../shared/recipes";
import { scaleAmount } from "../../../shared/recipes";
import type { Locale } from "../translations";
import { useCookingWakeLock } from "./cooking-device";
import { api } from "../api";
import { cookingMessages } from "./cooking-messages";

type Timer = { remainingMs: number; endAt: number | null; started: boolean };
function remaining(timer: Timer, now: number) {
  return timer.endAt === null
    ? timer.remainingMs
    : Math.max(0, timer.endAt - now);
}
function countdown(milliseconds: number) {
  const seconds = Math.ceil(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const tail = String(seconds % 60).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${tail}`
    : `${minutes}:${tail}`;
}
export function RecipeCooking({
  recipe,
  portions,
  locale,
  onClose,
  device,
}: {
  recipe: RecipeDetail;
  portions: number;
  locale: Locale;
  onClose: () => void;
  device?: import("../../../shared/devices").DeviceData;
}) {
  const t = cookingMessages[locale];
  const durationFor = (index: number) =>
    device?.steps[index]?.enabled
      ? device.steps[index].durationSeconds
      : recipe.steps[index].durationSeconds;
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState(0);
  const [checkedIngredients, setCheckedIngredients] = useState<
    Record<number, boolean>
  >({});
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [note, setNote] = useState("");
  const [requestKey] = useState(
    () =>
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
  );
  const [keepAwake, setKeepAwake] = useState(true);
  const wake = useCookingWakeLock(keepAwake && !finished);
  const ownsFullscreen = useRef(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", update);
    return () => {
      document.removeEventListener("fullscreenchange", update);
    };
  }, []);
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        ownsFullscreen.current = false;
      } else if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
        ownsFullscreen.current = true;
      } else setFullscreenError(t.fullscreenUnavailable);
    } catch {
      setFullscreenError(t.fullscreenUnavailable);
    }
  }
  const [now, setNow] = useState(() => Date.now());
  const [timers, setTimers] = useState<Timer[]>(() =>
    recipe.steps.map((s, index) => ({
      remainingMs: (durationFor(index) ?? 0) * 1000,
      endAt: null,
      started: false,
    })),
  );
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 4 });
  useLayoutEffect(() => {
    const element = dialog.current!;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    return () => {
      if (ownsFullscreen.current && document.fullscreenElement)
        void document.exitFullscreen().catch(() => {});
      element.close();
      document.body.style.overflow = overflow;
    };
  }, []);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (
        timers.some(
          (timer) => timer.endAt !== null && remaining(timer, Date.now()) > 0,
        )
      )
        event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [timers]);
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);
  function hasRunningTimers() {
    return timers.some(
      (timer) => timer.endAt !== null && remaining(timer, Date.now()) > 0,
    );
  }
  function close() {
    if (saving) return;
    if (hasRunningTimers() && !window.confirm(t.exitConfirm)) return;
    onClose();
  }
  async function finish() {
    if (saving) return;
    if (hasRunningTimers() && !window.confirm(t.finishConfirm)) return;
    setSaving(true);
    setSaveError("");
    try {
      await api(`/recipes/${recipe.id}/cooking-history`, {
        servings: portions,
        note,
        requestKey,
      });
      const time = Date.now();
      setTimers((previous) =>
        previous.map((timer) => ({
          ...timer,
          remainingMs: remaining(timer, time),
          endAt: null,
        })),
      );
      setFinished(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t.saveFailed);
    } finally {
      setSaving(false);
    }
  }
  function changeTimer(action: "toggle" | "reset") {
    const time = Date.now();
    setNow(time);
    setTimers((previous) =>
      previous.map((timer, index) => {
        if (index !== step) return timer;
        if (action === "reset")
          return {
            remainingMs: (durationFor(index) ?? 0) * 1000,
            endAt: null,
            started: false,
          };
        const left = remaining(timer, time);
        return timer.endAt !== null
          ? { ...timer, remainingMs: left, endAt: null }
          : {
              remainingMs: left,
              endAt: left > 0 ? time + left : null,
              started: true,
            };
      }),
    );
  }
  const timer = timers[step];
  const left = remaining(timer, now);
  return createPortal(
    <dialog
      ref={dialog}
      className="cooking-mode"
      aria-label={t.mode}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="cooking-header">
        <div>
          <span className="eyebrow">{t.mode}</span>
          <h1>{recipe.title}</h1>
          <span className="muted">
            {portions} {t.servings}
          </span>
        </div>
        <button
          autoFocus
          className="icon-button"
          aria-label={t.close}
          onClick={close}
          disabled={saving}
        >
          <X size={24} />
        </button>
      </header>
      <div className="cooking-device-controls">
        <label className="ingredient-checkbox">
          <input
            type="checkbox"
            checked={keepAwake}
            disabled={wake === "unsupported" || finished}
            onChange={(event) => setKeepAwake(event.target.checked)}
          />
          {t.keepAwake}
        </label>
        <span className="small muted" role="status">
          {wake === "active"
            ? t.wakeActive
            : wake === "unsupported"
              ? t.wakeUnsupported
              : wake === "denied"
                ? t.wakeDenied
                : t.wakeInactive}
        </span>
        <button
          className="button secondary"
          onClick={() => void toggleFullscreen()}
        >
          {fullscreen ? t.exitFullscreen : t.fullscreen}
        </button>
        {fullscreenError && (
          <span className="small muted">{fullscreenError}</span>
        )}
      </div>
      {saveError && (
        <div className="error-box" role="alert">
          {saveError}
        </div>
      )}
      <progress
        aria-label={t.progress}
        max={recipe.steps.length}
        value={step + 1}
      />
      <div className="cooking-layout">
        <section className="cooking-step">
          {finished ? (
            <div className="cooking-completed">
              <Check size={48} />
              <h2>{t.completed}</h2>
              <button className="button primary" onClick={close}>
                {t.back}
              </button>
            </div>
          ) : (
            <>
              <span className="eyebrow">
                {t.step} {step + 1} {t.of} {recipe.steps.length}
              </span>
              <h2 tabIndex={-1} key={step} className="cooking-instruction">
                {recipe.steps[step].instruction}
              </h2>
              {device?.steps[step]?.enabled && (
                <div className="device-cooking-parameters">
                  <strong>Thermomix TM6</strong>
                  <span>{device.steps[step].durationSeconds} s</span>
                  {device.steps[step].temperature !== null && (
                    <span>
                      {device.steps[step].temperature}{" "}
                      {typeof device.steps[step].temperature === "number"
                        ? "°C"
                        : ""}
                    </span>
                  )}
                  {device.steps[step].speed !== null && (
                    <span>
                      {locale === "de" ? "Stufe" : "Speed"}{" "}
                      {device.steps[step].speed}
                    </span>
                  )}
                  {device.steps[step].reverse && (
                    <span>{locale === "de" ? "Linkslauf" : "Reverse"}</span>
                  )}
                  {device.steps[step].mode !== "MANUAL" && (
                    <span>
                      {device.steps[step].mode === "DOUGH"
                        ? locale === "de"
                          ? "Kneten"
                          : "Dough"
                        : "Turbo"}
                    </span>
                  )}
                </div>
              )}
              {Boolean(durationFor(step)) && (
                <div className="cooking-timer">
                  <span>
                    <Clock size={20} /> {t.timer}
                  </span>
                  <output role="timer" aria-live="off" aria-label={t.remaining}>
                    {countdown(left)}
                  </output>
                  {left === 0 && timer.started && <p role="status">{t.done}</p>}
                  <div className="cooking-timer-actions">
                    <button
                      className="button primary"
                      disabled={left === 0}
                      onClick={() => changeTimer("toggle")}
                    >
                      {timer.endAt !== null && left > 0 ? (
                        <Pause size={18} />
                      ) : (
                        <Play size={18} />
                      )}{" "}
                      {timer.endAt !== null && left > 0
                        ? t.pause
                        : timer.started
                          ? t.resume
                          : t.startTimer}
                    </button>
                    <button
                      className="icon-button"
                      aria-label={t.reset}
                      onClick={() => changeTimer("reset")}
                    >
                      <RotateCcw size={20} />
                    </button>
                  </div>
                </div>
              )}
              {step === recipe.steps.length - 1 && (
                <label>
                  {t.cookingNote}
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    maxLength={2000}
                    disabled={saving}
                  />
                </label>
              )}
              <nav className="cooking-controls" aria-label={t.mode}>
                <button
                  className="button secondary"
                  disabled={step === 0 || saving}
                  onClick={() => setStep(step - 1)}
                >
                  <ArrowLeft size={20} /> {t.previous}
                </button>
                <button
                  className="button primary"
                  disabled={saving}
                  onClick={() =>
                    step === recipe.steps.length - 1
                      ? finish()
                      : setStep(step + 1)
                  }
                >
                  {step === recipe.steps.length - 1 ? t.finish : t.next}{" "}
                  <ArrowRight size={20} />
                </button>
              </nav>
            </>
          )}
        </section>
        <aside className="cooking-ingredients" aria-label={t.ingredients}>
          <h2>{t.ingredients}</h2>
          <ul>
            {recipe.ingredients.map((ingredient, index) => {
              const references = recipe.steps[step].ingredientIndexes ?? [];
              if (references.length && !references.includes(index)) return null;
              const amount = scaleAmount(
                ingredient.amount,
                recipe.servings,
                portions,
              );
              const newGroup =
                ingredient.group &&
                (index === 0 ||
                  recipe.ingredients[index - 1].group !== ingredient.group);
              return (
                <li key={index}>
                  {newGroup && <h3>{ingredient.group}</h3>}
                  <label className="ingredient-checkbox">
                    <input
                      type="checkbox"
                      checked={Boolean(checkedIngredients[index])}
                      onChange={(event) =>
                        setCheckedIngredients((current) => ({
                          ...current,
                          [index]: event.target.checked,
                        }))
                      }
                      aria-label={`${ingredient.name} ${t.checked}`}
                    />
                    <span>
                      <strong>{ingredient.name}</strong>
                      {ingredient.note && <small>{ingredient.note}</small>}
                    </span>
                    <span className="cooking-amount">
                      {amount !== null ? number.format(Number(amount)) : ""}{" "}
                      {ingredient.unit}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {timers.some((timer) => timer.started) && !finished && (
            <div className="cooking-timers">
              <h2>{t.timers}</h2>
              {timers.map(
                (timer, index) =>
                  timer.started && (
                    <button
                      key={index}
                      className="cooking-timer-summary"
                      onClick={() => setStep(index)}
                    >
                      <span>
                        {t.step} {index + 1}
                      </span>
                      <strong>{countdown(remaining(timer, now))}</strong>
                      <span className="cooking-timer-status" aria-live="polite">
                        {remaining(timer, now) === 0
                          ? t.done
                          : timer.endAt === null
                            ? t.paused
                            : t.running}
                      </span>
                    </button>
                  ),
              )}
            </div>
          )}
        </aside>
      </div>
    </dialog>,
    document.body,
  );
}
