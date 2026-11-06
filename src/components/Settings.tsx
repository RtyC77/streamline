import { useEffect, useRef } from "react";
import { Icon } from "./Icon";
export function Settings({
  onClose,
  diagnostics,
  onDiagnostics,
  audio,
  connection,
}: {
  onClose: () => void;
  diagnostics: boolean;
  onDiagnostics: (v: boolean) => void;
  audio: string;
  connection: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={onClose} aria-labelledby="settings-title">
      <div className="dialog-head">
        <h2 id="settings-title">Configurações</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Fechar configurações"
        >
          <Icon name="close" />
        </button>
      </div>
      <p>Perfil leve para jogar e compartilhar.</p>
      <dl className="settings-list">
        <div>
          <dt>Resolução desejada</dt>
          <dd>1280 × 720</dd>
        </div>
        <div>
          <dt>FPS máximo desejado</dt>
          <dd>30 FPS</dd>
        </div>
        <div>
          <dt>Bitrate por espectador</dt>
          <dd>Inicial 3 · ajuste 2,5–4 Mbps</dd>
        </div>
        <div>
          <dt>Codec preferido</dt>
          <dd>H.264 + Opus</dd>
        </div>
        <div>
          <dt>Captura de áudio</dt>
          <dd>{audio}</dd>
        </div>
        <div>
          <dt>Sinalização</dt>
          <dd>{connection}</dd>
        </div>
      </dl>
      <p>
        Espectadores saem automaticamente após 10 minutos com a aba em segundo
        plano. Quem está transmitindo permanece conectado.
      </p>
      <p className="muted">
        O navegador decide os parâmetros disponíveis. Confira os valores
        negociados no diagnóstico. A qualidade da mídia depende das métricas de
        cada conexão.
      </p>
      <label className="toggle-row">
        <span>
          <strong>Diagnóstico técnico</strong>
          <small>Resolução, codec e qualidade da conexão</small>
        </span>
        <input
          type="checkbox"
          checked={diagnostics}
          onChange={(e) => onDiagnostics(e.target.checked)}
        />
      </label>
    </dialog>
  );
}
