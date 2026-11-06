import type { PeerMetric } from "../types";
export interface Counter {
  bytes: number;
  timestamp: number;
}
export function bitrate(now: Counter, previous?: Counter): number | undefined {
  if (
    !previous ||
    now.timestamp <= previous.timestamp ||
    now.bytes < previous.bytes
  )
    return undefined;
  return (
    ((now.bytes - previous.bytes) * 8000) / (now.timestamp - previous.timestamp)
  );
}
export async function collectStats(
  pc: RTCPeerConnection,
  id: string,
  counters: Map<string, Counter>,
): Promise<PeerMetric> {
  const report = await pc.getStats();
  const metric: PeerMetric = {
    id,
    direction: "Aguardando mídia",
    ice: pc.iceConnectionState,
    audio:
      pc
        .getReceivers()
        .some(
          (r) => r.track.kind === "audio" && r.track.readyState === "live",
        ) ||
      pc
        .getSenders()
        .some((s) => s.track?.kind === "audio" && s.track.readyState === "live")
        ? "Trilha presente"
        : "Sem trilha",
  };
  report.forEach((s) => {
    if (
      (s.type === "outbound-rtp" || s.type === "inbound-rtp") &&
      s.kind === "video" &&
      !s.isRemote
    ) {
      const counter = {
        bytes: (s.bytesSent ?? s.bytesReceived) as number,
        timestamp: s.timestamp as number,
      };
      metric.direction = s.type === "outbound-rtp" ? "Enviando" : "Recebendo";
      metric.bitrate = bitrate(counter, counters.get(s.id));
      counters.set(s.id, counter);
      metric.fps = s.framesPerSecond;
      metric.width = s.frameWidth;
      metric.height = s.frameHeight;
      metric.lost = s.packetsLost;
      metric.dropped = s.framesDropped;
      metric.limitation = s.qualityLimitationReason;
      if (s.codecId) metric.codec = report.get(s.codecId)?.mimeType;
    }
    if (s.type === "remote-inbound-rtp" && s.kind === "video") {
      metric.lost = s.packetsLost;
      metric.rtt = s.roundTripTime;
    }
    if (s.type === "transport" && s.selectedCandidatePairId) {
      const pair = report.get(s.selectedCandidatePairId);
      if (pair) {
        metric.rtt = pair.currentRoundTripTime ?? metric.rtt;
        const local = report.get(pair.localCandidateId);
        const remote = report.get(pair.remoteCandidateId);
        if (local && remote)
          metric.route =
            local.candidateType === "relay" || remote.candidateType === "relay"
              ? "Relay (TURN)"
              : "Direta";
      }
    }
  });
  return metric;
}
