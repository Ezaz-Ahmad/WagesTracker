export type WeekStart = "Monday" | "Sunday";

export interface User {
  id: string;
  name: string;
  email: string;
  workLocationName: string;
  workAddress: string;
  multipleLocations: boolean;
  otherLocations: string;
  weekStartsOn: WeekStart;
  rate: number;
  goalHours: number;
  goalEarnings: number;
  createdAt: string;
}

export interface Shift {
  id: string;
  date: string; // YYYY-MM-DD
  location: string;
  signIn: string | null; // HH:MM
  signOut: string | null; // HH:MM
}

export type Screen = "home" | "entry" | "report" | "history" | "settings";
