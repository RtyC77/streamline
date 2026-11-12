import { afterEach,beforeEach, describe, it, expect, vi } from "vitest";
import { Peers } from "../src/media/peers";
import type { MediaState, Signal, Snapshot } from "../src/types";
const host = crypto.randomUUID(),
  viewer = crypto.randomUUID(),
  hc = crypto.randomUUID(),
  vc = crypto.randomUUID(),
  sid = crypto.randomUUID();
class FakeStream {
  tracks: FakeTrack[] = [];
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
  addTrack(t: FakeTrack) {
    this.tracks.push(t);
  }
}
class FakeTrack {
  id = crypto.randomUUID();
  kind = "video";
  readyState = "live";
  enabled = true;
  stop = vi.fn(() => {
    this.readyState = "ended";
  });
  getSettings() {
    return { width: 1920, height: 1080 };
  }
  applyConstraints = vi.fn(async (_constraints: MediaTrackConstraints) => {});
}
class FakeSender {
  constructor(public track: FakeTrack | null) {}
  replaceTrack = vi.fn(async (next: FakeTrack | null) => { this.track = next; });
  getParameters = () => ({encodings: [{}]});
  setParameters = vi.fn(async (_parameters: RTCRtpSendParameters) => {});
}
class FakePC {
  data:{onopen:(()=>void)|null;onmessage:((e:{data:string})=>void)|null;onclose:(()=>void)|null;send:ReturnType<typeof vi.fn>;close:ReturnType<typeof vi.fn>}|null=null;
  createDataChannel(){return this.data={onopen:null,onmessage:null,onclose:null,send:vi.fn(),close:vi.fn()};}
  static all: FakePC[] = [];
  signalingState = "stable";
  connectionState = "new";
  iceConnectionState = "new";
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  onicecandidate: ((e: unknown) => void) | null = null;
  ontrack: ((e: { track: FakeTrack }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  added: FakeTrack[] = [];
  senders: FakeSender[] = [];
  closed = false;
  getTransceivers() {
    return [];
  }
  getReceivers() {
    return [];
  }
  getSenders() {
    return this.senders;
  }
  constructor() {
    FakePC.all.push(this);
  }
  addTrack(t: FakeTrack) {
    this.added.push(t);
    return this.makeSender(t);
  }
  addTransceiver() {
    return {sender: this.makeSender(null)};
  }
  private makeSender(track: FakeTrack | null) {
    const sender = new FakeSender(track);
    this.senders.push(sender);
    return sender;
  }
  createOffer = vi.fn(async () => ({ type: "offer", sdp: "offer" }));
  createAnswer = vi.fn(async () => ({ type: "answer", sdp: "answer" }));
  async setLocalDescription(d: { type: string; sdp: string }) {
    this.localDescription = d;
    this.signalingState = d.type === "offer" ? "have-local-offer" : "stable";
  }
  async setRemoteDescription(d: { type: string; sdp: string }) {
    this.remoteDescription = d;
    this.signalingState = d.type === "offer" ? "have-remote-offer" : "stable";
  }
  addIceCandidate = vi.fn(async () => undefined);
  close() {
    this.closed = true;
    this.signalingState = "closed";
  }
  async getStats() {
    return new Map();
  }
}
const snapshot: Snapshot = {
  room: {
    channel_epoch: crypto.randomUUID(),
    id: crypto.randomUUID(),
    name: "Sala",
    expires_at: "2099-01-01",
    broadcaster_id: host,
    stream_session: sid,
  },
  members: [
    { user_id: host, nickname: "Host", client_id: hc },
    { user_id: viewer, nickname: "Viewer", client_id: vc },
  ],
};
const flush = async (rounds = 30) => {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
};
function setup(self: string, client: string) {
  const messages: Signal[] = [];
  const states: MediaState[] = [];
  const warn = vi.fn();
  const manager = new Peers(
    self,
    client,
    {},
    async (s) => {
      messages.push(s);
    },
    (s) => states.push(s),
    () => undefined,
    warn,
  );
  manager.setSnapshot(snapshot);
  return { manager, messages, states, warn };
}
beforeEach(() => {
  FakePC.all = [];
  vi.stubGlobal("RTCPeerConnection", FakePC);
  vi.stubGlobal("MediaStream", FakeStream);
  vi.stubGlobal("RTCRtpReceiver", { getCapabilities: () => null });
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe("Negociação por espectador", () => {
  it("aplica o modo econômico apenas à conexão solicitante e restaura o perfil ao desativar", async () => {
    const second = crypto.randomUUID(), secondClient = crypto.randomUUID();
    const {manager} = setup(host, hc);
    const stream = new FakeStream();
    const track = new FakeTrack();
    stream.addTrack(track);
    manager.setSnapshot({...snapshot,members:[...snapshot.members,{user_id:second,nickname:"Outro",client_id:secondClient}]});
    manager.setLocal(stream as unknown as MediaStream,sid,"Sem áudio");
    const firstEnvelope = {to:host,session:sid,connection:crypto.randomUUID(),client:vc};
    const secondEnvelope = {to:host,session:sid,connection:crypto.randomUUID(),client:secondClient};
    manager.receive(viewer,{...firstEnvelope,kind:"watch",economy:true});
    manager.receive(second,{...secondEnvelope,kind:"watch"});
    await flush();
    const firstTune = vi.fn(async () => undefined), secondTune = vi.fn(async () => undefined);
    for (const [pc,tune] of [[FakePC.all[0],firstTune],[FakePC.all[1],secondTune]] as const) {
      Object.assign(pc,{getSenders:()=>[{track,getParameters:()=>({encodings:[{}]}),setParameters:tune}]});
    }
    manager.receive(viewer,{...firstEnvelope,kind:"answer",sdp:"answer"});
    manager.receive(second,{...secondEnvelope,kind:"answer",sdp:"answer"});
    await flush();
    expect(firstTune).toHaveBeenLastCalledWith(expect.objectContaining({encodings:[expect.objectContaining({maxBitrate:800_000,maxFramerate:24,scaleResolutionDownBy:2.25})]}));
    expect(secondTune).toHaveBeenLastCalledWith(expect.objectContaining({encodings:[expect.objectContaining({maxBitrate:3_000_000,maxFramerate:30})]}));
    manager.receive(viewer,{...firstEnvelope,kind:"viewer-quality",economy:false});
    await flush();
    expect(firstTune).toHaveBeenLastCalledWith(expect.objectContaining({encodings:[expect.objectContaining({maxFramerate:30,scaleResolutionDownBy:1.5})]}));
    expect(secondTune).toHaveBeenCalledTimes(1);
    manager.dispose();
  });
  it('inicia a troca durante manutenção pendente e bloqueia novos cliques até o primeiro quadro',async()=>{
    const other=crypto.randomUUID(),third=crypto.randomUUID(),s2=crypto.randomUUID(),s3=crypto.randomUUID();let release!:()=>void;
    const messages:Signal[]=[],states:MediaState[]=[];
    const manager=new Peers(viewer,vc,{},async s=>{messages.push(s);if(s.kind==='watch'&&s.preview&&s.session===s2)await new Promise<void>(r=>{release=r;});},s=>states.push(s),()=>{},()=>{});
    manager.setSnapshot({...snapshot,members:[...snapshot.members,{user_id:other,client_id:crypto.randomUUID(),nickname:'B'},{user_id:third,client_id:crypto.randomUUID(),nickname:'C'}],streams:[{broadcaster_id:host,session_id:sid},{broadcaster_id:other,session_id:s2},{broadcaster_id:third,session_id:s3}]});
    const pending=manager.maintain(),old=FakePC.all[0];old.ontrack?.({track:new FakeTrack()});const oldRemote=states.at(-1)!.remote!;
    manager.firstFrame(sid,oldRemote);expect(states.at(-1)?.switching).toBe(false);
    expect(manager.requestSelect(s2)).toBe(true);
    expect(messages.some(s=>s.kind==='watch'&&!s.preview&&s.session===s2)).toBe(true);
    const count=FakePC.all.length;expect(manager.requestSelect(s2)).toBe(false);expect(manager.requestSelect(s3)).toBe(false);expect(FakePC.all).toHaveLength(count);
    manager.firstFrame(sid,oldRemote);expect(states.at(-1)?.switching).toBe(true);
    const current=FakePC.all.at(-1)!;current.ontrack?.({track:new FakeTrack()});expect(states.at(-1)?.switching).toBe(true);
    manager.firstFrame(s2,states.at(-1)!.remote!);expect(states.at(-1)?.switching).toBe(false);
    expect(states.at(-1)?.switchTiming?.firstFrameMs).toBeTypeOf('number');
    release();await pending;expect(old.closed).toBe(true);expect(FakePC.all.filter(p=>!p.closed&&!p.data)).toHaveLength(1);manager.dispose();
  });
  it('libera a seleção após timeout e só tenta a mesma tela novamente por ação do usuário',async()=>{
    vi.useFakeTimers();const v=setup(viewer,vc);await v.manager.maintain();
    expect(v.states.at(-1)?.switching).toBe(true);expect(v.manager.requestSelect(sid)).toBe(false);
    vi.advanceTimersByTime(25000);expect(v.states.at(-1)?.switching).toBe(false);expect(v.states.at(-1)?.connectionIssue).toContain('não respondeu');expect(FakePC.all[0].closed).toBe(true);
    await v.manager.maintain();expect(FakePC.all).toHaveLength(1);
    expect(v.manager.requestSelect(sid)).toBe(true);expect(FakePC.all).toHaveLength(2);expect(v.states.at(-1)?.switching).toBe(true);
    v.manager.dispose();expect(vi.getTimerCount()).toBe(0);
  });
  it('libera a seleção se o transmissor sair durante a conexão',async()=>{
    const v=setup(viewer,vc);await v.manager.maintain();v.manager.departed(host);
    expect(v.states.at(-1)?.switching).toBe(false);expect(v.states.at(-1)?.connectionIssue).toContain('desconectou');v.manager.dispose();
  });
  it('uma negociação antiga não bloqueia outra tela nem envia resposta depois de ser cancelada',async()=>{
    const v=setup(viewer,vc),other=crypto.randomUUID(),otherClient=crypto.randomUUID(),s2=crypto.randomUUID();
    v.manager.setSnapshot({...snapshot,members:[...snapshot.members,{user_id:other,client_id:otherClient,nickname:'B'}],streams:[{broadcaster_id:host,session_id:sid},{broadcaster_id:other,session_id:s2}]});await v.manager.maintain();
    const old=FakePC.all[0],watch=v.messages[0];let release!:()=>void;
    vi.spyOn(old,'setRemoteDescription').mockImplementation(async()=>{await new Promise<void>(r=>{release=r;});});
    v.manager.receive(host,{...watch,to:viewer,client:hc,kind:'offer',sdp:'old'});await flush();
    v.manager.select(s2);await v.manager.maintain();const next=v.messages.find(s=>s.kind==='watch'&&!s.preview&&s.session===s2)!;
    v.manager.receive(other,{...next,to:viewer,client:otherClient,kind:'offer',sdp:'new'});await flush();
    expect(v.messages.some(s=>s.kind==='answer'&&s.session===s2)).toBe(true);
    release();await flush();expect(v.messages.some(s=>s.kind==='answer'&&s.session===sid)).toBe(false);v.manager.dispose();
  });
  it('não apresenta trilha negociada como conexão estabelecida e explica falta de TURN após timeout',async()=>{
    vi.useFakeTimers();const v=setup(viewer,vc);await v.manager.maintain();
    const watch=v.messages[0],pc=FakePC.all[0];
    v.manager.receive(host,{...watch,to:viewer,client:hc,kind:'offer',sdp:'offer'});await flush();
    pc.ontrack?.({track:new FakeTrack()});
    expect(v.states.at(-1)?.status).toBe('Conectando à tela');
    expect(v.states.at(-1)?.connectionIssue).toBeUndefined();
    vi.advanceTimersByTime(16000);await v.manager.maintain();
    expect(v.states.at(-1)?.connectionIssue).toContain('não tem TURN configurado');
    pc.connectionState='connected';pc.onconnectionstatechange?.();
    expect(v.states.at(-1)?.connectionIssue).toBeUndefined();
    expect(v.states.at(-1)?.status).toBe('Conexão de mídia estabelecida');v.manager.dispose();
  });
  it('distingue falta de resposta na sinalização de uma falha ICE',async()=>{
    vi.useFakeTimers();const v=setup(viewer,vc);await v.manager.maintain();
    vi.advanceTimersByTime(16000);await v.manager.maintain();
    expect(v.states.at(-1)?.connectionIssue).toContain('transmissor ainda não respondeu');v.manager.dispose();
  });
  it('não recomenda configurar TURN ausente quando há relay configurado',async()=>{
    vi.useFakeTimers();const v=setup(viewer,vc);v.manager.configure({iceServers:[{urls:['turn:relay.example.test:3478']}]});await v.manager.maintain();
    const watch=v.messages[0];v.manager.receive(host,{...watch,to:viewer,client:hc,kind:'offer',sdp:'offer'});await flush();
    vi.advanceTimersByTime(16000);await v.manager.maintain();
    expect(v.states.at(-1)?.connectionIssue).toContain('Verifique o serviço TURN');v.manager.dispose();
  });
  it('troca a tela recebida sem encerrar a própria transmissão e separa conexões mútuas',async()=>{
    const h=setup(host,hc),otherSession=crypto.randomUUID();
    h.manager.setSnapshot({...snapshot,streams:[{broadcaster_id:host,session_id:sid},{broadcaster_id:viewer,session_id:otherSession}]});
    const stream=new FakeStream(),track=new FakeTrack();stream.addTrack(track);h.manager.setLocal(stream as unknown as MediaStream,sid,'Sem áudio');
    h.manager.select(otherSession);
    await h.manager.maintain();const incoming=FakePC.all[0];
    h.manager.receive(viewer,{kind:'watch',to:host,session:sid,connection:crypto.randomUUID(),client:vc});await flush(100);
    expect(FakePC.all).toHaveLength(2);expect(FakePC.all[1].added[0]).toBe(track);
    h.manager.select(sid);expect(incoming.closed).toBe(true);expect(FakePC.all[1].closed).toBe(false);expect(track.readyState).toBe('live');
    expect(h.messages.some(s=>s.kind==='unwatch'&&s.session===otherSession)).toBe(true);h.manager.dispose();
  });
  it('troca vídeo e ativa áudio na mesma conexão, preservando a fonte se a troca falhar', async () => {
    const h = setup(host, hc);
    const original = new FakeStream(), originalVideo = new FakeTrack();
    original.addTrack(originalVideo);
    h.manager.setLocal(original as unknown as MediaStream, sid, 'Sem áudio');
    h.manager.receive(viewer, {kind:'watch', to:host, session:sid, connection:crypto.randomUUID(), client:vc});
    await flush();
    const pc = FakePC.all[0];
    const [videoSender, audioSender] = pc.senders;
    const next = new FakeStream(), nextVideo = new FakeTrack(), nextAudio = new FakeTrack();
    nextAudio.kind = 'audio';
    next.addTrack(nextVideo);
    next.addTrack(nextAudio);
    const replace = () => h.manager.replaceLocal(next as unknown as MediaStream, 'Com áudio', {resolution:1080,fps:60}, null);
    audioSender.replaceTrack.mockRejectedValueOnce(new Error('Troca de áudio recusada'));
    await expect(replace()).rejects.toThrow('Troca de áudio recusada');
    expect(videoSender.track).toBe(originalVideo);
    expect(originalVideo.stop).not.toHaveBeenCalled();
    await replace();
    expect(videoSender.track).toBe(nextVideo);
    expect(audioSender.track).toBe(nextAudio);
    expect(originalVideo.stop).toHaveBeenCalledOnce();
    expect(FakePC.all).toEqual([pc]);
    expect(pc.closed).toBe(false);
    expect(pc.createOffer).toHaveBeenCalledOnce();
    h.manager.dispose();
  });
  it('aplica resolução e FPS na captura e no encoder da conexão ativa', async () => {
    vi.stubGlobal('navigator', {mediaDevices: {getSupportedConstraints: () => ({width:true,height:true,frameRate:true})}});
    const h = setup(host, hc), stream = new FakeStream(), video = new FakeTrack();
    stream.addTrack(video);
    h.manager.setLocal(stream as unknown as MediaStream, sid, 'Sem áudio');
    const connection = crypto.randomUUID();
    h.manager.receive(viewer, {kind:'watch', to:host, session:sid, connection, client:vc});
    await flush();
    h.manager.receive(viewer, {kind:'answer', sdp:'answer', to:host, session:sid, connection, client:vc});
    await flush();
    const pc = FakePC.all[0];
    await h.manager.changeQuality({resolution:1080,fps:60});
    expect(video.applyConstraints).toHaveBeenCalledWith({
      width:{ideal:1920,max:1920},height:{ideal:1080,max:1080},frameRate:{ideal:60,max:60},
    });
    expect(pc.senders[0].setParameters).toHaveBeenLastCalledWith(expect.objectContaining({
      encodings:[expect.objectContaining({maxFramerate:60,maxBitrate:12_000_000})],
    }));
    expect(pc.senders[0].replaceTrack).not.toHaveBeenCalled();
    expect(pc.closed).toBe(false);
    h.manager.dispose();
  });
  it('envia prévia pelo data channel sem trilhas de mídia e fecha após confirmação',async()=>{
    const h=setup(host,hc),stream=new FakeStream(),track=new FakeTrack();stream.addTrack(track);
    const image='data:image/jpeg;base64,YQ==';h.manager.setLocal(stream as unknown as MediaStream,sid,'Sem áudio',undefined,image);
    h.manager.receive(viewer,{kind:'watch',preview:true,to:host,session:sid,connection:crypto.randomUUID(),client:vc});await flush(100);
    const pc=FakePC.all[0];expect(pc.added).toHaveLength(0);expect(track.enabled).toBe(false);
    pc.data?.onopen?.();expect(pc.data?.send).toHaveBeenCalledWith(image);
    pc.data?.onmessage?.({data:'ack'});expect(pc.closed).toBe(true);expect(h.messages.every(s=>!JSON.stringify(s).includes('data:image'))).toBe(true);h.manager.dispose();
  });
  it('recebe somente uma tela ao vivo e busca prévias uma de cada vez',async()=>{
    const v=setup(viewer,vc),other=crypto.randomUUID(),third=crypto.randomUUID(),s2=crypto.randomUUID(),s3=crypto.randomUUID();
    v.manager.setSnapshot({...snapshot,members:[...snapshot.members,{user_id:other,client_id:crypto.randomUUID(),nickname:'B'},{user_id:third,client_id:crypto.randomUUID(),nickname:'C'}],streams:[{broadcaster_id:host,session_id:sid},{broadcaster_id:other,session_id:s2},{broadcaster_id:third,session_id:s3}]});
    await v.manager.maintain();await v.manager.maintain();expect(FakePC.all).toHaveLength(2);
    expect(v.messages.filter(s=>s.kind==='watch'&&!s.preview)).toHaveLength(1);expect(v.messages.filter(s=>s.kind==='watch'&&s.preview)).toHaveLength(1);
    FakePC.all[1].data?.onclose?.();await v.manager.maintain();expect(FakePC.all).toHaveLength(3);
    v.manager.select(s3);await v.manager.maintain();expect(FakePC.all[0].closed).toBe(true);expect(FakePC.all[2].closed).toBe(true);
    expect(FakePC.all.filter(p=>!p.closed&&!p.data)).toHaveLength(1);v.manager.dispose();
  });
  it('agrupa ICE e cancela timers ao liberar a sessão',async()=>{
    vi.useFakeTimers();const v=setup(viewer,vc);await v.manager.maintain();const pc=FakePC.all[0];
    for(let i=0;i<5;i++)pc.onicecandidate?.({candidate:{toJSON:()=>({candidate:`candidate:${i}`,sdpMid:'0',sdpMLineIndex:0})}});
    await vi.advanceTimersByTimeAsync(150);expect(v.messages.filter(s=>s.kind==='ice-batch')).toHaveLength(1);
    expect(v.messages.find(s=>s.kind==='ice-batch')).toMatchObject({candidates:expect.arrayContaining([expect.objectContaining({candidate:'candidate:0'})])});
    pc.onicecandidate?.({candidate:{toJSON:()=>({candidate:'late',sdpMid:'0',sdpMLineIndex:0})}});v.manager.dispose();expect(vi.getTimerCount()).toBe(0);
  });
  it("não coleta getStats do espectador com diagnóstico fechado", async () => {
    const v = setup(viewer, vc);
    await v.manager.maintain();
    const stats = vi.spyOn(FakePC.all[0], "getStats");
    await v.manager.sample(false);
    expect(stats).not.toHaveBeenCalled();
    await v.manager.sample(true);
    expect(stats).toHaveBeenCalledOnce();
    v.manager.dispose();
  });
  it("não reemite o mesmo estado de mídia para snapshots equivalentes", () => {
    const v = setup(viewer, vc);
    const count = v.states.length;
    v.manager.setSnapshot({ ...snapshot, members: [...snapshot.members] });
    expect(v.states).toHaveLength(count);
    v.manager.dispose();
  });
  it("negocia offer/answer, enfileira ICE precoce e ignora mensagens antigas", async () => {
    const h = setup(host, hc),
      v = setup(viewer, vc);
    const stream = new FakeStream();
    const track = new FakeTrack();
    stream.addTrack(track);
    h.manager.setLocal(stream as unknown as MediaStream, sid, "Sem áudio");
    expect(track.enabled).toBe(false);
    await v.manager.maintain();
    const watch = v.messages[0];
    h.manager.receive(viewer, watch);
    await flush();
    expect(h.messages[0].kind).toBe("offer");
    expect(track.enabled).toBe(true);
    const offer = h.messages[0];
    const ice: Signal = {
      ...offer,
      kind: "ice",
      candidate: { candidate: "candidate:x", sdpMid: "0", sdpMLineIndex: 0 },
    };
    v.manager.receive(host, ice);
    v.manager.receive(host, { ...offer, session: crypto.randomUUID() });
    await flush();
    expect(FakePC.all[0].remoteDescription).toBeNull();
    v.manager.receive(host, offer);
    await flush();
    expect(FakePC.all[0].addIceCandidate).toHaveBeenCalledTimes(1);
    h.manager.receive(
      viewer,
      v.messages.find((s) => s.kind === "answer")!,
    );
    await flush();
    expect(FakePC.all[1].signalingState).toBe("stable");
    expect(h.warn).not.toHaveBeenCalled();
    expect(v.warn).not.toHaveBeenCalled();
    h.manager.dispose();
    v.manager.dispose();
    expect(track.stop).toHaveBeenCalled();
    expect(FakePC.all.every((p) => p.closed)).toBe(true);
  });
  it("não cria conexões duplicadas para watch repetido e rejeita client_id forjado", async () => {
    const h = setup(host, hc);
    const stream = new FakeStream();
    stream.addTrack(new FakeTrack());
    h.manager.setLocal(stream as unknown as MediaStream, sid, "Sem áudio");
    const watch: Signal = {
      kind: "watch",
      to: host,
      session: sid,
      connection: crypto.randomUUID(),
      client: vc,
    };
    h.manager.receive(viewer, { ...watch, client: crypto.randomUUID() });
    await flush();
    expect(FakePC.all).toHaveLength(0);
    h.manager.receive(viewer, watch);
    h.manager.receive(viewer, watch);
    await flush();
    expect(FakePC.all).toHaveLength(1);
    expect(h.messages).toHaveLength(1);
    h.manager.dispose();
  });
  it("aceita espectador tardio, fecha conexão anterior e descarta candidates de outra conexão", async () => {
    const v = setup(viewer, vc);
    await v.manager.maintain();
    const old = v.messages[0];
    v.manager.receive(host, {
      ...old,
      to: viewer,
      client: hc,
      connection: crypto.randomUUID(),
      kind: "ice",
      candidate: { candidate: "x", sdpMid: "0", sdpMLineIndex: 0 },
    });
    await flush();
    expect(FakePC.all[0].addIceCandidate).not.toHaveBeenCalled();
    v.manager.setSnapshot({
      ...snapshot,
      room: { ...snapshot.room, stream_session: crypto.randomUUID() },
    });
    expect(FakePC.all[0].closed).toBe(true);
    await v.manager.maintain();
    expect(FakePC.all).toHaveLength(2);
    v.manager.dispose();
  });
  it("interrompe captura quando perde a concessão e libera peers na saída", () => {
    const h = setup(host, hc);
    const stream = new FakeStream();
    const track = new FakeTrack();
    stream.addTrack(track);
    h.manager.setLocal(stream as unknown as MediaStream, sid, "Sem áudio");
    h.manager.setSnapshot({
      ...snapshot,
      room: { ...snapshot.room, broadcaster_id: null, stream_session: null },
    });
    expect(track.readyState).toBe("ended");
    expect(h.states.at(-1)?.sharing).toBe(false);
    h.manager.dispose();
  });
  it("suporta sete espectadores sem duplicar a captura", async () => {
    const h = setup(host, hc);
    const others = Array.from({ length: 7 }, () => ({
      user_id: crypto.randomUUID(),
      nickname: "Amigo",
      client_id: crypto.randomUUID(),
    }));
    h.manager.setSnapshot({
      ...snapshot,
      members: [snapshot.members[0], ...others],
    });
    const stream = new FakeStream();
    const track = new FakeTrack();
    stream.addTrack(track);
    h.manager.setLocal(stream as unknown as MediaStream, sid, "Sem áudio");
    for (const m of others)
      h.manager.receive(m.user_id, {
        kind: "watch",
        to: host,
        client: m.client_id,
        session: sid,
        connection: crypto.randomUUID(),
      });
    await flush();
    // Seven offers pass through the serialized negotiation queue.
    await flush(100);
    expect(FakePC.all).toHaveLength(7);
    expect(FakePC.all.every((p) => p.added[0] === track)).toBe(true);
    h.manager.departed(others[0].user_id);
    expect(FakePC.all[0].closed).toBe(true);
    h.manager.dispose();
    expect(FakePC.all.every((p) => p.closed)).toBe(true);
  });
});
