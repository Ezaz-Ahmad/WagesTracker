import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as api from "../lib/api";
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
  login: (email: string, password: string) => Promise<void>;
  signup: (input: api.SignupInput) => Promise<void>;
  logout: () => void;
  clearAuthError: () => void;
  updateSettings: (patch: api.MePatch) => Promise<void>;

  today: Date;
  shifts: Shift[];
  shiftsLoading: boolean;
  createShift: (input: api.ShiftInput) => Promise<Shift>;
  updateShift: (id: string, patch: Partial<api.ShiftInput>) => Promise<Shift>;
  removeShift: (id: string) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
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
      .catch(() => {
        api.clearToken();
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

  const updateSettings = useCallback(async (patch: api.MePatch) => {
    const { user } = await api.patchMe(patch);
    setUser(user);
  }, []);

  const createShift = useCallback(async (input: api.ShiftInput) => {
    const { shift } = await api.createShift(input);
    setShifts((prev) => [...prev, shift]);
    return shift;
  }, []);

  const updateShift = useCallback(async (id: string, patch: Partial<api.ShiftInput>) => {
    const { shift } = await api.patchShift(id, patch);
    setShifts((prev) => prev.map((s) => (s.id === id ? shift : s)));
    return shift;
  }, []);

  const removeShift = useCallback(async (id: string) => {
    await api.deleteShift(id);
    setShifts((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      status,
      user,
      authError,
      authBusy,
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
    [status, user, authError, authBusy, login, signup, logout, updateSettings, today, shifts, shiftsLoading, createShift, updateShift, removeShift]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
