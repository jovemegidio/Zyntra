<?php
/**
 * Configurações de integração NFe/SEFAZ
 * 
 * IMPORTANTE: Configure estas variáveis conforme seu ambiente
 */

// Ambiente (1=Produção, 2=Homologação)
define('NFE_AMBIENTE', 2);

// UF do emitente (código IBGE)
define('NFE_UF', 35); // 35=SP, 43=RS, 41=PR, etc

// Dados do Emitente
define('EMITENTE_RAZAO_SOCIAL', 'ALUFORCE INDÚSTRIA E COMÉRCIO LTDA');
define('EMITENTE_NOME_FANTASIA', 'ALUFORCE');
define('EMITENTE_CNPJ', '12345678000190');
define('EMITENTE_IE', '123456789');
define('EMITENTE_IM', '');
define('EMITENTE_CNAE', '2511000');
define('EMITENTE_CRT', 3); // 1=Simples Nacional, 2=Simples Excesso, 3=Regime Normal

// Endereço do Emitente
define('EMITENTE_LOGRADOURO', 'Rua Industrial José Silva');
define('EMITENTE_NUMERO', '1234');
define('EMITENTE_COMPLEMENTO', 'Galpão 5');
define('EMITENTE_BAIRRO', 'Distrito Industrial');
define('EMITENTE_CEP', '01234567');
define('EMITENTE_CODIGO_MUNICIPIO', '3550308'); // São Paulo
define('EMITENTE_MUNICIPIO', 'São Paulo');
define('EMITENTE_UF', 'SP');
define('EMITENTE_TELEFONE', '1134445566');

// Certificado Digital
define('CERTIFICADO_ARQUIVO', __DIR__ . '/certificado/certificado.pfx');
define('CERTIFICADO_SENHA', 'senha_certificado');

// CSC (Código de Segurança do Contribuinte) para QR Code NFCe
define('CSC_ID', '000001');
define('CSC_CODIGO', '');

// Série e Numeração
define('NFE_SERIE', 1);
define('NFE_NUMERO_INICIAL', 1);

// Diretórios
define('DIR_XMLS', __DIR__ . '/xmls/');
define('DIR_APROVADOS', __DIR__ . '/xmls/aprovados/');
define('DIR_REJEITADOS', __DIR__ . '/xmls/rejeitados/');
define('DIR_LOGS', __DIR__ . '/logs/');

// Criar diretórios se não existirem
$dirs = [DIR_XMLS, DIR_APROVADOS, DIR_REJEITADOS, DIR_LOGS];
foreach ($dirs as $dir) {
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
}

// Configurações de Timeout
define('TIMEOUT_CONEXAO', 30);
define('TIMEOUT_RESPOSTA', 120);

// URLs dos Webservices SEFAZ (SP - Homologação)
define('WS_NFE_AUTORIZACAO', 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx');
define('WS_NFE_RETORNO_AUTORIZACAO', 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nferetautorizacao4.asmx');
define('WS_NFE_CONSULTA_PROTOCOLO', 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx');
define('WS_NFE_INUTILIZACAO', 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeinutilizacao4.asmx');
define('WS_NFE_STATUS_SERVICO', 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx');
define('WS_NFE_EVENTO', 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx');

// Configurações de Email para envio de NFe
define('EMAIL_HOST', 'smtp.gmail.com');
define('EMAIL_PORT', 587);
define('EMAIL_USERNAME', 'seu_email@gmail.com');
define('EMAIL_PASSWORD', 'sua_senha');
define('EMAIL_FROM', 'seu_email@gmail.com');
define('EMAIL_FROM_NAME', EMITENTE_NOME_FANTASIA);

// Database (opcional - para controle interno)
define('DB_HOST', 'localhost');
define('DB_NAME', 'nfe_database');
define('DB_USER', 'root');
define('DB_PASS', '');

// Validações
if (NFE_AMBIENTE == 1 && empty(CERTIFICADO_SENHA)) {
    die('ERRO: Configure o certificado digital antes de usar em produção!');
}

return [
    'ambiente' => NFE_AMBIENTE,
    'uf' => NFE_UF,
    'emitente' => [
        'razao_social' => EMITENTE_RAZAO_SOCIAL,
        'nome_fantasia' => EMITENTE_NOME_FANTASIA,
        'cnpj' => EMITENTE_CNPJ,
        'ie' => EMITENTE_IE,
        'im' => EMITENTE_IM,
        'cnae' => EMITENTE_CNAE,
        'crt' => EMITENTE_CRT,
        'endereco' => [
            'logradouro' => EMITENTE_LOGRADOURO,
            'numero' => EMITENTE_NUMERO,
            'complemento' => EMITENTE_COMPLEMENTO,
            'bairro' => EMITENTE_BAIRRO,
            'cep' => EMITENTE_CEP,
            'codigo_municipio' => EMITENTE_CODIGO_MUNICIPIO,
            'municipio' => EMITENTE_MUNICIPIO,
            'uf' => EMITENTE_UF,
            'telefone' => EMITENTE_TELEFONE
        ]
    ]
];
