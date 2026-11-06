import type { Snapshot } from "../types";
export const cadence = {
  maintenance: 5_000,
  viewerPulse: 30_000,
  senderPulse: 20_000,
  diagnostics: 5_000,
  adaptation: 10_000,
};
export function sameSnapshot(a: Snapshot, b: Snapshot) {
  return (
    a.room.id === b.room.id &&
    a.room.name === b.room.name &&
    a.room.expires_at === b.room.expires_at &&
    a.room.channel_epoch === b.room.channel_epoch &&
    a.room.broadcaster_id === b.room.broadcaster_id &&
    a.room.stream_session === b.room.stream_session &&
    a.members.length === b.members.length &&
    a.members.every((m) =>
      b.members.some(
        (n) =>
          m.user_id === n.user_id &&
          m.client_id === n.client_id &&
          m.nickname === n.nickname,
      ),
    )
  );
}
