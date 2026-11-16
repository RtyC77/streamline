import { Brand } from "../components/Icon";

export function AboutPage() {
  return (
    <main className="account-shell">
      <Brand />
      <article className="entry-card account-card about-card">
        <h1>Sobre o StreamLite</h1>
        <p>O StreamLite é uma plataforma digital independente criada para facilitar o acesso, a organização e o compartilhamento de transmissões online.</p>
        <p>Nosso objetivo é proporcionar uma experiência simples, intuitiva e acessível para usuários que desejam criar ou participar de salas de transmissão, compartilhando momentos e conteúdos em um único ambiente.</p>
        <p>O StreamLite é um projeto independente, desenvolvido em 2026, com foco na praticidade, na experiência do usuário e na evolução contínua de suas funcionalidades.</p>
        <section>
          <h2>Nossa missão</h2>
          <p>Tornar mais simples a conexão entre pessoas por meio de transmissões online, oferecendo uma plataforma organizada e fácil de utilizar.</p>
        </section>
        <section>
          <h2>Contato institucional</h2>
          <p>Para dúvidas, sugestões ou informações relacionadas ao StreamLite, entre em contato pelo e-mail:</p>
          <a href="mailto:ropolatto77@gmail.com">ropolatto77@gmail.com</a>
        </section>
        <div className="account-actions">
          <a href="/">Voltar ao início</a>
        </div>
      </article>
    </main>
  );
}
