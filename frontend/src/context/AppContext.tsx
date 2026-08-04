import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { addDays, isoDate, startOfWeek } from "../lib/date";
import type { Shift, User } from "../lib/types";

export const RETENTION_YEARS = 3;
export const CURRENCY = "$";

type Status = "loading" | "loggedOut" | "loggedIn";

interface AppContextValue {
  status: Status;
  user: User | null;
  authError: string | null;
  authBusy: boolean;
  actionError: string | null;
  clearActionError: () => void;
  login: (email: string, password: string) => Promise<void>;
  signup: (input: api.SignupInput) => Promise<void>;
  logout: () => void;
  clearAuthError: () => void;
  updateSettings: (patch: api.MePatch) => Promise<void>;

  today: Date;
  shifts: Shift[];
  shiftsLoading: boolean;
  createShift: (input: api.ShiftInput) => Promise<Shift | undefined>;
  updateShift: (id: string, patch: Partial<api.ShiftInput>) => Promise<Shift | undefined>;
  removeShift: (id: string) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [shiftsLoading, setShiftsLoading] = useState(false);
  const [today, setToday] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setToday(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const token = api.getToken();
    if (!token) {
      setStatus("loggedOut");
      return;
    }
    api
      .fetchMe()
      .then(({ user }) => {
        setUser(user);
        setStatus("loggedIn");
      })
      .catch((e) => {
        // Only drop the session on an actual auth failure. A network blip or a
        // momentarily-unreachable backend shouldn't force the user to log back in.
        if (e instanceof ApiError && e.status === 401) {
          api.clearToken();
        }
        setStatus("loggedOut");
      });
  }, []);

  const reloadShifts = useCallback(async (u: User, anchor: Date) => {
    setShiftsLoading(true);
    try {
      const cutoff = new Date(anchor.getFullYear() - RETENTION_YEARS, anchor.getMonth(), anchor.getDate());
      const weekEnd = addDays(startOfWeek(anchor, u.weekStartsOn), 6);
      const { shifts } = await api.listShifts(isoDate(cutoff), isoDate(weekEnd));
      setShifts(shifts);
    } finally {
      setShiftsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "loggedIn" && user) {
      void reloadShifts(user, today);
    }
    // Re-fetch when the week-start setting changes the window we need, or the day rolls over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, user?.id, user?.weekStartsOn, reloadShifts]);

  const login = useCallback(async (email: string, password: string) => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const { token, user } = await api.login(email, password);
      api.setToken(token);
      setUser(user);
      setStatus("loggedIn");
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Could not log in");
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const signup = useCallback(async (input: api.SignupInput) => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const { token, user } = await api.signup(input);
      api.setToken(token);
      setUser(user);
      setStatus("loggedIn");
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Could not create account");
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const logout = useCallback(() => {
    api.clearToken();
    setUser(null);
    setShifts([]);
    setStatus("loggedOut");
  }, []);

  // Shared handling for authenticated actions (settings/shifts): an expired or invalid
  // token logs the user out with a clear reason instead of failing silently; any other
  // failure (validation, network) surfaces as a dismissible message instead of an
  // unhandled promise rejection.
  const handleActionError = useCallback(
    (e: unknown, fallback: string) => {
      if (e instanceof ApiError && e.status === 401) {
        logout();
        setActionError("Your session expired. Please log in again.");
        return;
      }
      setActionError(e instanceof Error ? e.message : fallback);
    },
    [logout]
  );

  const updateSettings = useCallback(
    async (patch: api.MePatch) => {
      try {
        const { user } = await api.patchMe(patch);
        setUser(user);
      } catch (e) {
        handleActionError(e, "Couldn't save settings");
      }
    },
    [handleActionError]
  );

  const createShift = useCallback(
    async (input: api.ShiftInput) => {
      try {
        const { shift } = await api.createShift(input);
        setShifts((prev) => [...prev, shift]);
        return shift;
      } catch (e) {
        handleActionError(e, "Couldn't save shift");
        return undefined;
      }
    },
    [handleActionError]
  );

  const updateShift = useCallback(
    async (id: string, patch: Partial<api.ShiftInput>) => {
      try {
        const { shift } = await api.patchShift(id, patch);
        setShifts((prev) => prev.map((s) => (s.id === id ? shift : s)));
        return shift;
      } catch (e) {
        handleActionError(e, "Couldn't update shift");
        return undefined;
      }
    },
    [handleActionError]
  );

  const removeShift = useCallback(
    async (id: string) => {
      try {
        await api.deleteShift(id);
        setShifts((prev) => prev.filter((s) => s.id !== id));
      } catch (e) {
        handleActionError(e, "Couldn't remove shift");
      }
    },
    [handleActionError]
  );

  const value = useMemo<AppContextValue>(
    () => ({
      status,
      user,
      authError,
      authBusy,
      actionError,
      clearActionError: () => setActionError(null),
      login,
      signup,
      logout,
      clearAuthError: () => setAuthError(null),
      updateSettings,
      today,
      shifts,
      shiftsLoading,
      createShift,
      updateShift,
      removeShift,
    }),
    [
      status,
      user,
      authError,
      authBusy,
      actionError,
      login,
      signup,
      logout,
      updateSettings,
      today,
      shifts,
      shiftsLoading,
      createShift,
      updateShift,
      removeShift,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
