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
  return `${location.origin}/#convite=${token}`;
}
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
export function enter(nickname: string, invite?: string) {
  return rpc<Entry>(invite ? "join_room" : "create_room", {
    p_nickname: nickname.trim(),
    p_client: tabId(),
    ...(invite ? { p_invite: parseInvite(invite) } : {}),
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
export const releaseStream = (room: string, session: string) =>
  rpc<null>("release_stream", {
    p_room: room,
    p_client: tabId(),
    p_session: session,
  });
