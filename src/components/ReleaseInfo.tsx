import { useId, useRef } from "react";
import { version } from "../../package.json";
import { Icon } from "./Icon";

const releases = [
  {
    version: "0.2.0-beta.1",
    date: "2026-11-12",
    label: "12 de novembro de 2026",
    sections: [
      {
        title: "Salas e convites",
        changes: [
          "Página inicial com criação e entrada em abas separadas. Links de convite abrem na aba de entrada após o login.",
          "Catálogo de salas públicas e privadas, com senha para salas privadas. O catálogo carrega mesmo antes de entrar em uma sala.",
          "Entrada por link, código de convite ou ID da sala com uma conta ativa e e-mail confirmado.",
          "Criação de salas para contas autorizadas pela administração.",
          "Botão de copiar convite simplificado, identificação do criador da sala e botão de saída em destaque.",
          "Fechamento de salas vazias após 10 segundos, com cancelamento da contagem se alguém voltar. A ativação em produção depende da atualização do Supabase.",
        ],
      },
      {
        title: "Compartilhamento e câmera",
        changes: [
          "Resolução de 1920 × 1080 e opções de 48 e 60 FPS, com aviso em vermelho para configurações pesadas.",
          "Troca de tela, resolução e FPS durante a transmissão pelo menu na seta ao lado de Parar transmissão.",
          "Modo econômico por espectador.",
          "Câmera na lista de participantes e controle de câmera reposicionado.",
          "Três sons distintos para início de compartilhamento, entrada e saída de participantes.",
        ],
      },
      {
        title: "Conta e administração",
        changes: [
          "Cadastro com confirmação de e-mail, recuperação de senha e opção de permanecer conectado.",
          "Os links de confirmação de e-mail e recuperação de senha podem voltar ao endereço público do StreamLite, inclusive quando solicitados em um ambiente de testes.",
          "Painel administrativo com pesquisa de usuários, gestão de permissões e histórico de alterações.",
        ],
      },
      {
        title: "Interface",
        changes: [
          "Botões de Perfil, Administração e Sair da conta com altura uniforme, ícones e foco visível pelo teclado.",
          "Visual renovado, com ajustes na área de compartilhamento e adaptação a diferentes tamanhos de tela.",
          "Grade de telas compartilhadas, visualização expandida com botão Voltar e avisos de conexão na sala.",
          "Lista de participantes mais compacta, com prévias e nomes mais próximos e remoção do aviso de vagas.",
          "Avatar, nome, status de conexão e configurações reunidos em um rodapé compacto na sala.",
          "Selo Beta, versão do site e changelog.",
        ],
      },
    ],
  },
];

export function ReleaseInfo() {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();

  return (
    <>
      <button
        className="release-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-label={`Changelog, versão ${version}`}
        onClick={() => dialog.current?.showModal()}
      >
        <span className="beta-stamp">Beta</span>
        <span className="release-version">v{version}</span>
        <span className="release-label">Changelog</span>
      </button>
      <dialog ref={dialog} className="release-dialog" aria-labelledby={title}>
        <div className="dialog-head">
          <h2 id={title}>Changelog</h2>
          <form method="dialog">
            <button className="icon-button" aria-label="Fechar changelog">
              <Icon name="close" />
            </button>
          </form>
        </div>
        {releases.map(release => (
          <article key={release.version}>
            <h3>v{release.version}</h3>
            <time dateTime={release.date}>{release.label}</time>
            {release.sections.map(section => (
              <section key={section.title}>
                <h4>{section.title}</h4>
                <ul>{section.changes.map(change => <li key={change}>{change}</li>)}</ul>
              </section>
            ))}
          </article>
        ))}
      </dialog>
    </>
  );
}
