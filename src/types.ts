export interface Member {
  user_id: string;
  nickname: string;
  client_id: string;
}
export interface Room {
  max_members?: number;
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
  streams?: RoomStream[];
}
export interface RoomStream {broadcaster_id:string;session_id:string}
export function activeStreams(snapshot:Snapshot):RoomStream[]{
  return snapshot.streams ?? (snapshot.room.broadcaster_id && snapshot.room.stream_session ? [{broadcaster_id:snapshot.room.broadcaster_id,session_id:snapshot.room.stream_session}] : []);
}
export interface Entry extends Snapshot {
  invite?: string;
}
export type SignalBody =
  | { kind: "watch"; preview?: boolean }
  | { kind: "unwatch" }
  | { kind: "ice-batch"; candidates: RTCIceCandidateInit[] }
  | { kind: "offer" | "answer"; sdp: string }
  | { kind: "ice"; candidate: RTCIceCandidateInit };
export type Signal = SignalBody & {
  to: string;
  session: string;
  connection: string;
  client: string;
};
export interface PeerMetric {
  connection?: string;
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
  captureAudio?: string;
  selected?: string | null;
  sharing: boolean;
  remote: MediaStream | null;
  audio: string;
  connections: number;
  status: string;
}
