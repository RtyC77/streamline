import type { Member, PeerMetric, SwitchTiming } from "../types";
const number = (n: number | undefined, suffix = "") =>
  n === undefined
    ? "Indisponível"
    : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}${suffix}`;
export function Diagnostics({
  metrics,
  members,
  switchTiming,
}: {
  metrics: PeerMetric[];
  members: Member[];
  switchTiming?:SwitchTiming;
}) {
  return (
    <section className="diagnostics" aria-label="Diagnóstico técnico">
      <div className="section-label">
        Diagnóstico WebRTC · atualização a cada 5 s
      </div>
      {switchTiming&&<p>Troca de tela · pedido: {number(switchTiming.requestedMs,' ms')} · resposta: {number(switchTiming.offerMs,' ms')} · conexão: {number(switchTiming.connectedMs,' ms')} · primeiro quadro: {number(switchTiming.firstFrameMs,' ms')}. Tempos desde o início da tentativa, medidos localmente.</p>}
      {metrics.length === 0 ? (
        <p>
          As métricas aparecerão quando uma conexão de mídia for estabelecida.
        </p>
      ) : (
        metrics.map((m) => (
          <div key={`${m.id}:${m.connection??m.direction}`} className="metric-peer">
            <strong>
              {members.find((p) => p.user_id === m.id)?.nickname} ·{" "}
              {m.direction}
            </strong>
            <dl>
              <div>
                <dt>Resolução real</dt>
                <dd>
                  {m.width && m.height
                    ? `${m.width} × ${m.height}`
                    : "Indisponível"}
                </dd>
              </div>
              <div>
                <dt>FPS</dt>
                <dd>{number(m.fps)}</dd>
              </div>
              <div>
                <dt>Bitrate</dt>
                <dd>
                  {number(
                    m.bitrate === undefined ? undefined : m.bitrate / 1e6,
                    " Mbps",
                  )}
                </dd>
              </div>
              <div>
                <dt>Codec</dt>
                <dd>{m.codec ?? "Indisponível"}</dd>
              </div>
              <div>
                <dt>Pacotes perdidos</dt>
                <dd>{number(m.lost)}</dd>
              </div>
              <div>
                <dt>RTT</dt>
                <dd>
                  {number(
                    m.rtt === undefined ? undefined : m.rtt * 1000,
                    " ms",
                  )}
                </dd>
              </div>
              <div>
                <dt>Frames descartados</dt>
                <dd>{number(m.dropped)}</dd>
              </div>
              <div>
                <dt>ICE</dt>
                <dd>{m.ice}</dd>
              </div>
              <div>
                <dt>Rota</dt>
                <dd>{m.route ?? "Indisponível"}</dd>
              </div>
              <div>
                <dt>Áudio</dt>
                <dd>{m.audio}</dd>
              </div>
              <div>
                <dt>Limitação do encoder</dt>
                <dd>{m.limitation ?? "Indisponível"}</dd>
              </div>
            </dl>
          </div>
        ))
      )}
      <p>CPU, GPU e RAM não são medidas. Valores ausentes não são estimados.</p>
    </section>
  );
}
