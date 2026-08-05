export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  work_location_name: string;
  work_address: string;
  multiple_locations: number;
  other_locations: string;
  week_starts_on: "Monday" | "Sunday";
  rate: number;
  goal_hours: number;
  goal_earnings: number;
  created_at: string;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  workLocationName: string;
  workAddress: string;
  multipleLocations: boolean;
  otherLocations: string;
  weekStartsOn: "Monday" | "Sunday";
  rate: number;
  goalHours: number;
  goalEarnings: number;
  createdAt: string;
}

export interface ShiftRow {
  id: string;
  user_id: string;
  date: string;
  location: string;
  sign_in: string | null;
  sign_out: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicShift {
  id: string;
  date: string;
  location: string;
  signIn: string | null;
  signOut: string | null;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    workLocationName: row.work_location_name,
    workAddress: row.work_address,
    multipleLocations: !!row.multiple_locations,
    otherLocations: row.other_locations,
    weekStartsOn: row.week_starts_on,
    rate: row.rate,
    goalHours: row.goal_hours,
    goalEarnings: row.goal_earnings,
    createdAt: row.created_at,
  };
}

export function toPublicShift(row: ShiftRow): PublicShift {
  return {
    id: row.id,
    date: row.date,
    location: row.location,
    signIn: row.sign_in,
    signOut: row.sign_out,
  };
}
