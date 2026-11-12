import { rpc } from "./rooms";
import { prepareClient } from "./supabase";

export type Role = "user" | "admin" | "superadmin";
export type AccountStatus = "active" | "blocked";

export interface Profile {
  id: string;
  username: string;
  role: Role;
  status: AccountStatus;
  can_create_rooms: boolean;
  version: number;
}

export interface StaffUser extends Profile {
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
}

export interface AuditEntry {
  id: number;
  actor_name: string;
  target_name: string;
  action: string;
  created_at: string;
  previous_state: Record<string, string | boolean>;
  new_state: Record<string, string | boolean>;
}

export interface StaffRoom {
  id: string;
  name: string;
  participants: number;
  transmitting: boolean;
}

export async function loadProfile(id: string): Promise<Profile | null> {
  const api = await prepareClient();
  const { data, error } = await api.from("profiles").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

export const staffUsers = (search: string, status: string, role: string, offset: number) =>
  rpc<StaffUser[]>("staff_users", { p_search: search, p_status: status, p_role: role, p_offset: offset });
export const staffAudit = (offset: number) => rpc<AuditEntry[]>("staff_audit", { p_offset: offset });
export const updateUser = (user: StaffUser, action: string) =>
  rpc("staff_update_user", { p_id: user.id, p_action: action, p_version: user.version });
export const updateOwnUsername = (username: string) =>
  rpc<string>("update_own_username", { p_username: username });
export const staffRooms = () => rpc<StaffRoom[]>("staff_rooms", {});
export const closeStaffRoom = (id: string) => rpc<boolean>("staff_close_room", { p_room: id });

export const CREATE_ROOM_DENIED =
  "Você ainda não possui autorização para criar salas. Entre em contato com um administrador.";
