import { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { Colors } from '@/lib/constants';
import { useFilaOffline } from '@/hooks/useFilaOffline';
import { IconRefresh, IconTrash, IconClose } from '@/components/ui';

/**
 * Faixa que aparece só quando há escrita pendente de envio.
 *
 * Sem ela a fila seria invisível: o usuário bate o ponto sem sinal, recebe
 * "vai subir quando a rede voltar" e não tem como saber se subiu. O banner é o
 * recibo — some sozinho quando a fila esvazia.
 */
export function OfflineBanner() {
  const { pendentes, falhados, sincronizando, sincronizarAgora, descartar } = useFilaOffline();
  const [aberto, setAberto] = useState(false);

  const total = pendentes.length + falhados.length;
  if (!total) return null;

  const temFalha = falhados.length > 0;
  const cor = temFalha ? Colors.red : Colors.yellow;
  const fundo = temFalha ? Colors.redDim : Colors.yellowDim;

  const texto = temFalha
    ? `${falhados.length} envio${falhados.length > 1 ? 's' : ''} recusado${falhados.length > 1 ? 's' : ''}`
    : `${pendentes.length} registro${pendentes.length > 1 ? 's' : ''} aguardando envio`;

  const confirmarDescarte = (id: string, rotulo: string) => {
    Alert.alert(
      'Descartar envio?',
      `"${rotulo}" será removido da fila e não será enviado. Não dá para desfazer.`,
      [
        { text: 'Manter', style: 'cancel' },
        { text: 'Descartar', style: 'destructive', onPress: () => void descartar(id) },
      ]
    );
  };

  return (
    <View style={{ backgroundColor: fundo, borderTopWidth: 1, borderTopColor: cor + '55' }}>
      <TouchableOpacity
        onPress={() => setAberto((v) => !v)}
        activeOpacity={0.7}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 16,
          paddingVertical: 10,
        }}
      >
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: cor }} />
        <Text style={{ flex: 1, fontSize: 13, fontWeight: '700', color: Colors.text }}>{texto}</Text>

        {sincronizando ? (
          <ActivityIndicator size="small" color={cor} />
        ) : (
          <TouchableOpacity
            onPress={() => void sincronizarAgora()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <IconRefresh size={17} color={cor} />
          </TouchableOpacity>
        )}
        <Text style={{ fontSize: 15, color: Colors.muted }}>{aberto ? '⌄' : '›'}</Text>
      </TouchableOpacity>

      {aberto && (
        <ScrollView style={{ maxHeight: 190 }} contentContainerStyle={{ paddingBottom: 8 }}>
          {[...pendentes, ...falhados].map((item) => (
            <View
              key={item.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingHorizontal: 16,
                paddingVertical: 8,
                borderTopWidth: 1,
                borderTopColor: cor + '33',
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12.5, fontWeight: '600', color: Colors.text }}>
                  {item.rotulo}
                </Text>
                <Text style={{ fontSize: 11, color: Colors.muted, marginTop: 1 }}>
                  {new Date(item.criadoEm).toLocaleString('pt-BR')}
                  {item.falhou ? ` · recusado: ${item.ultimoErro ?? 'erro'}` : ''}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => confirmarDescarte(item.id, item.rotulo)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                {item.falhou ? (
                  <IconTrash size={16} color={Colors.red} />
                ) : (
                  <IconClose size={15} color={Colors.muted} />
                )}
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
