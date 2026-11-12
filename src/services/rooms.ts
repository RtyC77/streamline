import { client } from "./supabase";
import type { Entry, Snapshot } from "../types";
export function tabId() {
  let id = sessionStorage.getItem("streamlite-client");
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem("streamlite-client", id);
  }
  return id;
}
export function parseInvite(input: string): string {
  let token = input.trim();
  if (/^https?:\/\//i.test(token)) {
    try {
      token =
        new URLSearchParams(new URL(token).hash.slice(1)).get("convite") ?? "";
    } catch {
      throw new Error("Link de convite inválido.");
    }
  }
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new Error(
      "Cole o link completo ou o código de convite de 64 caracteres.",
    );
  return token;
}
export function inviteLink(token: string) {
  return `${location.origin}/#${isRoomId(token) ? "sala" : "convite"}=${token}`;
}
export const isRoomId = (value: string) =>
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);

export interface ListedRoom {
  id: string;
  name: string;
  access_mode: "public" | "private" | "invite";
  max_members: number;
  participants: { nickname: string; sharing: boolean }[];
}

export const listRooms = (offset: number) =>
  rpc<ListedRoom[]>("list_rooms", { p_limit: 26, p_offset: offset });

export const createListedRoom = (nickname: string, capacity: number, access: "public" | "private", password: string) =>
  rpc<Entry>("create_listed_room", {
    p_nickname: nickname.trim(), p_client: tabId(), p_max_members: capacity,
    p_access: access, p_password: access === "private" ? password : null,
  });

export const joinListedRoom = (room: string, nickname: string, password: string) =>
  rpc<Entry>("join_listed_room", {
    p_room: room, p_nickname: nickname.trim(), p_client: tabId(), p_password: password || null,
  });
export async function rpc<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client().rpc(name, args);
  if (error) throw error;
  if (data && typeof data === "object" && "error" in data)
    throw new Error(String(data.error));
  return data as T;
}
export function enter(nickname: string, invite?: string, capacity = 2) {
  if (!invite && (!Number.isInteger(capacity) || capacity < 2 || capacity > 8))
    throw new Error('Escolha um limite de 2 a 8 pessoas.');
  return rpc<Entry>(invite ? "join_room" : "create_room", {
    p_nickname: nickname.trim(),
    p_client: tabId(),
    ...(invite ? { p_invite: parseInvite(invite) } : {p_max_members: capacity}),
  });
}
export const pulse = (room: string, session: string | null = null) =>
  rpc<Snapshot>("room_pulse", {
    p_room: room,
    p_client: tabId(),
    p_session: session,
  });
export const leaveRoom = (room: string) =>
  rpc<null>("leave_room", { p_room: room, p_client: tabId() });
export const claimStream = (room: string) =>
  rpc<string>("claim_stream", { p_room: room, p_client: tabId() });
export const kickMember = (room: string, user: string) =>
  rpc<Snapshot>("kick_member", {
    p_room: room,
    p_client: tabId(),
    p_user: user,
  });
export const releaseStream = (room: string, session: string) =>
  rpc<null>("release_stream", {
    p_room: room,
    p_client: tabId(),
    p_session: session,
  });
