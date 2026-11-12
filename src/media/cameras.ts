import type { CameraView, Member, Signal, SignalBody } from "../types";

interface Link {
  pc: RTCPeerConnection;
  session: string;
  connection: string;
  created: number;
  ice: RTCIceCandidateInit[];
  pending: Promise<void>;
  stream?: MediaStream;
  failed: boolean;
}

const connectionError = "Falha na conexão de vídeo. Tentando reconectar…";

export class Cameras {
  private members = new Map<string, string>();
  private advertised = new Map<string, string>();
  private incoming = new Map<string, Link>();
  private outgoing = new Map<string, Link>();
  private local: { stream: MediaStream; session: string } | null = null;
  private connected = false;
  private publicationFailed = false;
  private requesting = false;
  private closed = false;
  private views: Record<string, CameraView> = {};

  constructor(
    private self: string,
    private client: string,
    private config: RTCConfiguration,
    private send: (signal: Signal) => Promise<void>,
    private publish: (session: string | null) => void,
    private update: (views: Record<string, CameraView>) => void,
    private error: (message: string) => void,
  ) {}

  get capturing() {
    return this.local !== null;
  }

  configure(config: RTCConfiguration) {
    this.config = config;
    for (const link of [...this.incoming.values(), ...this.outgoing.values()])
      if (!link.failed) link.pc.setConfiguration(config);
  }

  setMembers(members: Member[], reset: boolean) {
    const next = new Map(members.map(member => [member.user_id, member.client_id]));
    for (const [id, client] of this.members)
      if (reset || next.get(id) !== client) this.remove(id);
    this.members = next;
    this.emit();
  }

  setConnected(connected: boolean) {
    this.connected = connected;
    this.emit();
    if (connected) this.maintain();
  }

  publication(success: boolean) {
    this.publicationFailed = !success;
    this.emit();
  }

  async start() {
    if (this.closed || this.local || this.requesting) return;
    if (!this.connected) throw new Error("Aguarde a conexão com a sala para ativar a câmera.");
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error("Câmera indisponível. Abra a sala em HTTPS e use um navegador compatível.");
    this.requesting = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { width: { ideal: 320, max: 640 }, height: { ideal: 240, max: 480 }, frameRate: { ideal: 15, max: 15 } },
      });
      const track = stream.getVideoTracks()[0];
      if (this.closed || !this.connected || !track || track.readyState !== "live") {
        stream.getTracks().forEach(item => item.stop());
        if (this.closed) return;
        if (!this.connected) throw new Error("A conexão com a sala foi interrompida. Reconecte-se para ativar a câmera.");
        throw new Error("A câmera parou antes de iniciar. Tente ativá-la novamente.");
      }
      this.local = { stream, session: crypto.randomUUID() };
      track.addEventListener("ended", () => {
        if (this.local?.stream !== stream) return;
        this.stop();
        this.error("A câmera foi desconectada ou perdeu o acesso. Verifique o dispositivo e tente novamente.");
      }, { once: true });
      this.publish(this.local.session);
      this.emit();
    } catch (cause) {
      if (this.closed) return;
      const name = cause instanceof Error ? cause.name : "";
      if (name === "NotAllowedError" || name === "SecurityError")
        throw new Error("Permissão da câmera negada. Libere o acesso nas configurações do navegador e tente novamente.");
      if (name === "NotFoundError" || name === "OverconstrainedError")
        throw new Error("Nenhuma câmera compatível foi encontrada. Conecte uma câmera e tente novamente.");
      if (name === "NotReadableError" || name === "AbortError")
        throw new Error("Não foi possível acessar a câmera. Verifique se outro aplicativo está usando o dispositivo.");
      throw cause;
    } finally {
      this.requesting = false;
    }
  }

  stop() {
    if (!this.local) return;
    this.local.stream.getTracks().forEach(track => track.stop());
    this.local = null;
    for (const id of this.outgoing.keys()) this.closeLink(this.outgoing, id);
    if (!this.closed) this.publish(null);
    this.emit();
  }

  presence(id: string, session: string | null, client: string | null) {
    if (this.closed || !this.members.has(id) || (session && this.members.get(id) !== client)) return;
    if (this.advertised.get(id) === (session ?? undefined)) return;
    this.closeLink(this.incoming, id);
    if (session) this.advertised.set(id, session);
    else this.advertised.delete(id);
    this.maintain();
  }

  private emit() {
    if (this.closed) return;
    const views: Record<string, CameraView> = {};
    if (this.local) {
      const failed = [...this.outgoing.values()].some(link => link.failed);
      views[this.self] = {
        stream: this.local.stream,
        message: !this.connected || this.publicationFailed || failed ? connectionError : undefined,
      };
    }
    for (const id of this.advertised.keys()) {
      const link = this.incoming.get(id);
      const stream = link && !link.failed && link.pc.connectionState === "connected" ? link.stream : undefined;
      views[id] = {
        stream,
        message: !this.connected || link?.failed ? connectionError : stream ? undefined : "Conectando à câmera…",
      };
    }
    const ids = Object.keys(views);
    if (ids.length === Object.keys(this.views).length && ids.every(id =>
      views[id].stream === this.views[id]?.stream && views[id].message === this.views[id]?.message && id in this.views
    )) return;
    this.views = views;
    this.update(views);
  }

  private closeLink(links: Map<string, Link>, id: string) {
    const link = links.get(id);
    if (!link) return;
    links.delete(id);
    this.release(link);
  }

  private release(link: Link) {
    link.pc.ontrack = null;
    link.pc.onicecandidate = null;
    link.pc.onconnectionstatechange = null;
    link.stream?.getTracks().forEach(track => track.stop());
    link.stream = undefined;
    link.pc.close();
  }

  private fail(link: Link) {
    if (link.failed) return;
    link.failed = true;
    this.release(link);
    this.emit();
  }

  private signal(id: string, link: Link, body: SignalBody) {
    return this.send({ ...body, media: "camera", to: id, client: this.client, session: link.session, connection: link.connection });
  }

  private create(links: Map<string, Link>, id: string, session: string, connection: string) {
    this.closeLink(links, id);
    const pc = new RTCPeerConnection(this.config);
    const link: Link = { pc, session, connection, created: Date.now(), ice: [], pending: Promise.resolve(), failed: false };
    links.set(id, link);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") this.fail(link);
      else this.emit();
    };
    pc.onicecandidate = event => {
      if (event.candidate)
        void this.signal(id, link, { kind: "ice", candidate: event.candidate.toJSON() }).catch(() => this.fail(link));
    };
    pc.ontrack = ({ track }) => {
      if (links !== this.incoming || track.kind !== "video") {
        track.stop();
        return;
      }
      const show = () => {
        if (link.failed || links.get(id) !== link) return;
        link.stream = new MediaStream([track]);
        this.emit();
      };
      if (track.muted) track.addEventListener("unmute", show, { once: true });
      else show();
      track.addEventListener("ended", () => {
        if (links.get(id) === link) this.fail(link);
      }, { once: true });
    };
    return link;
  }

  private async describe(id: string, link: Link, kind: "offer" | "answer") {
    const pc = link.pc;
    const description = await (kind === "offer" ? pc.createOffer() : pc.createAnswer());
    await pc.setLocalDescription(description);
    if (pc.localDescription?.sdp) await this.signal(id, link, { kind, sdp: pc.localDescription.sdp });
  }

  receive(id: string, signal: Signal) {
    if (!this.connected || this.closed || id === this.self || this.members.get(id) !== signal.client) return;
    if (signal.kind === "watch") {
      const local = this.local;
      if (signal.session !== local?.session || this.outgoing.get(id)?.connection === signal.connection) return;
      try {
        const link = this.create(this.outgoing, id, signal.session, signal.connection);
        link.pending = Promise.resolve().then(async () => {
          if (link.pc.signalingState === "closed") return;
          for (const track of local.stream.getVideoTracks())
            link.pc.addTransceiver(track, { direction: "sendonly", streams: [local.stream] });
          await this.describe(id, link, "offer");
        }).catch(() => this.fail(link));
      } catch {
        this.error("Não foi possível conectar a câmera aos participantes. Verifique o suporte a WebRTC.");
      }
      return;
    }
    const outgoing = signal.session === this.local?.session;
    const link = (outgoing ? this.outgoing : this.incoming).get(id);
    if (!link || link.failed || link.session !== signal.session || link.connection !== signal.connection) return;
    link.pending = link.pending.then(async () => {
      const pc = link.pc;
      if (link.failed || pc.signalingState === "closed") return;
      if (signal.kind === "ice" || signal.kind === "ice-batch") {
        const candidates = signal.kind === "ice" ? [signal.candidate] : signal.candidates;
        for (const candidate of candidates) {
          if (pc.remoteDescription) await pc.addIceCandidate(candidate);
          else if (link.ice.length < 64) link.ice.push(candidate);
        }
        return;
      }
      if (signal.kind === "offer" && !outgoing && pc.signalingState === "stable") {
        await pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
        for (const candidate of link.ice.splice(0)) await pc.addIceCandidate(candidate);
        await this.describe(id, link, "answer");
      } else if (signal.kind === "answer" && outgoing && pc.signalingState === "have-local-offer") {
        await pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
        for (const candidate of link.ice.splice(0)) await pc.addIceCandidate(candidate);
      }
    }).catch(() => this.fail(link));
  }

  maintain() {
    if (this.closed) return;
    if (this.connected) {
      for (const [id, session] of this.advertised) {
        const current = this.incoming.get(id);
        if (current && !current.failed && (!current.stream || current.pc.connectionState !== "connected") &&
          Date.now() - current.created >= 15_000) {
          this.fail(current);
          continue;
        }
        if (!current || current.failed) {
          try {
            const link = this.create(this.incoming, id, session, crypto.randomUUID());
            void this.signal(id, link, { kind: "watch" }).catch(() => this.fail(link));
          } catch {
            this.error("Não foi possível receber o vídeo da câmera. Verifique se o navegador oferece suporte a WebRTC.");
          }
        }
      }
      for (const link of this.outgoing.values())
        if (link.pc.connectionState !== "connected" && Date.now() - link.created >= 15_000) this.fail(link);
    }
    this.emit();
  }

  remove(id: string) {
    this.advertised.delete(id);
    this.closeLink(this.incoming, id);
    this.closeLink(this.outgoing, id);
    this.emit();
  }

  dispose() {
    this.closed = true;
    this.stop();
    for (const id of this.incoming.keys()) this.closeLink(this.incoming, id);
    this.advertised.clear();
  }
}
