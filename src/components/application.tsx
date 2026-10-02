"use client";
import { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  CalendarDays,
  ClipboardList,
  Clock,
  Grid2x2,
  CookingPot,
  Home,
  Import,
  LayoutDashboard,
  LogOut,
  Settings,
  UtensilsCrossed,
  Users,
} from "lucide-react";
import { api, ApiError, type Membership, type System, type User } from "./api";
import { AuthForm } from "./auth-form";
import { PasswordReset } from "./account-options";
import { Profile } from "./profile";
import { Dashboard } from "./dashboard";
import { Roadmap } from "./roadmap";
import { RecipeWorkspace } from "./recipes/recipe-workspace";
import { recipeMessages } from "./recipes/messages";
import { HouseholdManager } from "./households/household-manager";
import { InvitationLanding } from "./households/invitation-landing";
import { householdMessages } from "./households/messages";
import { AppearancePicker, useAppearance } from "./theme";
import { ImportManager } from "./imports/import-manager";
import { CookbookManager } from "./planning/cookbook-manager";
import { ShoppingManager } from "./planning/shopping-manager";
import { MealPlanner } from "./planning/meal-planner";
import { CookingHistory } from "./planning/cooking-history";
import { planningMessages } from "./planning/messages";
import { messages, type Locale } from "./translations";
type View =
  | "dashboard"
  | "roadmap"
  | "settings"
  | "recipes"
  | "households"
  | "books"
  | "planner"
  | "shopping"
  | "history"
  | "menu"
  | "import";
export function Application() {
  const [system, setSystem] = useState<System | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [locale, setLocale] = useState<Locale>("de");
  const [view, setView] = useState<View>("recipes");
  const [recipeGeneration, setRecipeGeneration] = useState(0);
  const [passwordReset, setPasswordReset] = useState(false);
  const [openRecipeId, setOpenRecipeId] = useState<string | undefined>();
  const [recipeDirty, setRecipeDirty] = useState(false);
  const [householdId, setHouseholdId] = useState("");
  const [membershipsRefresh, setMembershipsRefresh] = useState(0);
  const [invitationToken, setInvitationToken] = useState<string | null>(null);
  const appearance = useAppearance();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [databaseReady, setDatabaseReady] = useState(false);
  const t = messages[locale];
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const status = await api<System>("/system");
      setSystem(status);
      try {
        const session = await api<{ user: User }>("/auth/me");
        setUser(session.user);
        setLocale(session.user.locale === "en" ? "en" : "de");
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) setUser(null);
        else throw error;
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Verbindung fehlgeschlagen",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get(
      "invite",
    );
    if (token) setInvitationToken(token.slice(0, 256));
    if (new URLSearchParams(location.hash.slice(1)).has("reset"))
      setPasswordReset(true);
    if (new URLSearchParams(location.hash.slice(1)).has("authError")) {
      setError(
        "SSO-Anmeldung fehlgeschlagen. Bestehendes Konto zunächst lokal anmelden und in den Einstellungen verknüpfen.",
      );
      history.replaceState(null, "", location.pathname);
    }
    void load();
    if ("serviceWorker" in navigator && window.isSecureContext)
      void navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, [load]);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => {
    if (!user) return;
    let active = true;
    api<{ households: Membership[] }>("/households")
      .then((data) => {
        if (active) {
          setMemberships(data.households);
          setHouseholdId((previous) =>
            data.households.some((member) => member.household.id === previous)
              ? previous
              : (data.households[0]?.household.id ?? ""),
          );
        }
      })
      .catch((error) => {
        if (active)
          setError(
            error instanceof Error
              ? error.message
              : "Verbindung fehlgeschlagen",
          );
      });
    const check = () =>
      api("/health/ready")
        .then(() => {
          if (active) setDatabaseReady(true);
        })
        .catch(() => {
          if (active) setDatabaseReady(false);
        });
    void check();
    const interval = setInterval(() => {
      void check();
    }, 30000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [user, membershipsRefresh]);
  function membershipsChanged(preferred?: string) {
    if (preferred !== undefined) setHouseholdId(preferred);
    setMembershipsRefresh((value) => value + 1);
  }
  function selectHousehold(id: string) {
    if (recipeDirty && !window.confirm(recipeMessages[locale].discard)) return;
    setRecipeDirty(false);
    setOpenRecipeId(undefined);
    setHouseholdId(id);
  }
  function closeInvitation() {
    setInvitationToken(null);
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
  }
  function navigate(next: View) {
    if (recipeDirty && !window.confirm(recipeMessages[locale].discard)) return;
    setRecipeDirty(false);
    if (next === "recipes") {
      setOpenRecipeId(undefined);
      setRecipeGeneration((value) => value + 1);
    }
    setView(next);
    window.scrollTo({ top: 0 });
  }
  function onUser(next: User) {
    if (
      (!user || user.id !== next.id) &&
      typeof BroadcastChannel !== "undefined"
    ) {
      const channel = new BroadcastChannel("rezeptdatenbank-lock");
      channel.postMessage("lock");
      channel.close();
    }
    setUser(next);
    setLocale(next.locale === "en" ? "en" : "de");
    setSystem((previous) =>
      previous ? { ...previous, setupRequired: false } : previous,
    );
  }
  async function logout() {
    if (recipeDirty && !window.confirm(recipeMessages[locale].discard)) return;
    try {
      await api("/auth/logout", {});
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel("rezeptdatenbank-lock");
        channel.postMessage("lock");
        channel.close();
      }
      try {
        localStorage.setItem("rezeptdatenbank-lock", String(Date.now()));
      } catch {}
      setUser(null);
      setMemberships([]);
      setHouseholdId("");
      setRecipeDirty(false);
      setView("recipes");
      setError("");
    } catch {
      setError(t.logoutError);
    }
  }
  if (loading || !system)
    return (
      <div className="loading-screen">
        <CookingPot size={42} />
        <h2>{loading ? t.loading : t.unavailable}</h2>
        {!loading && (
          <>
            <p className="muted">{error}</p>
            <button
              className="button primary"
              onClick={() => {
                void load();
              }}
            >
              {t.retry}
            </button>
          </>
        )}
      </div>
    );
  if (invitationToken)
    return (
      <InvitationLanding
        token={invitationToken}
        user={user}
        locale={locale}
        onUser={(next) => {
          if (next) onUser(next);
          else {
            setUser(null);
            setMemberships([]);
            setHouseholdId("");
          }
        }}
        onAccepted={(next, id) => {
          onUser(next);
          membershipsChanged(id);
          closeInvitation();
          setView("households");
        }}
        onCancel={closeInvitation}
      />
    );
  if (passwordReset)
    return (
      <PasswordReset
        locale={locale}
        onDone={() => {
          setPasswordReset(false);
          void load();
        }}
      />
    );
  if (!user)
    return (
      <AuthForm
        system={system}
        externalError={error}
        locale={locale}
        setLocale={setLocale}
        onUser={onUser}
      />
    );
  function openRecipe(id: string) {
    setOpenRecipeId(id);
    setView("recipes");
    window.scrollTo({ top: 0 });
  }
  const canEdit =
    memberships.find((member) => member.household.id === householdId)?.role !==
    "VIEWER";
  const p = planningMessages[locale];
  const navigation = [
    { label: t.dashboard, icon: LayoutDashboard, target: "dashboard" as View },
    {
      label: t.recipes,
      icon: UtensilsCrossed,
      target: "recipes" as View,
    },
    {
      label: householdMessages[locale].title,
      icon: Users,
      target: "households" as View,
    },
    { label: "Import", icon: Import, target: "import" as View },
    { label: t.books, icon: BookOpen, target: "books" as View },
    { label: t.planner, icon: CalendarDays, target: "planner" as View },
    { label: t.shopping, icon: ClipboardList, target: "shopping" as View },
    { label: p.history, icon: Clock, target: "history" as View },
    { label: t.viewPlan, icon: Grid2x2, target: "roadmap" as View },
  ];
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <CookingPot size={23} />
          </span>
          rezepte<span className="brand-dot">.</span>
        </div>
        <div className="household-selector">
          <span className="household-icon">
            <Home size={19} />
          </span>
          <div>
            <small>{t.household}</small>
            {memberships.length > 1 ? (
              <select
                aria-label={recipeMessages[locale].household}
                value={householdId}
                onChange={(event) => selectHousehold(event.target.value)}
              >
                {memberships.map((member) => (
                  <option key={member.household.id} value={member.household.id}>
                    {member.household.name}
                  </option>
                ))}
              </select>
            ) : (
              <strong>{memberships[0]?.household.name ?? t.noHousehold}</strong>
            )}
          </div>
        </div>
        <div className="nav-label">{t.library}</div>
        <nav aria-label="Navigation">
          {navigation.map((item) => (
            <button
              key={item.label}
              className={`nav-item ${view === item.target ? "active" : ""}`}
              onClick={() => navigate(item.target)}
            >
              <item.icon size={20} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${view === "settings" ? "active" : ""}`}
            onClick={() => navigate("settings")}
          >
            <Settings size={19} />
            {t.settings}
          </button>
          <div className="sidebar-version">
            <span className="status-pill">
              <i />
              {t.development}
            </span>
            <small>v{system.version}</small>
          </div>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <span>
              {memberships.find((member) => member.household.id === householdId)
                ?.household.name ?? t.household}
            </span>
            <span>/</span>
            <strong>
              {view === "settings"
                ? t.settings
                : view === "menu"
                  ? locale === "de"
                    ? "Mehr"
                    : "More"
                  : (navigation.find((entry) => entry.target === view)?.label ??
                    t.recipes)}
            </strong>
          </div>
          <div className="topbar-actions">
            <AppearancePicker
              preference={appearance.preference}
              onChange={appearance.choose}
              locale={locale}
              compact
            />
            <button
              className="user-button"
              onClick={() => navigate("settings")}
            >
              <span className="avatar">
                {user.name.slice(0, 1).toUpperCase()}
              </span>
              <span>{user.name}</span>
            </button>
            <button
              className="icon-button"
              aria-label={t.signout}
              onClick={() => {
                void logout();
              }}
            >
              <LogOut size={19} />
            </button>
          </div>
        </header>
        <main className="content">
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
          {view === "dashboard" && (
            <Dashboard
              onRecipe={openRecipe}
              showPlanner={() => navigate("planner")}
              showShopping={() => navigate("shopping")}
              user={user}
              memberships={memberships}
              locale={locale}
              databaseReady={databaseReady}
              showRoadmap={() => navigate("roadmap")}
              showRecipes={() => navigate("recipes")}
              householdId={householdId}
            />
          )}
          {view === "import" && householdId && (
            <ImportManager
              key={householdId}
              householdId={householdId}
              locale={locale}
              canEdit={canEdit}
              onRecipe={openRecipe}
            />
          )}
          {view === "recipes" && householdId && (
            <RecipeWorkspace
              key={`${householdId}-${recipeGeneration}-${openRecipeId ?? "list"}`}
              initialRecipeId={openRecipeId}
              householdId={householdId}
              locale={locale}
              canEdit={
                memberships.find(
                  (member) => member.household.id === householdId,
                )?.role !== "VIEWER"
              }
              onDirty={setRecipeDirty}
            />
          )}
          {view === "recipes" && !householdId && (
            <section className="panel household-create">
              <p>{householdMessages[locale].noHousehold}</p>
              <button
                className="button primary"
                onClick={() => navigate("households")}
              >
                {householdMessages[locale].create}
              </button>
            </section>
          )}
          {view === "households" && (
            <HouseholdManager
              memberships={memberships}
              householdId={householdId}
              userId={user.id}
              locale={locale}
              onSelect={selectHousehold}
              onChanged={membershipsChanged}
            />
          )}
          {view === "books" && householdId && (
            <CookbookManager
              key={householdId}
              householdId={householdId}
              locale={locale}
              canEdit={canEdit}
              onRecipe={openRecipe}
            />
          )}
          {view === "planner" && householdId && (
            <MealPlanner
              key={householdId}
              householdId={householdId}
              locale={locale}
              canEdit={canEdit}
              onRecipe={openRecipe}
            />
          )}
          {view === "shopping" && householdId && (
            <ShoppingManager
              key={householdId}
              householdId={householdId}
              locale={locale}
              canEdit={canEdit}
            />
          )}
          {view === "history" && householdId && (
            <CookingHistory
              key={householdId}
              householdId={householdId}
              locale={locale}
              onRecipe={openRecipe}
            />
          )}
          {view === "menu" && (
            <>
              <div className="page-heading">
                <h1>{locale === "de" ? "Mehr" : "More"}</h1>
              </div>
              <nav className="more-menu">
                {[
                  ...navigation,
                  {
                    label: t.settings,
                    icon: Settings,
                    target: "settings" as View,
                  },
                ].map((entry) => (
                  <button
                    key={entry.target}
                    className="panel"
                    onClick={() => navigate(entry.target)}
                  >
                    <entry.icon size={24} />
                    <span>{entry.label}</span>
                  </button>
                ))}
              </nav>
            </>
          )}
          {view === "roadmap" && <Roadmap locale={locale} />}
          {view === "settings" && (
            <Profile
              user={user}
              locale={locale}
              onUser={onUser}
              appearance={appearance.preference}
              onAppearance={appearance.choose}
            />
          )}
          <footer className="main-footer">
            <span>
              rezepte<span className="brand-dot">.</span>{" "}
              <span className="footer-separator">/</span> {t.tagline}
            </span>
            <a href="/api/v1/docs" target="_blank" rel="noreferrer">
              {t.docs} ↗
            </a>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Mobile Navigation">
        {[
          {
            label: t.dashboard,
            icon: LayoutDashboard,
            target: "dashboard" as View,
          },
          {
            label: t.recipes,
            icon: UtensilsCrossed,
            target: "recipes" as View,
          },
          { label: t.planner, icon: CalendarDays, target: "planner" as View },
          {
            label: t.shopping,
            icon: ClipboardList,
            target: "shopping" as View,
          },
          {
            label: locale === "de" ? "Mehr" : "More",
            icon: Grid2x2,
            target: "menu" as View,
          },
        ].map((entry) => (
          <button
            key={entry.target}
            className={view === entry.target ? "active" : ""}
            onClick={() => navigate(entry.target)}
          >
            <entry.icon size={21} />
            {entry.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
