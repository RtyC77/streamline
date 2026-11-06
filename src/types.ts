export interface Member {
  user_id: string;
  nickname: string;
  client_id: string;
}
export interface Room {
  created_by?: string;
  channel_epoch: string;
  id: string;
  name: string;
  expires_at: string;
  broadcaster_id: string | null;
  stream_session: string | null;
}
export interface Snapshot {
  room: Room;
  members: Member[];
}
export interface Entry extends Snapshot {
  invite?: string;
}
export type SignalBody =
  | { kind: "watch" }
  | { kind: "offer" | "answer"; sdp: string }
  | { kind: "ice"; candidate: RTCIceCandidateInit };
export type Signal = SignalBody & {
  to: string;
  session: string;
  connection: string;
  client: string;
};
export interface PeerMetric {
  id: string;
  direction: string;
  fps?: number;
  width?: number;
  height?: number;
  bitrate?: number;
  codec?: string;
  lost?: number;
  rtt?: number;
  dropped?: number;
  route?: string;
  ice: string;
  audio: string;
  limitation?: string;
}
export interface MediaState {
  sharing: boolean;
  remote: MediaStream | null;
  audio: string;
  connections: number;
  status: string;
}
