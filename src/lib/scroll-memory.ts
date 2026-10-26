type ScrollSnapshot = { top: number; height: number };

const scrollPositions = new Map<string, ScrollSnapshot>();

export function scrollKey(pathname = window.location.pathname, search = window.location.search) {
  return pathname + search;
}

export function saveScrollPosition(key = scrollKey(), top = window.scrollY) {
  const snapshot = {
    top,
    height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
  };
  scrollPositions.set(key, snapshot);
  try {
    sessionStorage.setItem(`scroll:${key}`, JSON.stringify(snapshot));
  } catch {
    /* ignore */
  }
}

export function readScrollSnapshot(key = scrollKey()): ScrollSnapshot | null {
  const cached = scrollPositions.get(key);
  if (cached) return cached;
  try {
    const raw = sessionStorage.getItem(`scroll:${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ScrollSnapshot>;
    const top = Number(parsed.top);
    const height = Number(parsed.height);
    if (!Number.isFinite(top)) return null;
    return { top, height: Number.isFinite(height) ? height : 0 };
  } catch {
    return null;
  }
}

export function readScrollPosition(key = scrollKey()) {
  return readScrollSnapshot(key)?.top ?? null;
}
