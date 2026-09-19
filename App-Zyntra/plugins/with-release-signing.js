/**
 * Config plugin — assinatura de RELEASE do APK Android.
 *
 * POR QUE UM PLUGIN, E NÃO EDITAR android/app/build.gradle:
 * o `android/` é GERADO por `expo prebuild` e regravado a cada build (o projeto não
 * versiona a pasta nativa). Qualquer edição manual no build.gradle some no próximo
 * prebuild. O plugin roda DENTRO do prebuild, então a configuração sempre existe.
 *
 * O QUE ELE CORRIGE:
 * o template do Expo cria `buildTypes.release` apontando para `signingConfigs.debug`
 * — ou seja, o "release" sai assinado com a keystore de debug, que não serve para
 * distribuir nem para atualizar um app já instalado.
 *
 * COMO A KEYSTORE CHEGA AQUI:
 * nada de segredo no repositório. O build passa 4 propriedades do Gradle
 * (-P ou gradle.properties), e o bloco só é ativado quando elas existem:
 *
 *   ZYNTRA_STORE_FILE      caminho do .keystore (relativo a android/app/)
 *   ZYNTRA_STORE_PASSWORD  senha do armazenamento
 *   ZYNTRA_KEY_ALIAS       alias da chave
 *   ZYNTRA_KEY_PASSWORD    senha da chave (em keystore PKCS12 é a MESMA do store)
 *
 * Sem essas propriedades o build continua caindo na keystore de debug, então
 * `expo run:android` e qualquer build local seguem funcionando sem configuração.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const MARCA = 'ZYNTRA_RELEASE_SIGNING';

const BLOCO_SIGNING = `
        // ${MARCA} — injetado por plugins/with-release-signing.js
        release {
            if (project.hasProperty('ZYNTRA_STORE_FILE')) {
                storeFile file(ZYNTRA_STORE_FILE)
                storePassword ZYNTRA_STORE_PASSWORD
                keyAlias ZYNTRA_KEY_ALIAS
                keyPassword ZYNTRA_KEY_PASSWORD
            }
        }`;

function injetar(gradle) {
    // Idempotente: prebuild pode rodar mais de uma vez sobre a mesma árvore.
    if (gradle.includes(MARCA)) return gradle;

    // 1) acrescenta o signingConfig `release` ao bloco signingConfigs existente
    const alvoSigning = /signingConfigs\s*\{/;
    if (!alvoSigning.test(gradle)) {
        throw new Error('[with-release-signing] bloco signingConfigs não encontrado em android/app/build.gradle');
    }
    let saida = gradle.replace(alvoSigning, (m) => m + BLOCO_SIGNING);

    // 2) aponta o buildType release para ele — mas SÓ quando a keystore foi passada,
    //    senão um build local sem as propriedades falharia em vez de usar a debug.
    const alvoBuildType = /(release\s*\{[^}]*?)signingConfig\s+signingConfigs\.debug/s;
    if (!alvoBuildType.test(saida)) {
        throw new Error('[with-release-signing] buildTypes.release não aponta para signingConfigs.debug como esperado');
    }
    saida = saida.replace(alvoBuildType,
        `$1signingConfig project.hasProperty('ZYNTRA_STORE_FILE') ? signingConfigs.release : signingConfigs.debug`);

    return saida;
}

module.exports = function withReleaseSigning(config) {
    return withAppBuildGradle(config, (cfg) => {
        if (cfg.modResults.language !== 'groovy') {
            throw new Error('[with-release-signing] esperado build.gradle em Groovy, veio ' + cfg.modResults.language);
        }
        cfg.modResults.contents = injetar(cfg.modResults.contents);
        return cfg;
    });
};
