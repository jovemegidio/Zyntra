<?php
/**
 * Classe para geração e transmissão de NFe
 * Baseado no layout NFe 4.0
 */

require_once __DIR__ . '/config.php';

class NFe {
    private $config;
    private $nfe_data;
    private $xml;
    private $chave_acesso;
    
    public function __construct() {
        $this->config = require __DIR__ . '/config.php';
    }
    
    /**
     * Define os dados da NFe
     */
    public function setDados($dados) {
        $this->nfe_data = $dados;
        return $this;
    }
    
    /**
     * Gera o XML da NFe no padrão 4.0
     */
    public function gerarXML() {
        if (empty($this->nfe_data)) {
            throw new Exception('Dados da NFe não informados');
        }
        
        // Gerar chave de acesso
        $this->chave_acesso = $this->gerarChaveAcesso();
        
        // Criar estrutura XML
        $xml = new DOMDocument('1.0', 'UTF-8');
        $xml->formatOutput = false;
        $xml->preserveWhiteSpace = false;
        
        // NFe (raiz)
        $nfe = $xml->createElement('NFe');
        $nfe->setAttribute('xmlns', 'http://www.portalfiscal.inf.br/nfe');
        
        // infNFe
        $infNFe = $xml->createElement('infNFe');
        $infNFe->setAttribute('Id', 'NFe' . $this->chave_acesso);
        $infNFe->setAttribute('versao', '4.00');
        
        // Identificação (ide)
        $ide = $this->criarIdentificacao($xml);
        $infNFe->appendChild($ide);
        
        // Emitente (emit)
        $emit = $this->criarEmitente($xml);
        $infNFe->appendChild($emit);
        
        // Destinatário (dest)
        $dest = $this->criarDestinatario($xml);
        $infNFe->appendChild($dest);
        
        // Produtos/Serviços (det)
        foreach ($this->nfe_data['produtos'] as $index => $produto) {
            $det = $this->criarProduto($xml, $produto, $index);
            $infNFe->appendChild($det);
        }
        
        // Total (total)
        $total = $this->criarTotal($xml);
        $infNFe->appendChild($total);
        
        // Transporte (transp)
        $transp = $this->criarTransporte($xml);
        $infNFe->appendChild($transp);
        
        // Pagamento (pag)
        $pag = $this->criarPagamento($xml);
        $infNFe->appendChild($pag);
        
        // Informações Adicionais (infAdic)
        if (!empty($this->nfe_data['informacoes_adicionais'])) {
            $infAdic = $this->criarInformacoesAdicionais($xml);
            $infNFe->appendChild($infAdic);
        }
        
        $nfe->appendChild($infNFe);
        $xml->appendChild($nfe);
        
        $this->xml = $xml->saveXML();
        
        return $this->xml;
    }
    
    /**
     * Gera a chave de acesso de 44 dígitos
     */
    private function gerarChaveAcesso() {
        $cUF = str_pad(NFE_UF, 2, '0', STR_PAD_LEFT);
        $AAMM = date('ym');
        $CNPJ = str_pad(preg_replace('/\D/', '', EMITENTE_CNPJ), 14, '0', STR_PAD_LEFT);
        $mod = '55'; // Modelo 55 = NFe
        $serie = str_pad($this->nfe_data['serie'] ?? NFE_SERIE, 3, '0', STR_PAD_LEFT);
        $nNF = str_pad($this->nfe_data['numero'], 9, '0', STR_PAD_LEFT);
        $tpEmis = '1'; // 1=Normal
        $cNF = str_pad(rand(10000000, 99999999), 8, '0', STR_PAD_LEFT);
        
        $chave = $cUF . $AAMM . $CNPJ . $mod . $serie . $nNF . $tpEmis . $cNF;
        
        // Calcular DV (Dígito Verificador)
        $dv = $this->calcularDV($chave);
        
        return $chave . $dv;
    }
    
    /**
     * Calcula o dígito verificador da chave
     */
    private function calcularDV($chave) {
        $multiplicadores = [2,3,4,5,6,7,8,9];
        $soma = 0;
        $pos = 0;
        
        for ($i = strlen($chave) - 1; $i >= 0; $i--) {
            $soma += $chave[$i] * $multiplicadores[$pos];
            $pos = ($pos + 1) % 8;
        }
        
        $resto = $soma % 11;
        return ($resto == 0 || $resto == 1) ? 0 : (11 - $resto);
    }
    
    /**
     * Cria o nó de identificação da NFe
     */
    private function criarIdentificacao($xml) {
        $ide = $xml->createElement('ide');
        
        $this->addElement($xml, $ide, 'cUF', NFE_UF);
        $this->addElement($xml, $ide, 'cNF', substr($this->chave_acesso, 35, 8));
        $this->addElement($xml, $ide, 'natOp', $this->nfe_data['natureza_operacao']);
        $this->addElement($xml, $ide, 'mod', '55');
        $this->addElement($xml, $ide, 'serie', $this->nfe_data['serie'] ?? NFE_SERIE);
        $this->addElement($xml, $ide, 'nNF', $this->nfe_data['numero']);
        $this->addElement($xml, $ide, 'dhEmi', date('Y-m-d\TH:i:sP'));
        $this->addElement($xml, $ide, 'dhSaiEnt', date('Y-m-d\TH:i:sP'));
        $this->addElement($xml, $ide, 'tpNF', $this->nfe_data['tipo'] ?? '1'); // 0=Entrada, 1=Saída
        $this->addElement($xml, $ide, 'idDest', $this->nfe_data['destino'] ?? '1'); // 1=Operação interna
        $this->addElement($xml, $ide, 'cMunFG', EMITENTE_CODIGO_MUNICIPIO);
        $this->addElement($xml, $ide, 'tpImp', '1'); // 1=Retrato
        $this->addElement($xml, $ide, 'tpEmis', '1'); // 1=Normal
        $this->addElement($xml, $ide, 'cDV', substr($this->chave_acesso, -1));
        $this->addElement($xml, $ide, 'tpAmb', NFE_AMBIENTE);
        $this->addElement($xml, $ide, 'finNFe', $this->nfe_data['finalidade'] ?? '1'); // 1=Normal
        $this->addElement($xml, $ide, 'indFinal', $this->nfe_data['consumidor_final'] ?? '0');
        $this->addElement($xml, $ide, 'indPres', $this->nfe_data['presenca'] ?? '1');
        $this->addElement($xml, $ide, 'procEmi', '0'); // 0=Aplicativo contribuinte
        $this->addElement($xml, $ide, 'verProc', '1.0.0');
        
        return $ide;
    }
    
    /**
     * Cria o nó do emitente
     */
    private function criarEmitente($xml) {
        $emit = $xml->createElement('emit');
        
        $this->addElement($xml, $emit, 'CNPJ', preg_replace('/\D/', '', EMITENTE_CNPJ));
        $this->addElement($xml, $emit, 'xNome', EMITENTE_RAZAO_SOCIAL);
        
        if (!empty(EMITENTE_NOME_FANTASIA)) {
            $this->addElement($xml, $emit, 'xFant', EMITENTE_NOME_FANTASIA);
        }
        
        // Endereço
        $enderEmit = $xml->createElement('enderEmit');
        $this->addElement($xml, $enderEmit, 'xLgr', EMITENTE_LOGRADOURO);
        $this->addElement($xml, $enderEmit, 'nro', EMITENTE_NUMERO);
        if (!empty(EMITENTE_COMPLEMENTO)) {
            $this->addElement($xml, $enderEmit, 'xCpl', EMITENTE_COMPLEMENTO);
        }
        $this->addElement($xml, $enderEmit, 'xBairro', EMITENTE_BAIRRO);
        $this->addElement($xml, $enderEmit, 'cMun', EMITENTE_CODIGO_MUNICIPIO);
        $this->addElement($xml, $enderEmit, 'xMun', EMITENTE_MUNICIPIO);
        $this->addElement($xml, $enderEmit, 'UF', EMITENTE_UF);
        $this->addElement($xml, $enderEmit, 'CEP', preg_replace('/\D/', '', EMITENTE_CEP));
        $this->addElement($xml, $enderEmit, 'cPais', '1058');
        $this->addElement($xml, $enderEmit, 'xPais', 'BRASIL');
        if (!empty(EMITENTE_TELEFONE)) {
            $this->addElement($xml, $enderEmit, 'fone', preg_replace('/\D/', '', EMITENTE_TELEFONE));
        }
        $emit->appendChild($enderEmit);
        
        $this->addElement($xml, $emit, 'IE', preg_replace('/\D/', '', EMITENTE_IE));
        
        if (!empty(EMITENTE_IM)) {
            $this->addElement($xml, $emit, 'IM', EMITENTE_IM);
        }
        
        $this->addElement($xml, $emit, 'CRT', EMITENTE_CRT);
        
        return $emit;
    }
    
    /**
     * Cria o nó do destinatário
     */
    private function criarDestinatario($xml) {
        $dest = $xml->createElement('dest');
        $destinatario = $this->nfe_data['destinatario'];
        
        // CPF ou CNPJ
        if (strlen(preg_replace('/\D/', '', $destinatario['cpf_cnpj'])) == 11) {
            $this->addElement($xml, $dest, 'CPF', preg_replace('/\D/', '', $destinatario['cpf_cnpj']));
        } else {
            $this->addElement($xml, $dest, 'CNPJ', preg_replace('/\D/', '', $destinatario['cpf_cnpj']));
        }
        
        $this->addElement($xml, $dest, 'xNome', $destinatario['nome']);
        
        // Endereço
        $enderDest = $xml->createElement('enderDest');
        $this->addElement($xml, $enderDest, 'xLgr', $destinatario['logradouro']);
        $this->addElement($xml, $enderDest, 'nro', $destinatario['numero']);
        if (!empty($destinatario['complemento'])) {
            $this->addElement($xml, $enderDest, 'xCpl', $destinatario['complemento']);
        }
        $this->addElement($xml, $enderDest, 'xBairro', $destinatario['bairro']);
        $this->addElement($xml, $enderDest, 'cMun', $destinatario['codigo_municipio']);
        $this->addElement($xml, $enderDest, 'xMun', $destinatario['municipio']);
        $this->addElement($xml, $enderDest, 'UF', $destinatario['uf']);
        $this->addElement($xml, $enderDest, 'CEP', preg_replace('/\D/', '', $destinatario['cep']));
        $this->addElement($xml, $enderDest, 'cPais', '1058');
        $this->addElement($xml, $enderDest, 'xPais', 'BRASIL');
        if (!empty($destinatario['telefone'])) {
            $this->addElement($xml, $enderDest, 'fone', preg_replace('/\D/', '', $destinatario['telefone']));
        }
        $dest->appendChild($enderDest);
        
        $this->addElement($xml, $dest, 'indIEDest', $destinatario['indicador_ie'] ?? '9');
        
        if (!empty($destinatario['ie'])) {
            $this->addElement($xml, $dest, 'IE', preg_replace('/\D/', '', $destinatario['ie']));
        }
        
        if (!empty($destinatario['email'])) {
            $this->addElement($xml, $dest, 'email', $destinatario['email']);
        }
        
        return $dest;
    }
    
    /**
     * Cria o nó de produto
     */
    private function criarProduto($xml, $produto, $index) {
        $det = $xml->createElement('det');
        $det->setAttribute('nItem', $index + 1);
        
        // Produto
        $prod = $xml->createElement('prod');
        $this->addElement($xml, $prod, 'cProd', $produto['codigo']);
        $this->addElement($xml, $prod, 'cEAN', $produto['ean'] ?? 'SEM GTIN');
        $this->addElement($xml, $prod, 'xProd', $produto['descricao']);
        $this->addElement($xml, $prod, 'NCM', $produto['ncm']);
        
        if (!empty($produto['cest'])) {
            $this->addElement($xml, $prod, 'CEST', $produto['cest']);
        }
        
        $this->addElement($xml, $prod, 'CFOP', $produto['cfop']);
        $this->addElement($xml, $prod, 'uCom', $produto['unidade']);
        $this->addElement($xml, $prod, 'qCom', number_format($produto['quantidade'], 4, '.', ''));
        $this->addElement($xml, $prod, 'vUnCom', number_format($produto['valor_unitario'], 10, '.', ''));
        $this->addElement($xml, $prod, 'vProd', number_format($produto['valor_total'], 2, '.', ''));
        $this->addElement($xml, $prod, 'cEANTrib', $produto['ean'] ?? 'SEM GTIN');
        $this->addElement($xml, $prod, 'uTrib', $produto['unidade']);
        $this->addElement($xml, $prod, 'qTrib', number_format($produto['quantidade'], 4, '.', ''));
        $this->addElement($xml, $prod, 'vUnTrib', number_format($produto['valor_unitario'], 10, '.', ''));
        $this->addElement($xml, $prod, 'indTot', '1');
        $det->appendChild($prod);
        
        // Imposto
        $imposto = $xml->createElement('imposto');
        
        // ICMS
        $ICMS = $xml->createElement('ICMS');
        $tipoICMS = $xml->createElement($produto['icms']['cst_tipo']); // Ex: ICMS00, ICMS10, etc
        $this->addElement($xml, $tipoICMS, 'orig', $produto['icms']['origem']);
        $this->addElement($xml, $tipoICMS, 'CST', $produto['icms']['cst']);
        $this->addElement($xml, $tipoICMS, 'modBC', $produto['icms']['mod_bc'] ?? '3');
        $this->addElement($xml, $tipoICMS, 'vBC', number_format($produto['icms']['base_calculo'], 2, '.', ''));
        $this->addElement($xml, $tipoICMS, 'pICMS', number_format($produto['icms']['aliquota'], 2, '.', ''));
        $this->addElement($xml, $tipoICMS, 'vICMS', number_format($produto['icms']['valor'], 2, '.', ''));
        $ICMS->appendChild($tipoICMS);
        $imposto->appendChild($ICMS);
        
        // PIS
        $PIS = $xml->createElement('PIS');
        $tipoPIS = $xml->createElement($produto['pis']['cst_tipo']);
        $this->addElement($xml, $tipoPIS, 'CST', $produto['pis']['cst']);
        $this->addElement($xml, $tipoPIS, 'vBC', number_format($produto['pis']['base_calculo'], 2, '.', ''));
        $this->addElement($xml, $tipoPIS, 'pPIS', number_format($produto['pis']['aliquota'], 2, '.', ''));
        $this->addElement($xml, $tipoPIS, 'vPIS', number_format($produto['pis']['valor'], 2, '.', ''));
        $PIS->appendChild($tipoPIS);
        $imposto->appendChild($PIS);
        
        // COFINS
        $COFINS = $xml->createElement('COFINS');
        $tipoCOFINS = $xml->createElement($produto['cofins']['cst_tipo']);
        $this->addElement($xml, $tipoCOFINS, 'CST', $produto['cofins']['cst']);
        $this->addElement($xml, $tipoCOFINS, 'vBC', number_format($produto['cofins']['base_calculo'], 2, '.', ''));
        $this->addElement($xml, $tipoCOFINS, 'pCOFINS', number_format($produto['cofins']['aliquota'], 2, '.', ''));
        $this->addElement($xml, $tipoCOFINS, 'vCOFINS', number_format($produto['cofins']['valor'], 2, '.', ''));
        $COFINS->appendChild($tipoCOFINS);
        $imposto->appendChild($COFINS);
        
        $det->appendChild($imposto);
        
        return $det;
    }
    
    /**
     * Cria o nó de total
     */
    private function criarTotal($xml) {
        $total = $xml->createElement('total');
        $ICMSTot = $xml->createElement('ICMSTot');
        
        $totais = $this->nfe_data['totais'];
        
        $this->addElement($xml, $ICMSTot, 'vBC', number_format($totais['base_icms'], 2, '.', ''));
        $this->addElement($xml, $ICMSTot, 'vICMS', number_format($totais['valor_icms'], 2, '.', ''));
        $this->addElement($xml, $ICMSTot, 'vICMSDeson', '0.00');
        $this->addElement($xml, $ICMSTot, 'vFCP', '0.00');
        $this->addElement($xml, $ICMSTot, 'vBCST', '0.00');
        $this->addElement($xml, $ICMSTot, 'vST', '0.00');
        $this->addElement($xml, $ICMSTot, 'vFCPST', '0.00');
        $this->addElement($xml, $ICMSTot, 'vFCPSTRet', '0.00');
        $this->addElement($xml, $ICMSTot, 'vProd', number_format($totais['valor_produtos'], 2, '.', ''));
        $this->addElement($xml, $ICMSTot, 'vFrete', number_format($totais['valor_frete'] ?? 0, 2, '.', ''));
        $this->addElement($xml, $ICMSTot, 'vSeg', number_format($totais['valor_seguro'] ?? 0, 2, '.', ''));
        $this->addElement($xml, $ICMSTot, 'vDesc', number_format($totais['valor_desconto'] ?? 0, 2, '.', ''));
        $this->addElement($xml, $ICMSTot, 'vII', '0.00');
        $this->addElement($xml, $ICMSTot, 'vIPI', number_format($totais['valor_ipi'] ?? 0, 2, '.', ''));
        $this->addElement($xml, $ICMSTot, 'vIPIDevol', '0.00');
        $this->addElement($xml, $ICMSTot, 'vPIS', number_format($totais['valor_pis'], 2, '.', ''));
        $this->addElement($xml, $ICMSTot, 'vCOFINS', number_format($totais['valor_cofins'], 2, '.', ''));
        $this->addElement($xml, $ICMSTot, 'vOutro', number_format($totais['outras_despesas'] ?? 0, 2, '.', ''));
        $this->addElement($xml, $ICMSTot, 'vNF', number_format($totais['valor_total'], 2, '.', ''));
        
        $total->appendChild($ICMSTot);
        return $total;
    }
    
    /**
     * Cria o nó de transporte
     */
    private function criarTransporte($xml) {
        $transp = $xml->createElement('transp');
        
        $this->addElement($xml, $transp, 'modFrete', $this->nfe_data['transporte']['modalidade'] ?? '9');
        
        if (!empty($this->nfe_data['transporte']['transportadora'])) {
            $transporta = $xml->createElement('transporta');
            $t = $this->nfe_data['transporte']['transportadora'];
            
            if (!empty($t['cnpj'])) {
                $this->addElement($xml, $transporta, 'CNPJ', preg_replace('/\D/', '', $t['cnpj']));
            }
            if (!empty($t['nome'])) {
                $this->addElement($xml, $transporta, 'xNome', $t['nome']);
            }
            if (!empty($t['ie'])) {
                $this->addElement($xml, $transporta, 'IE', $t['ie']);
            }
            if (!empty($t['endereco'])) {
                $this->addElement($xml, $transporta, 'xEnder', $t['endereco']);
            }
            if (!empty($t['municipio'])) {
                $this->addElement($xml, $transporta, 'xMun', $t['municipio']);
            }
            if (!empty($t['uf'])) {
                $this->addElement($xml, $transporta, 'UF', $t['uf']);
            }
            
            $transp->appendChild($transporta);
        }
        
        return $transp;
    }
    
    /**
     * Cria o nó de pagamento
     */
    private function criarPagamento($xml) {
        $pag = $xml->createElement('pag');
        
        foreach ($this->nfe_data['pagamento'] as $pagamento) {
            $detPag = $xml->createElement('detPag');
            $this->addElement($xml, $detPag, 'indPag', $pagamento['indicador'] ?? '0');
            $this->addElement($xml, $detPag, 'tPag', $pagamento['forma']);
            $this->addElement($xml, $detPag, 'vPag', number_format($pagamento['valor'], 2, '.', ''));
            $pag->appendChild($detPag);
        }
        
        return $pag;
    }
    
    /**
     * Cria o nó de informações adicionais
     */
    private function criarInformacoesAdicionais($xml) {
        $infAdic = $xml->createElement('infAdic');
        
        if (!empty($this->nfe_data['informacoes_adicionais'])) {
            $this->addElement($xml, $infAdic, 'infCpl', $this->nfe_data['informacoes_adicionais']);
        }
        
        return $infAdic;
    }
    
    /**
     * Helper para adicionar elemento XML
     */
    private function addElement($xml, $parent, $name, $value) {
        $element = $xml->createElement($name, htmlspecialchars($value ?? '', ENT_XML1));
        $parent->appendChild($element);
        return $element;
    }
    
    /**
     * Assina o XML com certificado digital
     */
    public function assinarXML() {
        if (empty($this->xml)) {
            throw new Exception('XML não gerado. Execute gerarXML() primeiro.');
        }
        
        if (!file_exists(CERTIFICADO_ARQUIVO)) {
            throw new Exception('Certificado digital não encontrado em: ' . CERTIFICADO_ARQUIVO);
        }
        
        // Carregar certificado
        $pfxContent = file_get_contents(CERTIFICADO_ARQUIVO);
        $certs = [];
        
        if (!openssl_pkcs12_read($pfxContent, $certs, CERTIFICADO_SENHA)) {
            throw new Exception('Erro ao ler certificado digital. Verifique a senha.');
        }
        
        $privateKey = $certs['pkey'];
        $publicKey = $certs['cert'];
        
        // Assinar XML usando XMLDSig
        $dom = new DOMDocument();
        $dom->loadXML($this->xml);
        
        // Encontrar o nó infNFe
        $infNFe = $dom->getElementsByTagName('infNFe')->item(0);
        
        if (!$infNFe) {
            throw new Exception('Nó infNFe não encontrado no XML');
        }
        
        // Canonicalizar
        $canonicalData = $infNFe->C14N(false, false);
        
        // Calcular digest SHA1
        $digestValue = base64_encode(hash('sha1', $canonicalData, true));
        
        // Criar assinatura
        $signedInfo = '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">';
        $signedInfo .= '<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>';
        $signedInfo .= '<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>';
        $signedInfo .= '<Reference URI="#NFe' . $this->chave_acesso . '">';
        $signedInfo .= '<Transforms>';
        $signedInfo .= '<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>';
        $signedInfo .= '<Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>';
        $signedInfo .= '</Transforms>';
        $signedInfo .= '<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>';
        $signedInfo .= '<DigestValue>' . $digestValue . '</DigestValue>';
        $signedInfo .= '</Reference>';
        $signedInfo .= '</SignedInfo>';
        
        // Assinar SignedInfo
        $signatureValue = '';
        openssl_sign($signedInfo, $signatureValue, $privateKey, OPENSSL_ALGO_SHA1);
        $signatureValue = base64_encode($signatureValue);
        
        // Extrair certificado X509
        $x509Data = str_replace(['-----BEGIN CERTIFICATE-----', '-----END CERTIFICATE-----', "\n", "\r"], '', $publicKey);
        
        // Criar nó Signature
        $signature = $dom->createElementNS('http://www.w3.org/2000/09/xmldsig#', 'Signature');
        
        $signedInfoNode = $dom->createDocumentFragment();
        $signedInfoNode->appendXML($signedInfo);
        $signature->appendChild($signedInfoNode);
        
        $signatureValueNode = $dom->createElement('SignatureValue', $signatureValue);
        $signature->appendChild($signatureValueNode);
        
        $keyInfo = $dom->createElement('KeyInfo');
        $x509DataNode = $dom->createElement('X509Data');
        $x509Certificate = $dom->createElement('X509Certificate', $x509Data);
        $x509DataNode->appendChild($x509Certificate);
        $keyInfo->appendChild($x509DataNode);
        $signature->appendChild($keyInfo);
        
        // Adicionar Signature ao infNFe
        $infNFe->appendChild($signature);
        
        $this->xml = $dom->saveXML();
        
        return $this->xml;
    }
    
    /**
     * Salva o XML assinado
     */
    public function salvarXML($diretorio = null) {
        if (empty($this->xml)) {
            throw new Exception('XML não gerado');
        }
        
        $dir = $diretorio ?? DIR_XMLS;
        $filename = $this->chave_acesso . '-nfe.xml';
        $filepath = $dir . $filename;
        
        if (file_put_contents($filepath, $this->xml) === false) {
            throw new Exception('Erro ao salvar XML em: ' . $filepath);
        }
        
        return $filepath;
    }
    
    /**
     * Retorna a chave de acesso gerada
     */
    public function getChaveAcesso() {
        return $this->chave_acesso;
    }
    
    /**
     * Retorna o XML gerado
     */
    public function getXML() {
        return $this->xml;
    }
}
