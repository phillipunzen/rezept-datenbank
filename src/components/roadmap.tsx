"use client";
import {
  CalendarDays,
  Check,
  ChefHat,
  Database,
  Import,
  Leaf,
  ShieldCheck,
  Users,
  UtensilsCrossed,
} from "lucide-react";
import { messages, type Locale } from "./translations";
export function Roadmap({ locale }: { locale: Locale }) {
  const t = messages[locale];
  const phases = [
    {
      number: "02",
      title: locale === "de" ? "Grundgerüst" : "Foundation",
      text: t.readyText,
      icon: ShieldCheck,
      done: true,
    },
    {
      number: "03",
      title: t.recipePhase,
      text: t.recipeText,
      icon: UtensilsCrossed,
      done: true,
    },
    {
      number: "04",
      title: t.sharingPhase,
      text: t.sharingText,
      icon: Users,
      done: true,
    },
    {
      number: "05",
      title: t.imports,
      text: t.importText,
      icon: Import,
      done: true,
    },
    {
      number: "06",
      title: t.planningPhase,
      text: t.planningText,
      icon: CalendarDays,
      done: true,
    },
    {
      number: "07",
      title: t.device,
      text: t.deviceText,
      icon: ChefHat,
      done: true,
    },
    {
      number: "08",
      title: t.qualityPhase,
      text: t.qualityText,
      icon: Leaf,
      done: true,
    },
  ];
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">{t.viewPlan}</span>
        <h1>{t.planTitle}</h1>
        <p>{t.planIntro}</p>
      </div>
      <div className="roadmap">
        {phases.map((phase) => (
          <article
            className={`roadmap-row ${phase.done ? "done" : ""}`}
            key={phase.number}
          >
            <span className="phase-number">
              {phase.done ? <Check size={21} /> : phase.number}
            </span>
            <phase.icon size={23} />
            <div>
              <h3>{phase.title}</h3>
              <p>{phase.text}</p>
            </div>
            <span className="planned-badge">
              {phase.done
                ? t.implemented
                : t.planned}
            </span>
          </article>
        ))}
      </div>
      <div className="technical-note">
        <Database size={22} />
        <p>{t.externalNotice}</p>
      </div>
    </>
  );
}
