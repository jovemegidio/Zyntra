/**
 * ALUFORCE - Sistema de Monitoramento de Conexão
 * @version 20260203
 * @description Monitor de conexão com servidor
 */

// Verificação de conexão com o servidor
window.addEventListener('online', () => {
    console.log('✅ Conexão restabelecida');
});

window.addEventListener('offline', () => {
    console.warn('⚠️ Conexão perdida');
});

console.log('✅ ALUFORCE - Connection Monitor carregado com sucesso');
