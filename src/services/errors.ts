export function explain(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'PGRST202')
    return 'Atualize as migrations no Supabase, incluindo 202611060007_room_capacity.sql, para criar salas com limite configurável.';
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String(error.message)
        : "";
  if (error instanceof DOMException) {
    if (error.name === "TimeoutError" || error.name === "AbortError")
      return "O servidor demorou a responder. Verifique sua conexão e tente novamente.";
    if (error.name === "SecurityError" || error.name === "NotSupportedError")
      return "O compartilhamento não está disponível neste contexto. Use Chrome ou Edge atualizado em HTTPS.";
    if (error.name === "NotAllowedError")
      return "Compartilhamento cancelado ou sem permissão. Clique novamente e escolha uma janela.";
    if (error.name === "NotReadableError")
      return "O navegador não conseguiu capturar essa janela. Tente outra janela ou use o jogo em modo sem bordas.";
    if (error.name === "InvalidStateError")
      return "Mantenha esta aba em foco e clique em Compartilhar jogo novamente.";
    if (error.name === "NotFoundError")
      return "Nenhuma fonte de captura foi encontrada.";
  }
  if (/invalid api key|invalid.*publishable|supabase.*key/i.test(message))
    return "A chave pública do Supabase é inválida. Confira as variáveis de ambiente e refaça o build.";
  if (/jwt.*expired|invalid.*jwt|refresh token/i.test(message))
    return "Sua sessão expirou. Saia da sala e entre novamente pelo convite.";
  if (
    /setRemoteDescription|setLocalDescription|ICE candidate|SDP/i.test(message)
  )
    return "Não foi possível negociar a transmissão. Verifique a conexão; redes restritas podem precisar de TURN.";
  if (/fetch|network/i.test(message))
    return "Falha de rede. Verifique sua conexão e tente novamente.";
  if (/captcha/i.test(message))
    return "Valide a verificação de segurança e tente novamente.";
  if (/anonymous.*disabled/i.test(message))
    return "A entrada anônima está desativada no Supabase. Consulte o README.";
  return message && message.length < 240
    ? message
    : "Não foi possível concluir a operação. Tente novamente.";
}
