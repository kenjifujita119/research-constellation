/** Storage inside the browser. It replaces the server's cache (apps/api/data in the original
 *  Python server, which is not included here).
 *
 *  Data used to be kept on the server for 30 days and shared by everyone. Now it is kept in each
 *  user's browser — reopening on the same device shows it without waiting, but it is not shared
 *  with anyone else. Everyone builds with their own OpenAlex free allowance, so there is no reason
 *  to share it either.
 *
 *  To keep working where nothing can be stored (private browsing, site data refused), a failed
 *  save is remembered for the life of this tab only. Reading everything again next time is better
 *  than stopping because a save failed. */

const DB_NAME = "research-shape";
const STORE = "graphs";
/** Anything older than this is read again, to pick up corrections made on OpenAlex's side */
export const TTL_DAYS = 30;

type Row = { key: string; version: number; savedAt: number; value: unknown };

const memory = new Map<string, Row>();
let opening: Promise<IDBDatabase | null> | null = null;

function database(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "key" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

async function run<T>(
  mode: IDBTransactionMode,
  act: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  const db = await database();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const req = act(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

/** Whether it is within the time limit and in a format the current code can read. Silently using
 *  an old format would leave the pages showing numbers built under the previous rules. */
function usable(row: Row | undefined, need: number): row is Row {
  if (!row || row.version < need) return false;
  return (Date.now() / 1000 - row.savedAt) / 86400 <= TTL_DAYS;
}

/** Reads a value. savedAt is in Unix seconds — the pages show it as "how old this data is". */
export async function load<T>(
  key: string,
  need: number,
): Promise<{ value: T; savedAt: number } | null> {
  const row = memory.get(key) ?? (await run<Row>("readonly", (s) => s.get(key)));
  if (!usable(row, need)) return null;
  memory.set(key, row);
  return { value: row.value as T, savedAt: row.savedAt };
}

/** Stores a value. Returns the time it was saved (Unix seconds). */
export async function save(key: string, version: number, value: unknown): Promise<number> {
  const row: Row = { key, version, savedAt: Date.now() / 1000, value };
  memory.set(key, row);
  await run("readwrite", (s) => s.put(row));
  return row.savedAt;
}

/** Replaces only the contents. When it was built (savedAt) stays the same — if checking a single
 *  candidate made it read "built just now", people would misjudge how old the data is. */
export async function update(key: string, value: unknown): Promise<void> {
  const row = memory.get(key) ?? (await run<Row>("readonly", (s) => s.get(key)));
  if (!row) return;
  const next: Row = { ...row, value };
  memory.set(key, next);
  await run("readwrite", (s) => s.put(next));
}

export async function drop(key: string): Promise<void> {
  memory.delete(key);
  await run("readwrite", (s) => s.delete(key));
}

/* ---------- "Not my paper" ---------- */

/** Papers the author has removed, per ORCID.
 *
 *  Kept in each user's browser. When this lived on the server, anyone could rewrite anyone else's
 *  list (there was no authentication). Now that door does not exist at all. The trade-off is that
 *  an exclusion only takes effect on that device — the permanent fix is a correction on OpenAlex's
 *  side, and the pages point people there first. */
const excludedKey = (orcid: string) => `excluded:${orcid}`;
const excludedMemory = new Map<string, string[]>();

export function loadExcluded(orcid: string): Set<string> {
  try {
    const raw = localStorage.getItem(excludedKey(orcid));
    if (raw) return new Set(((JSON.parse(raw).excluded ?? []) as unknown[]).map(String));
  } catch {
    // Storage can't be read here. Use what this tab remembers
  }
  return new Set(excludedMemory.get(orcid) ?? []);
}

export function saveExcluded(orcid: string, workIds: string[]): Set<string> {
  const excluded = [
    ...new Set(
      workIds
        .map((w) => w.trim())
        .filter(Boolean)
        .map((w) => w.slice(w.lastIndexOf("/") + 1)),
    ),
  ].sort();
  excludedMemory.set(orcid, excluded);
  try {
    localStorage.setItem(
      excludedKey(orcid),
      JSON.stringify({ excluded, updated: Math.floor(Date.now() / 1000) }),
    );
  } catch {
    // Storage can't be written here. This only lasts for the life of this tab
  }
  return new Set(excluded);
}
