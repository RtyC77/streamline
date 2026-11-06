# Expulsão pelo host

O host é o usuário que criou a sala (`rooms.created_by`). Esse papel não muda quando outro participante começa a transmitir. O criador vê um pequeno ícone de remover participante ao lado dos outros nomes; o controle tem título e descrição acessível. O host não pode expulsar a si mesmo por esse controle.

Para habilitar, execute `supabase/migrations/202611060004_host_kick.sql` no SQL Editor do Supabase e recarregue o site. As migrations anteriores devem existir; se a terceira ainda estiver pendente, aplique-a antes da quarta. A atualização do frontend não aplica SQL automaticamente. Até a quarta migration ser aplicada, o botão fica oculto porque o snapshot não informa o criador.

A RPC valida a associação e a aba do solicitante e exige que ele seja o criador. A transação bloqueia a sala, remove a associação do alvo, troca a geração dos canais e encerra a concessão se o alvo era o transmissor. Um aviso privado vazio solicita a reconciliação; o expulso só sai da interface depois de confirmar a perda de associação no servidor. Normalmente esse aviso é processado no próximo ciclo local de manutenção (até cinco segundos); eventos perdidos usam a reconciliação periódica de 20/30 segundos. Navegadores suspensos podem processar a saída apenas ao retomar.

Isso é expulsão da sessão atual, não banimento: o participante pode entrar novamente com um convite válido. O host que sai mantém a identidade de criador ao retornar com a mesma conta anônima; não há transferência automática de propriedade.

Testes: controles visíveis somente ao host, impossibilidade de autoexpulsão, proibição para intrusos e espectadores, remoção de associação, encerramento de transmissão, geração de autorização, RLS após expulsão e reentrada validada por convite. A validação entre navegadores reais após aplicar SQL permanece necessária.
