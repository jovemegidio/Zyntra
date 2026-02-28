<?php
/**
 * API REST para emissão de NFe
 * 
 * Endpoints:
 * POST /api.php?action=emitir - Emitir nova NFe
 * GET  /api.php?action=consultar&chave=... - Consultar NFe
 * POST /api.php?action=cancelar - Cancelar NFe
 * POST /api.php?action=cce - Carta de Correção
 * GET  /api.php?action=status - Status do serviço SEFAZ
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

require_once __DIR__ . '/NFe.php';
require_once __DIR__ . '/SEFAZ.php';
require_once __DIR__ . '/Database.php';

try {
    $action = $_GET['action'] ?? '';
    
    switch ($action) {
        case 'emitir':
            emitirNFe();
            break;
            
        case 'consultar':
            consultarNFe();
            break;
            
        case 'cancelar':
            cancelarNFe();
            break;
            
        case 'cce':
            cartaCorrecao();
            break;
            
        case 'inutilizar':
            inutilizarNumeracao();
            break;
            
        case 'status':
            statusServico();
            break;
            
        case 'listar':
            listarNFes();
            break;
            
        default:
            throw new Exception('Ação inválida');
    }
    
} catch (Exception $e) {
    echo json_encode([
        'sucesso' => false,
        'erro' => $e->getMessage(),
        'trace' => $e->getTraceAsString()
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
}

/**
 * Emite uma nova NFe
 */
function emitirNFe() {
    $dados = json_decode(file_get_contents('php://input'), true);
    
    if (!$dados) {
        throw new Exception('Dados inválidos');
    }
    
    // Validações básicas
    if (empty($dados['numero'])) {
        $db = new Database();
        $dados['numero'] = $db->proximoNumero($dados['serie'] ?? NFE_SERIE);
    }
    
    // Gerar XML
    $nfe = new NFe();
    $nfe->setDados($dados);
    
    $xml = $nfe->gerarXML();
    $xmlAssinado = $nfe->assinarXML();
    
    // Salvar XML
    $caminhoXML = $nfe->salvarXML();
    $chave = $nfe->getChaveAcesso();
    
    // Enviar para SEFAZ
    $sefaz = new SEFAZ();
    $resultado = $sefaz->autorizarNFe($xmlAssinado);
    
    // Se foi processamento síncrono e retornou o protocolo
    if ($resultado['sucesso']) {
        // Salvar no banco
        $db = new Database();
        $db->salvarNFe([
            'numero' => $dados['numero'],
            'serie' => $dados['serie'] ?? NFE_SERIE,
            'chave' => $chave,
            'protocolo' => $resultado['protocolo'] ?? '',
            'status' => $resultado['autorizada'] ? 'AUTORIZADA' : 'PROCESSANDO',
            'xml_path' => $caminhoXML,
            'destinatario_nome' => $dados['destinatario']['nome'],
            'destinatario_cpf_cnpj' => $dados['destinatario']['cpf_cnpj'],
            'valor_total' => $dados['totais']['valor_total'],
            'data_emissao' => date('Y-m-d H:i:s')
        ]);
        
        // Mover para aprovados
        if ($resultado['autorizada']) {
            $novoPath = DIR_APROVADOS . basename($caminhoXML);
            rename($caminhoXML, $novoPath);
            $caminhoXML = $novoPath;
        }
    }
    
    echo json_encode([
        'sucesso' => true,
        'chave' => $chave,
        'numero' => $dados['numero'],
        'serie' => $dados['serie'] ?? NFE_SERIE,
        'protocolo' => $resultado['protocolo'] ?? '',
        'status' => $resultado['codigo'],
        'mensagem' => $resultado['motivo'],
        'xml_path' => $caminhoXML,
        'xml' => base64_encode($xmlAssinado),
        'danfe_url' => '/danfe.html?chave=' . $chave
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
}

/**
 * Consulta NFe pela chave
 */
function consultarNFe() {
    $chave = $_GET['chave'] ?? '';
    
    if (strlen($chave) != 44) {
        throw new Exception('Chave de acesso inválida');
    }
    
    $sefaz = new SEFAZ();
    $resultado = $sefaz->consultarNFe($chave);
    
    // Buscar no banco também
    $db = new Database();
    $nfeLocal = $db->buscarPorChave($chave);
    
    echo json_encode([
        'sucesso' => true,
        'chave' => $chave,
        'sefaz' => $resultado,
        'local' => $nfeLocal
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
}

/**
 * Cancela NFe
 */
function cancelarNFe() {
    $dados = json_decode(file_get_contents('php://input'), true);
    
    $chave = $dados['chave'] ?? '';
    $protocolo = $dados['protocolo'] ?? '';
    $justificativa = $dados['justificativa'] ?? '';
    
    if (strlen($chave) != 44) {
        throw new Exception('Chave de acesso inválida');
    }
    
    if (strlen($justificativa) < 15) {
        throw new Exception('Justificativa deve ter no mínimo 15 caracteres');
    }
    
    $sefaz = new SEFAZ();
    $resultado = $sefaz->cancelarNFe($chave, $protocolo, $justificativa);
    
    if ($resultado['sucesso']) {
        $db = new Database();
        $db->atualizarStatus($chave, 'CANCELADA');
    }
    
    echo json_encode([
        'sucesso' => $resultado['sucesso'],
        'mensagem' => $resultado['motivo'],
        'codigo' => $resultado['codigo']
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
}

/**
 * Emite Carta de Correção
 */
function cartaCorrecao() {
    $dados = json_decode(file_get_contents('php://input'), true);
    
    $chave = $dados['chave'] ?? '';
    $correcao = $dados['correcao'] ?? '';
    $nSeqEvento = $dados['sequencia'] ?? 1;
    
    if (strlen($chave) != 44) {
        throw new Exception('Chave de acesso inválida');
    }
    
    $sefaz = new SEFAZ();
    $resultado = $sefaz->cartaCorrecao($chave, $correcao, $nSeqEvento);
    
    echo json_encode([
        'sucesso' => $resultado['sucesso'],
        'mensagem' => $resultado['motivo'],
        'codigo' => $resultado['codigo']
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
}

/**
 * Inutiliza numeração
 */
function inutilizarNumeracao() {
    $dados = json_decode(file_get_contents('php://input'), true);
    
    $ano = $dados['ano'] ?? date('y');
    $serie = $dados['serie'] ?? NFE_SERIE;
    $numeroInicial = $dados['numero_inicial'] ?? 0;
    $numeroFinal = $dados['numero_final'] ?? 0;
    $justificativa = $dados['justificativa'] ?? '';
    
    $sefaz = new SEFAZ();
    $resultado = $sefaz->inutilizarNumeracao($ano, $serie, $numeroInicial, $numeroFinal, $justificativa);
    
    echo json_encode([
        'sucesso' => $resultado['sucesso'],
        'mensagem' => $resultado['motivo'],
        'codigo' => $resultado['codigo']
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
}

/**
 * Consulta status do serviço SEFAZ
 */
function statusServico() {
    $sefaz = new SEFAZ();
    $resultado = $sefaz->consultarStatus();
    
    echo json_encode([
        'online' => $resultado['status'],
        'codigo' => $resultado['codigo'],
        'mensagem' => $resultado['motivo']
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
}

/**
 * Lista NFes emitidas
 */
function listarNFes() {
    $filtros = [
        'data_inicio' => $_GET['data_inicio'] ?? null,
        'data_fim' => $_GET['data_fim'] ?? null,
        'status' => $_GET['status'] ?? null,
        'cliente' => $_GET['cliente'] ?? null,
        'numero' => $_GET['numero'] ?? null,
        'limite' => $_GET['limite'] ?? 50
    ];
    
    $db = new Database();
    $nfes = $db->listar($filtros);
    
    echo json_encode([
        'sucesso' => true,
        'total' => count($nfes),
        'nfes' => $nfes
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
}
