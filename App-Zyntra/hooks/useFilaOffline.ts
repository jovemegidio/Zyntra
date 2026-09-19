import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { drenarFilaSeHouver, enviarFilaOffline } from '../lib/api';
import * as fila from '../lib/offline-queue';
import type { ItemFila } from '../lib/offline-queue';

/**
 * Estado da fila offline para a UI, mais os gatilhos de reenvio.
 *
 * O projeto não tem `@react-native-community/netinfo` nas dependências, então
 * não há evento de "rede voltou". Os três gatilhos abaixo cobrem o caso real
 * sem dependência nova:
 *
 *  1. app volta ao foreground — é o que acontece quando alguém sai do galpão
 *     sem sinal e destrava o celular já na área coberta;
 *  2. qualquer resposta bem-sucedida do axios (em `lib/api.ts`) — se uma
 *     requisição passou, a rede está de pé;
 *  3. o botão do banner, para quem não quer esperar.
 */
export function useFilaOffline() {
  const [itens, setItens] = useState<ItemFila[]>([]);
  const [sincronizando, setSincronizando] = useState(false);
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    const cancelarAssinatura = fila.assinar((lista) => {
      if (montado.current) setItens(lista);
    });
    return () => {
      montado.current = false;
      cancelarAssinatura();
    };
  }, []);

  const sincronizarAgora = useCallback(async () => {
    if (!montado.current) return;
    setSincronizando(true);
    try {
      await enviarFilaOffline();
    } finally {
      if (montado.current) setSincronizando(false);
    }
  }, []);

  // Gatilho 1: volta ao foreground.
  useEffect(() => {
    const aoMudarEstado = (estado: AppStateStatus) => {
      if (estado === 'active') void drenarFilaSeHouver();
    };
    const inscricao = AppState.addEventListener('change', aoMudarEstado);
    void drenarFilaSeHouver(); // e uma tentativa na montagem
    return () => inscricao.remove();
  }, []);

  const pendentes = itens.filter((item) => !item.falhou);
  const falhados = itens.filter((item) => item.falhou);

  return {
    itens,
    pendentes,
    falhados,
    sincronizando,
    sincronizarAgora,
    descartar: fila.descartar,
  };
}
