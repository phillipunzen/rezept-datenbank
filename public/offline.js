/* Private data is encrypted in IndexedDB. Keys/passphrases never persist. */
"use strict";
const $ = (id) => document.getElementById(id),
  enc = new TextEncoder(),
  dec = new TextDecoder();
let key = null,
  salt = null,
  data = null,
  busy = false,
  de = true,
  onlineUser = null,
  chosenHousehold = "",
  choices = [],
  choicePage = 1,
  choiceTotal = 0,
  selectedIds = new Set(),
  generation = 0,
  shellReady = false;
const channel =
  typeof BroadcastChannel === "function"
    ? new BroadcastChannel("rezeptdatenbank-lock")
    : null;
const say = (g, e) => (de ? g : e);
function text(id, g, e) {
  $(id).textContent = say(g, e);
}
function feedback(g, e) {
  text("feedback", g, e);
}
function node(tag, value) {
  const n = document.createElement(tag);
  if (value !== undefined) n.textContent = String(value);
  return n;
}
async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("rezeptdatenbank-private-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("vault");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function stored(value, remove = false) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(
          "vault",
          value === undefined && !remove ? "readonly" : "readwrite",
        ),
        store = tx.objectStore("vault");
      const request = remove
        ? store.delete("current")
        : value === undefined
          ? store.get("current")
          : store.put(value, "current");
      let result;
      request.onsuccess = () => (result = request.result);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
async function derive(password, bytes) {
  const material = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: bytes, iterations: 310000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
async function persist() {
  if (!key || !data) return;
  const currentKey = key,
    currentGeneration = generation,
    iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    currentKey,
    enc.encode(JSON.stringify(data)),
  );
  if (currentGeneration !== generation)
    throw Error(say("Ansicht wurde gesperrt.", "View was locked."));
  await stored({ v: 1, salt, iv, cipher });
}
async function api(path, body, method) {
  const response = await fetch("/api/v1" + path, {
    method: method || (body ? "POST" : "GET"),
    credentials: "same-origin",
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) {
    const error = Error(result.message || "HTTP " + response.status);
    error.status = response.status;
    throw error;
  }
  return result;
}
function lock() {
  generation++;
  key = null;
  salt = null;
  data = null;
  onlineUser = null;
  choices = [];
  selectedIds.clear();
  $("query").value = "";
  $("passphrase").value = "";
  $("vault").hidden = true;
  $("gate").hidden = false;
  for (const id of [
    "recipes",
    "detail",
    "shopping",
    "plan",
    "choices",
    "conflicts",
  ])
    $(id).replaceChildren();
  $("detail").hidden = true;
  $("selection").hidden = true;
  feedback("Gesperrt.", "Locked.");
}
channel?.addEventListener("message", lock);
addEventListener("storage", (event) => {
  if (event.key === "rezeptdatenbank-lock") lock();
});
async function run(work) {
  if (busy) return;
  busy = true;
  for (const b of document.querySelectorAll("button")) b.disabled = true;
  const currentGeneration = generation;
  try {
    await work();
  } catch (error) {
    if (currentGeneration === generation)
      feedback(error.message, error.message);
  } finally {
    busy = false;
    for (const b of document.querySelectorAll("button")) b.disabled = false;
    for (const c of document.querySelectorAll("input[type=checkbox]"))
      c.disabled = false;
  }
}
function labels() {
  document.documentElement.lang = de ? "de" : "en";
  const labels = {
    title: ["Offline-Küche", "Offline kitchen"],
    intro: [
      "Rezepte, Wochenplan und Einkaufslisten verschlüsselt auf diesem Gerät speichern. Eine eigene Offline-Passphrase schützt die Daten.",
      "Keep encrypted recipes, this week and shopping lists on this device. A separate offline passphrase protects your data.",
    ],
    unlock: ["Entsperren / neu anlegen", "Unlock / create vault"],
    erase: ["Lokale Daten löschen", "Delete local data"],
    refresh: ["Online-Daten auswählen", "Choose online data"],
    sync: ["Änderungen synchronisieren", "Sync changes"],
    lock: ["Sperren", "Lock"],
    download: ["Auswahl offline speichern", "Save selection offline"],
    "pass-label": [
      "Offline-Passphrase (mindestens 12 Zeichen)",
      "Offline passphrase (at least 12 characters)",
    ],
    "household-label": ["Haushalt", "Household"],
    "search-label": ["Rezepte suchen", "Search recipes"],
    search: ["Suchen", "Search"],
    "previous-page": ["Vorherige Seite", "Previous page"],
    "next-page": ["Nächste Seite", "Next page"],
    "recipes-title": ["Rezepte", "Recipes"],
    "plan-title": ["Gespeicherter Wochenplan", "Saved weekly plan"],
    "shopping-title": ["Einkaufslisten", "Shopping lists"],
  };
  for (const [id, pair] of Object.entries(labels)) text(id, ...pair);
  $("language").textContent = de ? "English" : "Deutsch";
  if (shellReady)
    text(
      "availability",
      "Offline-Oberfläche bereit.",
      "Offline interface ready.",
    );
  if (data) render();
}
$("language").onclick = () => {
  de = !de;
  labels();
};
$("lock").onclick = lock;
$("erase").onclick = () =>
  void run(async () => {
    if (
      !confirm(
        say(
          "Alle lokalen Rezepte und ungesendeten Änderungen löschen?",
          "Delete all local recipes and unsent changes?",
        ),
      )
    )
      return;
    lock();
    await stored(undefined, true);
    feedback("Lokale Daten gelöscht.", "Local data deleted.");
  });
$("unlock").onclick = () =>
  void run(async () => {
    if (!isSecureContext || !crypto.subtle)
      throw Error(
        say(
          "Offline-Betrieb benötigt eine sichere Verbindung (HTTPS).",
          "Offline use requires a secure connection (HTTPS).",
        ),
      );
    const password = $("passphrase").value;
    if (password.length < 12)
      throw Error(
        say(
          "Mindestens 12 Zeichen erforderlich.",
          "At least 12 characters required.",
        ),
      );
    const currentGeneration = generation;
    const record = await stored();
    const bytes = record
      ? new Uint8Array(record.salt)
      : crypto.getRandomValues(new Uint8Array(16));
    const candidate = await derive(password, bytes);
    let content;
    if (record) {
      if (record.v !== 1) throw Error("Unsupported vault version");
      try {
        content = JSON.parse(
          dec.decode(
            await crypto.subtle.decrypt(
              { name: "AES-GCM", iv: record.iv },
              candidate,
              record.cipher,
            ),
          ),
        );
      } catch {
        throw Error(
          say(
            "Passphrase falsch oder Daten beschädigt.",
            "Incorrect passphrase or damaged data.",
          ),
        );
      }
    } else
      content = {
        version: 1,
        user: null,
        householdId: null,
        householdName: "",
        recipes: [],
        plan: [],
        lists: [],
        pending: [],
        savedAt: null,
      };
    if (currentGeneration !== generation) throw Error("Locked");
    key = candidate;
    salt = bytes;
    data = content;
    $("passphrase").value = "";
    $("gate").hidden = true;
    $("vault").hidden = false;
    render();
    feedback("Entsperrt.", "Unlocked.");
    if (!record) await choose();
  });
async function choose() {
  if (!key) throw Error("Locked");
  onlineUser = (await api("/auth/me")).user;
  if (data.user && data.user.id !== onlineUser.id)
    throw Error(
      say(
        "Bitte das ursprüngliche Konto anmelden.",
        "Sign in to the original account.",
      ),
    );
  if (
    data.pending.length &&
    !confirm(
      say(
        "Neue Auswahl ersetzt lokale Daten. Ungesendete Änderungen behalten? Erst synchronisieren und Auswahl abbrechen.",
        "New selection replaces local data. Keep unsent changes? Sync first and cancel selection.",
      ),
    )
  )
    return;
  if (data.pending.length)
    throw Error(
      say(
        "Bitte erst synchronisieren oder Änderungen bewusst verwerfen.",
        "Sync or explicitly discard pending changes first.",
      ),
    );
  const { households } = await api("/households");
  $("household").replaceChildren(
    ...households.map((m) => {
      const option = node("option", m.household.name);
      option.value = m.household.id;
      return option;
    }),
  );
  if (!households.length)
    throw Error(say("Kein Haushalt verfügbar.", "No household available."));
  chosenHousehold = households.some((m) => m.household.id === data.householdId)
    ? data.householdId
    : households[0].household.id;
  $("household").value = chosenHousehold;
  $("selection").hidden = false;
  choicePage = 1;
  selectedIds = new Set(
    data.householdId === chosenHousehold ? data.recipes.map((r) => r.id) : [],
  );
  $("query").value = "";
  await loadChoices(true);
}
async function loadChoices(initial = false) {
  const currentGeneration = generation,
    targetHousehold = chosenHousehold;
  const base =
    "/recipes?householdId=" +
    encodeURIComponent(chosenHousehold) +
    "&pageSize=48";
  const query = $("query").value.trim();
  const result = await api(
    base + "&page=" + choicePage + "&q=" + encodeURIComponent(query),
  );
  const favorites =
    initial && !query ? (await api(base + "&favorites=true")).recipes : [];
  if (
    currentGeneration !== generation ||
    !key ||
    targetHousehold !== chosenHousehold
  )
    return;
  choiceTotal = result.total;
  choices = [
    ...new Map(
      [...favorites, ...result.recipes].map((r) => [r.id, r]),
    ).values(),
  ];
  if (initial && !selectedIds.size)
    choices.slice(0, 30).forEach((r) => selectedIds.add(r.id));
  const count = () =>
    text(
      "selection-count",
      `${selectedIds.size} / 30 ausgewählt`,
      `${selectedIds.size} / 30 selected`,
    );
  $("choices").replaceChildren(
    ...choices.map((recipe) => {
      const label = node("label"),
        input = node("input");
      input.type = "checkbox";
      input.value = recipe.id;
      input.checked = selectedIds.has(recipe.id);
      input.onchange = () => {
        if (input.checked && selectedIds.size >= 30) {
          input.checked = false;
          feedback("Maximal 30 Rezepte auswählen.", "Select up to 30 recipes.");
        } else if (input.checked) selectedIds.add(recipe.id);
        else selectedIds.delete(recipe.id);
        count();
      };
      label.append(
        input,
        node("span", (recipe.favorite ? "★ " : "") + recipe.title),
      );
      return label;
    }),
  );
  count();
  feedback(
    "Favoriten werden bevorzugt. Suche und Seitenwechsel behalten deine Auswahl.",
    "Favorites are prioritized. Search and page changes keep your selection.",
  );
}
$("household").onchange = () =>
  void run(async () => {
    chosenHousehold = $("household").value;
    selectedIds.clear();
    choicePage = 1;
    $("query").value = "";
    await loadChoices(true);
  });
$("recipe-search").onsubmit = (event) => {
  event.preventDefault();
  void run(async () => {
    choicePage = 1;
    await loadChoices();
  });
};
$("previous-page").onclick = () =>
  void run(async () => {
    if (choicePage > 1) {
      choicePage--;
      await loadChoices();
    }
  });
$("next-page").onclick = () =>
  void run(async () => {
    if (choicePage * 48 < choiceTotal) {
      choicePage++;
      await loadChoices();
    }
  });

$("refresh").onclick = () => void run(choose);
function week() {
  const today = new Date(),
    start = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() - ((today.getDay() + 6) % 7),
    ),
    end = new Date(start);
  end.setDate(start.getDate() + 6);
  const date = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: date(start), to: date(end) };
}
$("download").onclick = () =>
  void run(async () => {
    if (!key) throw Error("Locked");
    const currentGeneration = generation,
      user = (await api("/auth/me")).user;
    if (user.id !== onlineUser?.id)
      throw Error(say("Konto wurde gewechselt.", "Account changed."));
    const selected = [...selectedIds];
    if (selected.length > 30)
      throw Error(
        say(
          "Maximal 30 Rezepte pro Offline-Paket.",
          "Maximum 30 recipes per offline package.",
        ),
      );
    if (data.pending.length)
      throw Error(
        say(
          "Erst ausstehende Änderungen klären.",
          "Resolve pending changes first.",
        ),
      );
    const recipes = [];
    let size = 0;
    for (const id of selected) {
      const recipe = (await api("/recipes/" + id)).recipe;
      const doc = await api("/recipes/" + id + "/export");
      size += JSON.stringify(doc).length;
      if (size > 32 * 1024 * 1024)
        throw Error(
          say(
            "Offline-Paket über 32 MiB. Weniger Bilder/Rezepte wählen.",
            "Offline package exceeds 32 MiB. Choose fewer images/recipes.",
          ),
        );
      recipes.push({ ...recipe, images: doc.images });
    }
    const dates = week(),
      plan = (
        await api(
          `/meal-plan?householdId=${chosenHousehold}&from=${dates.from}&to=${dates.to}`,
        )
      ).entries,
      lists = (await api("/shopping-lists?householdId=" + chosenHousehold))
        .lists;
    const after = (await api("/auth/me")).user;
    if (currentGeneration !== generation || after.id !== user.id)
      throw Error(say("Konto/Ansicht geändert.", "Account/view changed."));
    data = {
      version: 1,
      user: { id: user.id, name: user.name },
      householdId: chosenHousehold,
      householdName: $("household").selectedOptions[0].textContent,
      recipes,
      plan,
      lists,
      pending: [],
      savedAt: new Date().toISOString(),
    };
    await persist();
    $("selection").hidden = true;
    render();
    feedback(
      "Verschlüsselt auf diesem Gerät gespeichert.",
      "Stored encrypted on this device.",
    );
  });
function render() {
  if (!data) return;
  $("snapshot-info").textContent = data.savedAt
    ? `${data.user.name} · ${data.householdName} · ${new Date(data.savedAt).toLocaleString()} · ${data.pending.length} ${say("lokale Änderungen", "local changes")}`
    : say("Noch keine Daten gespeichert.", "No saved data yet.");
  $("recipes").replaceChildren(
    ...data.recipes.map((recipe) => {
      const button = node("button", recipe.title);
      button.onclick = () => showRecipe(recipe);
      return button;
    }),
  );
  $("plan").replaceChildren(
    ...data.plan.map((entry) =>
      node(
        "p",
        `${entry.date} · ${entry.slot} · ${entry.recipe?.title ?? say("Rezept", "Recipe")} · ${entry.servings} ${say("Portionen", "servings")}`,
      ),
    ),
  );
  $("shopping").replaceChildren(
    ...data.lists.map((list) => {
      const section = node("section");
      section.className = "list";
      section.append(node("h3", list.name));
      for (const item of list.items) {
        const label = node("label"),
          check = node("input");
        check.type = "checkbox";
        check.checked = item.checked;
        check.disabled = busy;
        check.onchange = () =>
          void run(async () => {
            const desired = check.checked,
              existing = data.pending.find(
                (change) =>
                  change.listId === list.id && change.itemId === item.id,
              );
            if (existing) existing.checked = desired;
            else
              data.pending.push({
                listId: list.id,
                itemId: item.id,
                revision: list.revision,
                checked: desired,
              });
            item.checked = desired;
            await persist();
            render();
          });
        label.append(
          check,
          node(
            "span",
            [item.amount, item.unit, item.name, item.note]
              .filter((v) => v !== null && v !== "")
              .join(" "),
          ),
        );
        section.append(label);
      }
      return section;
    }),
  );
}
function showRecipe(recipe) {
  const detail = $("detail");
  detail.hidden = false;
  detail.replaceChildren(node("h2", recipe.title));
  if (recipe.images[0]) {
    const image = node("img");
    image.src = recipe.images[0];
    image.alt = "";
    detail.append(image);
  }
  detail.append(node("p", recipe.description));
  const ingredients = node("ul");
  for (const i of recipe.ingredients)
    ingredients.append(
      node("li", [i.amount, i.unit, i.name, i.note].filter(Boolean).join(" ")),
    );
  detail.append(ingredients);
  const steps = node("ol");
  for (const step of recipe.steps) {
    const li = node("li", step.instruction);
    if (step.durationSeconds) {
      const start = node("button", say("Timer starten", "Start timer"));
      let deadline = 0;
      start.onclick = () => {
        deadline = Date.now() + step.durationSeconds * 1000;
        start.disabled = true;
      };
      const timer = node("span");
      let handle = setInterval(() => {
        if (!timer.isConnected) {
          clearInterval(handle);
          return;
        }
        if (deadline) {
          const remaining = Math.max(
            0,
            Math.ceil((deadline - Date.now()) / 1000),
          );
          timer.textContent = ` ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
          if (!remaining) {
            start.disabled = false;
            deadline = 0;
            timer.textContent = say(" Fertig", " Done");
          }
        }
      }, 500);
      li.append(node("br"), start, timer);
    }
    steps.append(li);
  }
  detail.append(steps);
  detail.scrollIntoView({ behavior: "smooth" });
}
$("sync").onclick = () => void run(sync);
async function sync() {
  if (!key || !data.user) throw Error("Locked");
  const user = (await api("/auth/me")).user;
  if (user.id !== data.user.id)
    throw Error(
      say(
        "Bitte das ursprüngliche Konto anmelden.",
        "Sign in to the original account.",
      ),
    );
  $("conflicts").replaceChildren();
  let remote = (await api("/shopping-lists?householdId=" + data.householdId))
    .lists;
  for (const listId of [
    ...new Set(data.pending.map((change) => change.listId)),
  ]) {
    const list = remote.find((list) => list.id === listId),
      changes = data.pending.filter((change) => change.listId === listId);
    if (!list) {
      conflict(listId, null, changes);
      continue;
    }
    if (list.revision !== changes[0].revision) {
      conflict(listId, list, changes);
      continue;
    }
    for (const change of changes) {
      try {
        await api(
          `/shopping-lists/${listId}/items/${change.itemId}`,
          { revision: list.revision, checked: change.checked },
          "PATCH",
        );
        list.revision++;
        const item = list.items.find((i) => i.id === change.itemId);
        if (item) item.checked = change.checked;
        data.pending = data.pending.filter((c) => c !== change);
        for (const c of data.pending.filter((c) => c.listId === listId))
          c.revision = list.revision;
        await persist();
      } catch (error) {
        if (error.status === 409) {
          const fresh = (
            await api("/shopping-lists?householdId=" + data.householdId)
          ).lists.find((l) => l.id === listId);
          conflict(
            listId,
            fresh,
            data.pending.filter((c) => c.listId === listId),
          );
          break;
        }
        throw error;
      }
    }
    if (!data.pending.some((c) => c.listId === listId)) {
      data.lists = data.lists.map((l) => (l.id === listId ? list : l));
      await persist();
    }
  }
  render();
  feedback(
    data.pending.length
      ? "Konflikte prüfen; lokale Änderungen bleiben gespeichert."
      : "Synchronisiert.",
    data.pending.length
      ? "Review conflicts; local changes are retained."
      : "Synced.",
  );
}
function conflict(listId, server, changes) {
  const section = node("section");
  section.className = "conflict";
  section.append(
    node(
      "h3",
      server?.name ??
        say("Liste nicht mehr verfügbar", "List no longer available"),
    ),
    node(
      "p",
      say(
        "Die Liste wurde online verändert. Prüfe die aktuellen Werte, bevor du lokale Häkchen erneut anwendest.",
        "The list changed online. Review current values before reapplying local checkmarks.",
      ),
    ),
  );
  for (const c of changes) {
    const item = server?.items.find((i) => i.id === c.itemId);
    section.append(
      node(
        "p",
        `${item?.name ?? say("Gelöschter Eintrag", "Deleted item")} · ${say("Online", "Online")}: ${item?.checked ?? "—"} · ${say("Lokal", "Local")}: ${c.checked}`,
      ),
    );
  }
  const useServer = node(
    "button",
    say("Online-Stand übernehmen", "Use server version"),
  );
  useServer.onclick = () =>
    void run(async () => {
      if (
        !confirm(
          say(
            "Lokale Änderungen für diese Liste verwerfen?",
            "Discard local changes for this list?",
          ),
        )
      )
        return;
      data.pending = data.pending.filter((c) => c.listId !== listId);
      data.lists = data.lists.filter((l) => l.id !== listId);
      if (server) data.lists.push(server);
      await persist();
      section.remove();
      render();
    });
  section.append(useServer);
  if (server) {
    const retry = node(
      "button",
      say("Lokale Häkchen bewusst erneut anwenden", "Reapply local checkmarks"),
    );
    retry.onclick = () =>
      void run(async () => {
        const fresh = (
          await api("/shopping-lists?householdId=" + data.householdId)
        ).lists.find((l) => l.id === listId);
        if (!fresh || fresh.revision !== server.revision)
          throw Error(
            say(
              "Stand erneut geändert. Noch einmal synchronisieren.",
              "Server changed again. Sync again.",
            ),
          );
        if (changes.some((c) => !fresh.items.some((i) => i.id === c.itemId)))
          throw Error(
            say(
              "Gelöschte Einträge können nicht wiederhergestellt werden. Online-Stand übernehmen.",
              "Deleted items cannot be restored. Use server version.",
            ),
          );
        if (
          !confirm(
            say(
              "Geprüfte lokale Häkchen auf den aktuellen Stand anwenden?",
              "Apply reviewed local checkmarks to the current version?",
            ),
          )
        )
          return;
        for (const c of data.pending.filter((c) => c.listId === listId))
          c.revision = server.revision;
        await persist();
        section.remove();
        await sync();
      });
    section.append(retry);
  }
  $("conflicts").append(section);
}
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 10 * 60000) lock();
});
labels();
if (!isSecureContext || !crypto.subtle) {
  feedback(
    "Offline-Speicherung ist über diese HTTP-Adresse nicht verfügbar. Mit HTTPS öffnen.",
    "Offline storage is unavailable at this HTTP address. Open with HTTPS.",
  );
  $("unlock").disabled = true;
} else if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/sw.js")
    .then(() => navigator.serviceWorker.ready)
    .then(() => {
      shellReady = true;
      labels();
    })
    .catch(() =>
      feedback(
        "Offline-Oberfläche konnte nicht gespeichert werden.",
        "Could not cache offline interface.",
      ),
    );
}
