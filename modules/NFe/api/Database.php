<?php
/**
 * Classe para gerenciamento de banco de dados
 */

class Database {
    private $conn;
    
    public function __construct() {
        try {
            $this->conn = new PDO(
                "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4",
                DB_USER,
                DB_PASS,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
            );
            
            $this->criarTabelas();
        } catch (PDOException $e) {
            // Se não houver BD configurado, usar SQLite temporário
            $this->conn = new PDO('sqlite:' . DIR_LOGS . 'nfe.db');
            $this->conn->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            $this->criarTabelasSQLite();
        }
    }
    
    /**
     * Cria tabelas MySQL
     */
    private function criarTabelas() {
        $sql = "CREATE TABLE IF NOT EXISTS nfes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            numero INT NOT NULL,
            serie INT NOT NULL,
            chave VARCHAR(44) UNIQUE NOT NULL,
            protocolo VARCHAR(20),
            status ENUM('PROCESSANDO', 'AUTORIZADA', 'REJEITADA', 'CANCELADA', 'DENEGADA') DEFAULT 'PROCESSANDO',
            xml_path VARCHAR(255),
            destinatario_nome VARCHAR(255),
            destinatario_cpf_cnpj VARCHAR(18),
            valor_total DECIMAL(15,2),
            data_emissao DATETIME,
            data_autorizacao DATETIME,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_numero (numero, serie),
            INDEX idx_chave (chave),
            INDEX idx_status (status),
            INDEX idx_data (data_emissao)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
        
        $this->conn->exec($sql);
        
        // Tabela de eventos (cancelamento, CCe, etc)
        $sql = "CREATE TABLE IF NOT EXISTS nfe_eventos (
            id INT AUTO_INCREMENT PRIMARY KEY,
            chave VARCHAR(44) NOT NULL,
            tipo_evento VARCHAR(10),
            sequencia INT,
            descricao TEXT,
            protocolo VARCHAR(20),
            data_evento DATETIME,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_chave (chave),
            FOREIGN KEY (chave) REFERENCES nfes(chave)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
        
        $this->conn->exec($sql);
        
        // Tabela de numeração
        $sql = "CREATE TABLE IF NOT EXISTS nfe_numeracao (
            id INT AUTO_INCREMENT PRIMARY KEY,
            serie INT NOT NULL UNIQUE,
            ultimo_numero INT DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
        
        $this->conn->exec($sql);
    }
    
    /**
     * Cria tabelas SQLite (fallback)
     */
    private function criarTabelasSQLite() {
        $sql = "CREATE TABLE IF NOT EXISTS nfes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            numero INTEGER NOT NULL,
            serie INTEGER NOT NULL,
            chave VARCHAR(44) UNIQUE NOT NULL,
            protocolo VARCHAR(20),
            status VARCHAR(20) DEFAULT 'PROCESSANDO',
            xml_path VARCHAR(255),
            destinatario_nome VARCHAR(255),
            destinatario_cpf_cnpj VARCHAR(18),
            valor_total DECIMAL(15,2),
            data_emissao DATETIME,
            data_autorizacao DATETIME,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )";
        
        $this->conn->exec($sql);
        
        $sql = "CREATE TABLE IF NOT EXISTS nfe_eventos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chave VARCHAR(44) NOT NULL,
            tipo_evento VARCHAR(10),
            sequencia INTEGER,
            descricao TEXT,
            protocolo VARCHAR(20),
            data_evento DATETIME,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )";
        
        $this->conn->exec($sql);
        
        $sql = "CREATE TABLE IF NOT EXISTS nfe_numeracao (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            serie INTEGER NOT NULL UNIQUE,
            ultimo_numero INTEGER DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )";
        
        $this->conn->exec($sql);
    }
    
    /**
     * Obtém próximo número disponível
     */
    public function proximoNumero($serie = 1) {
        $this->conn->beginTransaction();
        
        try {
            $stmt = $this->conn->prepare("SELECT ultimo_numero FROM nfe_numeracao WHERE serie = ?");
            $stmt->execute([$serie]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            
            if ($row) {
                $proximo = $row['ultimo_numero'] + 1;
                $stmt = $this->conn->prepare("UPDATE nfe_numeracao SET ultimo_numero = ? WHERE serie = ?");
                $stmt->execute([$proximo, $serie]);
            } else {
                $proximo = NFE_NUMERO_INICIAL;
                $stmt = $this->conn->prepare("INSERT INTO nfe_numeracao (serie, ultimo_numero) VALUES (?, ?)");
                $stmt->execute([$serie, $proximo]);
            }
            
            $this->conn->commit();
            return $proximo;
            
        } catch (Exception $e) {
            $this->conn->rollBack();
            throw $e;
        }
    }
    
    /**
     * Salva NFe no banco
     */
    public function salvarNFe($dados) {
        $sql = "INSERT INTO nfes (
            numero, serie, chave, protocolo, status, xml_path,
            destinatario_nome, destinatario_cpf_cnpj, valor_total, data_emissao
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
        
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([
            $dados['numero'],
            $dados['serie'],
            $dados['chave'],
            $dados['protocolo'] ?? null,
            $dados['status'] ?? 'PROCESSANDO',
            $dados['xml_path'] ?? null,
            $dados['destinatario_nome'] ?? '',
            $dados['destinatario_cpf_cnpj'] ?? '',
            $dados['valor_total'] ?? 0,
            $dados['data_emissao'] ?? date('Y-m-d H:i:s')
        ]);
        
        return $this->conn->lastInsertId();
    }
    
    /**
     * Busca NFe por chave
     */
    public function buscarPorChave($chave) {
        $stmt = $this->conn->prepare("SELECT * FROM nfes WHERE chave = ?");
        $stmt->execute([$chave]);
        return $stmt->fetch(PDO::FETCH_ASSOC);
    }
    
    /**
     * Atualiza status da NFe
     */
    public function atualizarStatus($chave, $status, $protocolo = null) {
        if ($protocolo) {
            $stmt = $this->conn->prepare("UPDATE nfes SET status = ?, protocolo = ?, data_autorizacao = NOW() WHERE chave = ?");
            $stmt->execute([$status, $protocolo, $chave]);
        } else {
            $stmt = $this->conn->prepare("UPDATE nfes SET status = ? WHERE chave = ?");
            $stmt->execute([$status, $chave]);
        }
    }
    
    /**
     * Lista NFes com filtros
     */
    public function listar($filtros = []) {
        $sql = "SELECT * FROM nfes WHERE 1=1";
        $params = [];
        
        if (!empty($filtros['data_inicio'])) {
            $sql .= " AND data_emissao >= ?";
            $params[] = $filtros['data_inicio'];
        }
        
        if (!empty($filtros['data_fim'])) {
            $sql .= " AND data_emissao <= ?";
            $params[] = $filtros['data_fim'] . ' 23:59:59';
        }
        
        if (!empty($filtros['status'])) {
            $sql .= " AND status = ?";
            $params[] = $filtros['status'];
        }
        
        if (!empty($filtros['cliente'])) {
            $sql .= " AND destinatario_nome LIKE ?";
            $params[] = '%' . $filtros['cliente'] . '%';
        }
        
        if (!empty($filtros['numero'])) {
            $sql .= " AND numero = ?";
            $params[] = $filtros['numero'];
        }
        
        $sql .= " ORDER BY data_emissao DESC LIMIT " . intval($filtros['limite'] ?? 50);
        
        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }
    
    /**
     * Salva evento (cancelamento, CCe)
     */
    public function salvarEvento($chave, $tipo, $sequencia, $descricao, $protocolo = null) {
        $sql = "INSERT INTO nfe_eventos (chave, tipo_evento, sequencia, descricao, protocolo, data_evento) 
                VALUES (?, ?, ?, ?, ?, NOW())";
        
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([$chave, $tipo, $sequencia, $descricao, $protocolo]);
        
        return $this->conn->lastInsertId();
    }
}
