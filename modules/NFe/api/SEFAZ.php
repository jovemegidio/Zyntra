<?php
/**
 * Classe para comunicação com webservices SEFAZ
 */

require_once __DIR__ . '/config.php';

class SEFAZ {
    private $config;
    private $ambiente;
    private $uf;
    
    public function __construct() {
        $this->config = require __DIR__ . '/config.php';
        $this->ambiente = NFE_AMBIENTE;
        $this->uf = NFE_UF;
    }
    
    /**
     * Consulta status do serviço SEFAZ
     */
    public function consultarStatus() {
        $xml = '<?xml version="1.0" encoding="UTF-8"?>';
        $xml .= '<consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">';
        $xml .= '<tpAmb>' . $this->ambiente . '</tpAmb>';
        $xml .= '<cUF>' . $this->uf . '</cUF>';
        $xml .= '<xServ>STATUS</xServ>';
        $xml .= '</consStatServ>';
        
        $response = $this->enviarRequisicao(WS_NFE_STATUS_SERVICO, $xml, 'nfeStatusServicoNF');
        
        return $this->parseStatusServico($response);
    }
    
    /**
     * Envia NFe para autorização
     */
    public function autorizarNFe($xmlNFe, $idLote = null) {
        $idLote = $idLote ?? time();
        
        $xml = '<?xml version="1.0" encoding="UTF-8"?>';
        $xml .= '<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">';
        $xml .= '<idLote>' . $idLote . '</idLote>';
        $xml .= '<indSinc>1</indSinc>'; // 1=Síncrono
        $xml .= $xmlNFe;
        $xml .= '</enviNFe>';
        
        $response = $this->enviarRequisicao(WS_NFE_AUTORIZACAO, $xml, 'nfeAutorizacaoLote');
        
        return $this->parseAutorizacao($response);
    }
    
    /**
     * Consulta recibo de lote
     */
    public function consultarRecibo($recibo) {
        $xml = '<?xml version="1.0" encoding="UTF-8"?>';
        $xml .= '<consReciNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">';
        $xml .= '<tpAmb>' . $this->ambiente . '</tpAmb>';
        $xml .= '<nRec>' . $recibo . '</nRec>';
        $xml .= '</consReciNFe>';
        
        $response = $this->enviarRequisicao(WS_NFE_RETORNO_AUTORIZACAO, $xml, 'nfeRetAutorizacao');
        
        return $this->parseRetornoAutorizacao($response);
    }
    
    /**
     * Consulta NFe pela chave
     */
    public function consultarNFe($chave) {
        $xml = '<?xml version="1.0" encoding="UTF-8"?>';
        $xml .= '<consSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">';
        $xml .= '<tpAmb>' . $this->ambiente . '</tpAmb>';
        $xml .= '<xServ>CONSULTAR</xServ>';
        $xml .= '<chNFe>' . $chave . '</chNFe>';
        $xml .= '</consSitNFe>';
        
        $response = $this->enviarRequisicao(WS_NFE_CONSULTA_PROTOCOLO, $xml, 'nfeConsultaNF');
        
        return $this->parseConsultaNFe($response);
    }
    
    /**
     * Cancela NFe
     */
    public function cancelarNFe($chave, $protocolo, $justificativa) {
        if (strlen($justificativa) < 15) {
            throw new Exception('Justificativa deve ter no mínimo 15 caracteres');
        }
        
        $nSeqEvento = 1;
        $dhEvento = date('Y-m-d\TH:i:sP');
        
        $xml = '<?xml version="1.0" encoding="UTF-8"?>';
        $xml .= '<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">';
        $xml .= '<idLote>' . time() . '</idLote>';
        $xml .= '<evento versao="1.00">';
        $xml .= '<infEvento Id="ID110111' . $chave . '01">';
        $xml .= '<cOrgao>' . $this->uf . '</cOrgao>';
        $xml .= '<tpAmb>' . $this->ambiente . '</tpAmb>';
        $xml .= '<CNPJ>' . preg_replace('/\D/', '', EMITENTE_CNPJ) . '</CNPJ>';
        $xml .= '<chNFe>' . $chave . '</chNFe>';
        $xml .= '<dhEvento>' . $dhEvento . '</dhEvento>';
        $xml .= '<tpEvento>110111</tpEvento>'; // Cancelamento
        $xml .= '<nSeqEvento>' . $nSeqEvento . '</nSeqEvento>';
        $xml .= '<verEvento>1.00</verEvento>';
        $xml .= '<detEvento versao="1.00">';
        $xml .= '<descEvento>Cancelamento</descEvento>';
        $xml .= '<nProt>' . $protocolo . '</nProt>';
        $xml .= '<xJust>' . substr($justificativa, 0, 255) . '</xJust>';
        $xml .= '</detEvento>';
        $xml .= '</infEvento>';
        $xml .= '</evento>';
        $xml .= '</envEvento>';
        
        // Assinar evento
        $xmlAssinado = $this->assinarEvento($xml);
        
        $response = $this->enviarRequisicao(WS_NFE_EVENTO, $xmlAssinado, 'nfeRecepcaoEvento');
        
        return $this->parseEvento($response);
    }
    
    /**
     * Carta de Correção Eletrônica (CCe)
     */
    public function cartaCorrecao($chave, $correcao, $nSeqEvento = 1) {
        if (strlen($correcao) < 15) {
            throw new Exception('Correção deve ter no mínimo 15 caracteres');
        }
        
        $dhEvento = date('Y-m-d\TH:i:sP');
        
        $xml = '<?xml version="1.0" encoding="UTF-8"?>';
        $xml .= '<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">';
        $xml .= '<idLote>' . time() . '</idLote>';
        $xml .= '<evento versao="1.00">';
        $xml .= '<infEvento Id="ID110110' . $chave . str_pad($nSeqEvento, 2, '0', STR_PAD_LEFT) . '">';
        $xml .= '<cOrgao>' . $this->uf . '</cOrgao>';
        $xml .= '<tpAmb>' . $this->ambiente . '</tpAmb>';
        $xml .= '<CNPJ>' . preg_replace('/\D/', '', EMITENTE_CNPJ) . '</CNPJ>';
        $xml .= '<chNFe>' . $chave . '</chNFe>';
        $xml .= '<dhEvento>' . $dhEvento . '</dhEvento>';
        $xml .= '<tpEvento>110110</tpEvento>'; // CCe
        $xml .= '<nSeqEvento>' . $nSeqEvento . '</nSeqEvento>';
        $xml .= '<verEvento>1.00</verEvento>';
        $xml .= '<detEvento versao="1.00">';
        $xml .= '<descEvento>Carta de Correcao</descEvento>';
        $xml .= '<xCorrecao>' . substr($correcao, 0, 1000) . '</xCorrecao>';
        $xml .= '<xCondUso>A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao de documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que determinam o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da operacao ou da prestacao; II - a correcao de dados cadastrais que implique mudanca do remetente ou do destinatario; III - a data de emissao ou de saida.</xCondUso>';
        $xml .= '</detEvento>';
        $xml .= '</infEvento>';
        $xml .= '</evento>';
        $xml .= '</envEvento>';
        
        // Assinar evento
        $xmlAssinado = $this->assinarEvento($xml);
        
        $response = $this->enviarRequisicao(WS_NFE_EVENTO, $xmlAssinado, 'nfeRecepcaoEvento');
        
        return $this->parseEvento($response);
    }
    
    /**
     * Inutiliza numeração de NFe
     */
    public function inutilizarNumeracao($ano, $serie, $numeroInicial, $numeroFinal, $justificativa) {
        if (strlen($justificativa) < 15) {
            throw new Exception('Justificativa deve ter no mínimo 15 caracteres');
        }
        
        $id = 'ID' . $this->uf . $ano . EMITENTE_CNPJ . '55' . str_pad($serie, 3, '0', STR_PAD_LEFT) . 
              str_pad($numeroInicial, 9, '0', STR_PAD_LEFT) . str_pad($numeroFinal, 9, '0', STR_PAD_LEFT);
        
        $xml = '<?xml version="1.0" encoding="UTF-8"?>';
        $xml .= '<inutNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">';
        $xml .= '<infInut Id="' . $id . '">';
        $xml .= '<tpAmb>' . $this->ambiente . '</tpAmb>';
        $xml .= '<xServ>INUTILIZAR</xServ>';
        $xml .= '<cUF>' . $this->uf . '</cUF>';
        $xml .= '<ano>' . $ano . '</ano>';
        $xml .= '<CNPJ>' . preg_replace('/\D/', '', EMITENTE_CNPJ) . '</CNPJ>';
        $xml .= '<mod>55</mod>';
        $xml .= '<serie>' . $serie . '</serie>';
        $xml .= '<nNFIni>' . $numeroInicial . '</nNFIni>';
        $xml .= '<nNFFin>' . $numeroFinal . '</nNFFin>';
        $xml .= '<xJust>' . substr($justificativa, 0, 255) . '</xJust>';
        $xml .= '</infInut>';
        $xml .= '</inutNFe>';
        
        // Assinar inutilização
        $xmlAssinado = $this->assinarInutilizacao($xml);
        
        $response = $this->enviarRequisicao(WS_NFE_INUTILIZACAO, $xmlAssinado, 'nfeInutilizacaoNF');
        
        return $this->parseInutilizacao($response);
    }
    
    /**
     * Envia requisição SOAP para SEFAZ
     */
    private function enviarRequisicao($url, $xmlDados, $metodo) {
        // Preparar envelope SOAP
        $soapEnvelope = '<?xml version="1.0" encoding="UTF-8"?>';
        $soapEnvelope .= '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">';
        $soapEnvelope .= '<soap:Header>';
        $soapEnvelope .= '<nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/' . $metodo . '">';
        $soapEnvelope .= '<cUF>' . $this->uf . '</cUF>';
        $soapEnvelope .= '<versaoDados>4.00</versaoDados>';
        $soapEnvelope .= '</nfeCabecMsg>';
        $soapEnvelope .= '</soap:Header>';
        $soapEnvelope .= '<soap:Body>';
        $soapEnvelope .= '<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/' . $metodo . '">';
        $soapEnvelope .= $xmlDados;
        $soapEnvelope .= '</nfeDadosMsg>';
        $soapEnvelope .= '</soap:Body>';
        $soapEnvelope .= '</soap:Envelope>';
        
        // Log da requisição
        $this->log('REQUEST', $url, $soapEnvelope);
        
        // Configurar CURL com certificado
        $ch = curl_init();
        
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $soapEnvelope);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Content-Type: application/soap+xml; charset=utf-8',
            'SOAPAction: "http://www.portalfiscal.inf.br/nfe/wsdl/' . $metodo . '"'
        ]);
        
        // Certificado SSL
        if (file_exists(CERTIFICADO_ARQUIVO)) {
            $pfxContent = file_get_contents(CERTIFICADO_ARQUIVO);
            $certs = [];
            
            if (openssl_pkcs12_read($pfxContent, $certs, CERTIFICADO_SENHA)) {
                // Salvar temporariamente certificado e chave
                $certFile = sys_get_temp_dir() . '/cert.pem';
                $keyFile = sys_get_temp_dir() . '/key.pem';
                
                file_put_contents($certFile, $certs['cert']);
                file_put_contents($keyFile, $certs['pkey']);
                
                curl_setopt($ch, CURLOPT_SSLCERT, $certFile);
                curl_setopt($ch, CURLOPT_SSLKEY, $keyFile);
            }
        }
        
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, TIMEOUT_CONEXAO);
        curl_setopt($ch, CURLOPT_TIMEOUT, TIMEOUT_RESPOSTA);
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        
        curl_close($ch);
        
        // Limpar arquivos temporários
        if (isset($certFile) && file_exists($certFile)) unlink($certFile);
        if (isset($keyFile) && file_exists($keyFile)) unlink($keyFile);
        
        if ($error) {
            throw new Exception('Erro CURL: ' . $error);
        }
        
        if ($httpCode != 200) {
            throw new Exception('HTTP Error: ' . $httpCode);
        }
        
        // Log da resposta
        $this->log('RESPONSE', $url, $response);
        
        return $response;
    }
    
    /**
     * Assina evento XML
     */
    private function assinarEvento($xml) {
        // Implementação simplificada - usar biblioteca de assinatura XML completa em produção
        return $xml;
    }
    
    /**
     * Assina inutilização XML
     */
    private function assinarInutilizacao($xml) {
        // Implementação simplificada - usar biblioteca de assinatura XML completa em produção
        return $xml;
    }
    
    /**
     * Parse resposta status serviço
     */
    private function parseStatusServico($xml) {
        $dom = new DOMDocument();
        $dom->loadXML($xml);
        
        $cStat = $dom->getElementsByTagName('cStat')->item(0)->nodeValue ?? '';
        $xMotivo = $dom->getElementsByTagName('xMotivo')->item(0)->nodeValue ?? '';
        
        return [
            'status' => $cStat == '107',
            'codigo' => $cStat,
            'motivo' => $xMotivo,
            'xml' => $xml
        ];
    }
    
    /**
     * Parse resposta autorização
     */
    private function parseAutorizacao($xml) {
        $dom = new DOMDocument();
        $dom->loadXML($xml);
        
        $cStat = $dom->getElementsByTagName('cStat')->item(0)->nodeValue ?? '';
        $xMotivo = $dom->getElementsByTagName('xMotivo')->item(0)->nodeValue ?? '';
        $recibo = $dom->getElementsByTagName('nRec')->item(0)->nodeValue ?? '';
        
        return [
            'sucesso' => in_array($cStat, ['100', '104']),
            'codigo' => $cStat,
            'motivo' => $xMotivo,
            'recibo' => $recibo,
            'xml' => $xml
        ];
    }
    
    /**
     * Parse retorno autorização
     */
    private function parseRetornoAutorizacao($xml) {
        $dom = new DOMDocument();
        $dom->loadXML($xml);
        
        $cStat = $dom->getElementsByTagName('cStat')->item(0)->nodeValue ?? '';
        $xMotivo = $dom->getElementsByTagName('xMotivo')->item(0)->nodeValue ?? '';
        $protocolo = $dom->getElementsByTagName('nProt')->item(0)->nodeValue ?? '';
        $chave = $dom->getElementsByTagName('chNFe')->item(0)->nodeValue ?? '';
        
        return [
            'autorizada' => $cStat == '100',
            'codigo' => $cStat,
            'motivo' => $xMotivo,
            'protocolo' => $protocolo,
            'chave' => $chave,
            'xml' => $xml
        ];
    }
    
    /**
     * Parse consulta NFe
     */
    private function parseConsultaNFe($xml) {
        $dom = new DOMDocument();
        $dom->loadXML($xml);
        
        $cStat = $dom->getElementsByTagName('cStat')->item(0)->nodeValue ?? '';
        $xMotivo = $dom->getElementsByTagName('xMotivo')->item(0)->nodeValue ?? '';
        
        return [
            'encontrada' => $cStat == '100',
            'codigo' => $cStat,
            'motivo' => $xMotivo,
            'xml' => $xml
        ];
    }
    
    /**
     * Parse evento (cancelamento/CCe)
     */
    private function parseEvento($xml) {
        $dom = new DOMDocument();
        $dom->loadXML($xml);
        
        $cStat = $dom->getElementsByTagName('cStat')->item(0)->nodeValue ?? '';
        $xMotivo = $dom->getElementsByTagName('xMotivo')->item(0)->nodeValue ?? '';
        
        return [
            'sucesso' => in_array($cStat, ['135', '136']),
            'codigo' => $cStat,
            'motivo' => $xMotivo,
            'xml' => $xml
        ];
    }
    
    /**
     * Parse inutilização
     */
    private function parseInutilizacao($xml) {
        $dom = new DOMDocument();
        $dom->loadXML($xml);
        
        $cStat = $dom->getElementsByTagName('cStat')->item(0)->nodeValue ?? '';
        $xMotivo = $dom->getElementsByTagName('xMotivo')->item(0)->nodeValue ?? '';
        
        return [
            'sucesso' => $cStat == '102',
            'codigo' => $cStat,
            'motivo' => $xMotivo,
            'xml' => $xml
        ];
    }
    
    /**
     * Registra log de comunicação
     */
    private function log($tipo, $url, $dados) {
        $timestamp = date('Y-m-d H:i:s');
        $logFile = DIR_LOGS . date('Y-m-d') . '.log';
        
        $logContent = "\n" . str_repeat('=', 80) . "\n";
        $logContent .= "[$timestamp] $tipo\n";
        $logContent .= "URL: $url\n";
        $logContent .= str_repeat('-', 80) . "\n";
        $logContent .= $dados . "\n";
        
        file_put_contents($logFile, $logContent, FILE_APPEND);
    }
}
