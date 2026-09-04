import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = Exclude<ThemePreference, "system">;

export const THEME_STORAGE_KEY = "wagesTracker.theme.preference.v1";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function readThemePreference(store: Pick<Storage, "getItem"> | null = storage()): ThemePreference {
  try {
    const saved = store?.getItem(THEME_STORAGE_KEY);
    return isThemePreference(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

export function writeThemePreference(
  preference: ThemePreference,
  store: Pick<Storage, "setItem"> | null = storage()
): void {
  try {
    store?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // A private/locked-down browser can deny localStorage. The in-memory
    // selection still applies for this session, so preference saving should
    // never make the appearance control itself fail.
  }
}

export function resolveTheme(preference: ThemePreference, systemIsDark: boolean): ResolvedTheme {
  return preference === "system" ? (systemIsDark ? "dark" : "light") : preference;
}

function systemIsDark(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia(DARK_QUERY).matches;
}

function initialResolvedTheme(preference: ThemePreference): ResolvedTheme {
  if (typeof document !== "undefined" && isThemePreference(document.documentElement.dataset.theme)) {
    const bootTheme = document.documentElement.dataset.theme;
    if (bootTheme !== "system") return bootTheme;
  }
  return resolveTheme(preference, systemIsDark());
}

export function applyThemeToDocument(preference: ThemePreference, dark = systemIsDark()): ResolvedTheme {
  const resolved = resolveTheme(preference, dark);
  if (typeof document === "undefined") return resolved;

  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolved;

  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  themeColor?.setAttribute("content", resolved === "dark" ? "#101114" : "#f6f4f3");
  return resolved;
}

interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const defaultThemeContext: ThemeContextValue = {
  preference: "system",
  resolvedTheme: "light",
  setPreference: () => {},
};

const ThemeContext = createContext<ThemeContextValue>(defaultThemeContext);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readThemePreference);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => initialResolvedTheme(preference));
  const transitionTimer = useRef<number | null>(null);

  const apply = useCallback((next: ThemePreference, animate: boolean) => {
    if (typeof document !== "undefined" && animate) {
      document.documentElement.classList.add("theme-transitioning");
      if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
      transitionTimer.current = window.setTimeout(() => {
        document.documentElement.classList.remove("theme-transitioning");
        transitionTimer.current = null;
      }, 220);
    }
    setResolvedTheme(applyThemeToDocument(next));
  }, []);

  // The tiny bootstrap in index.html applies this before CSS/React load. A
  // layout effect repeats the operation as the authoritative React state,
  // without an animated first paint or a light-to-dark flash.
  useLayoutEffect(() => {
    apply(preference, false);
  }, [apply, preference]);

  useEffect(() => {
    if (preference !== "system" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(DARK_QUERY);
    const followSystem = () => {
      document.documentElement.classList.add("theme-transitioning");
      setResolvedTheme(applyThemeToDocument("system", media.matches));
      if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
      transitionTimer.current = window.setTimeout(() => {
        document.documentElement.classList.remove("theme-transitioning");
        transitionTimer.current = null;
      }, 220);
    };
    if (typeof media.addEventListener === "function") media.addEventListener("change", followSystem);
    else media.addListener?.(followSystem);
    return () => {
      if (typeof media.removeEventListener === "function") media.removeEventListener("change", followSystem);
      else media.removeListener?.(followSystem);
    };
  }, [preference]);

  // Keep two open WagesTracker tabs/windows consistent. The browser only
  // fires `storage` in the other document, so this never double-applies the
  // local click that wrote the value.
  useEffect(() => {
    const followStoredPreference = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const next = isThemePreference(event.newValue) ? event.newValue : "system";
      setPreferenceState(next);
      apply(next, true);
    };
    window.addEventListener("storage", followStoredPreference);
    return () => window.removeEventListener("storage", followStoredPreference);
  }, [apply]);

  useEffect(() => () => {
    if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    writeThemePreference(next);
    setPreferenceState(next);
    apply(next, true);
  }, [apply]);

  const value = useMemo(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme, setPreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
