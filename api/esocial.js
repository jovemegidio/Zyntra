/**
 * API DO ESOCIAL - ALUFORCE V.2
 * Integração com eSocial
 */

const express = require('express');
const router = express.Router();

let pool;
let authenticateToken;

/**
 * GET /api/esocial/status
 * Status da integração eSocial
 */
router.get('/status', async (req, res) => {
    try {
        const status = {
            ambiente: 'producao_restrita', // producao_restrita ou producao
            certificado_valido: true,
            ultima_transmissao: null,
            eventos_pendentes: 0,
            eventos_enviados_mes: 0,
            versao_leiaute: 'S-1.2'
        };

        try {
            const [pendentes] = await pool.query(`
                SELECT COUNT(*) as total FROM esocial_eventos WHERE status = 'pendente'
            `);
            status.eventos_pendentes = pendentes[0]?.total || 0;

            const [ultima] = await pool.query(`
                SELECT data_envio FROM esocial_eventos 
                WHERE status = 'enviado' 
                ORDER BY data_envio DESC LIMIT 1
            `);
            status.ultima_transmissao = ultima[0]?.data_envio || null;

            const mesAtual = new Date().toISOString().slice(0, 7);
            const [enviados] = await pool.query(`
                SELECT COUNT(*) as total FROM esocial_eventos 
                WHERE status = 'enviado' AND DATE_FORMAT(data_envio, '%Y-%m') = ?
            `, [mesAtual]);
            status.eventos_enviados_mes = enviados[0]?.total || 0;
        } catch (e) {}

        res.json({ success: true, data: status });
    } catch (error) {
        console.error('[ESOCIAL] Erro ao buscar status:', error);
        res.status(500).json({ success: false, error: 'Erro ao buscar status' });
    }
});

/**
 * GET /api/esocial/eventos
 * Lista eventos do eSocial
 */
router.get('/eventos', async (req, res) => {
    try {
        const { tipo, status, funcionario_id, data_inicio, data_fim, limite = 100 } = req.query;

        let query = `
            SELECT 
                e.*,
                f.nome as funcionario_nome,
                f.cpf as funcionario_cpf
            FROM esocial_eventos e
            LEFT JOIN funcionarios f ON e.funcionario_id = f.id
            WHERE 1=1
        `;
        const params = [];

        if (tipo) {
            query += ' AND e.tipo_evento = ?';
            params.push(tipo);
        }
        if (status) {
            query += ' AND e.status = ?';
            params.push(status);
        }
        if (funcionario_id) {
            query += ' AND e.funcionario_id = ?';
            params.push(funcionario_id);
        }
        if (data_inicio) {
            query += ' AND e.created_at >= ?';
            params.push(data_inicio);
        }
        if (data_fim) {
            query += ' AND e.created_at <= ?';
            params.push(data_fim);
        }

        query += ' ORDER BY e.created_at DESC LIMIT ?';
        params.push(parseInt(limite));

        const [eventos] = await pool.query(query, params);
        res.json({ success: true, data: eventos });
    } catch (error) {
        res.json({ success: true, data: [] });
    }
});

/**
 * POST /api/esocial/eventos
 * Cria novo evento do eSocial
 */
router.post('/eventos', async (req, res) => {
    try {
        const {
            tipo_evento,
            funcionario_id,
            competencia,
            dados,
            observacao
        } = req.body;

        if (!tipo_evento) {
            return res.status(400).json({ 
                success: false, 
                error: 'Tipo de evento é obrigatório' 
            });
        }

        const [result] = await pool.query(`
            INSERT INTO esocial_eventos (
                tipo_evento, funcionario_id, competencia, dados, 
                observacao, status, created_at
            ) VALUES (?, ?, ?, ?, ?, 'pendente', NOW())
        `, [
            tipo_evento,
            funcionario_id,
            competencia || new Date().toISOString().slice(0, 7),
            dados ? JSON.stringify(dados) : null,
            observacao
        ]);

        res.json({ 
            success: true, 
            message: 'Evento criado com sucesso',
            data: { id: result.insertId }
        });
    } catch (error) {
        console.error('[ESOCIAL] Erro ao criar evento:', error);
        res.status(500).json({ success: false, error: 'Erro ao criar evento' });
    }
});

/**
 * GET /api/esocial/tipos-eventos
 * Lista tipos de eventos disponíveis
 */
router.get('/tipos-eventos', async (req, res) => {
    res.json({
        success: true,
        data: [
            { codigo: 'S-1000', nome: 'Informações do Empregador', grupo: 'Eventos de Tabelas' },
            { codigo: 'S-1005', nome: 'Tabela de Estabelecimentos', grupo: 'Eventos de Tabelas' },
            { codigo: 'S-1010', nome: 'Tabela de Rubricas', grupo: 'Eventos de Tabelas' },
            { codigo: 'S-1020', nome: 'Tabela de Lotações Tributárias', grupo: 'Eventos de Tabelas' },
            { codigo: 'S-1070', nome: 'Tabela de Processos Administrativos/Judiciais', grupo: 'Eventos de Tabelas' },
            { codigo: 'S-2190', nome: 'Registro Preliminar de Trabalhador', grupo: 'Eventos Não Periódicos' },
            { codigo: 'S-2200', nome: 'Cadastramento Inicial e Admissão', grupo: 'Eventos Não Periódicos' },
            { codigo: 'S-2205', nome: 'Alteração de Dados Cadastrais', grupo: 'Eventos Não Periódicos' },
            { codigo: 'S-2206', nome: 'Alteração de Contrato de Trabalho', grupo: 'Eventos Não Periódicos' },
            { codigo: 'S-2210', nome: 'Comunicação de Acidente de Trabalho', grupo: 'Eventos Não Periódicos' },
            { codigo: 'S-2220', nome: 'Monitoramento da Saúde do Trabalhador', grupo: 'Eventos Não Periódicos' },
            { codigo: 'S-2230', nome: 'Afastamento Temporário', grupo: 'Eventos Não Periódicos' },
            { codigo: 'S-2240', nome: 'Condições Ambientais do Trabalho', grupo: 'Eventos Não Periódicos' },
            { codigo: 'S-2298', nome: 'Reintegração', grupo: 'Eventos Não Periódicos' },
            { codigo: 'S-2299', nome: 'Desligamento', grupo: 'Eventos Não Periódicos' },
            { codigo: 'S-2300', nome: 'Trabalhador Sem Vínculo - Início', grupo: 'Eventos Não Periódicos' },
            { codigo: 'S-2306', nome: 'Trabalhador Sem Vínculo - Alteração', grupo: 'Eventos Não Periódicos' },
            { codigo: 'S-2399', nome: 'Trabalhador Sem Vínculo - Término', grupo: 'Eventos Não Periódicos' },
            { codigo: 'S-2400', nome: 'Cadastro de Benefícios Previdenciários', grupo: 'Eventos Não Periódicos' },
            { codigo: 'S-1200', nome: 'Remuneração de Trabalhador', grupo: 'Eventos Periódicos' },
            { codigo: 'S-1202', nome: 'Remuneração de Servidor', grupo: 'Eventos Periódicos' },
            { codigo: 'S-1207', nome: 'Benefícios Previdenciários', grupo: 'Eventos Periódicos' },
            { codigo: 'S-1210', nome: 'Pagamentos de Rendimentos', grupo: 'Eventos Periódicos' },
            { codigo: 'S-1260', nome: 'Comercialização da Produção Rural PF', grupo: 'Eventos Periódicos' },
            { codigo: 'S-1270', nome: 'Contratação de Trabalhadores Avulsos', grupo: 'Eventos Periódicos' },
            { codigo: 'S-1280', nome: 'Informações Complementares aos Eventos Periódicos', grupo: 'Eventos Periódicos' },
            { codigo: 'S-1298', nome: 'Reabertura dos Eventos Periódicos', grupo: 'Eventos Periódicos' },
            { codigo: 'S-1299', nome: 'Fechamento dos Eventos Periódicos', grupo: 'Eventos Periódicos' },
            { codigo: 'S-3000', nome: 'Exclusão de Eventos', grupo: 'Eventos de Exclusão' }
        ]
    });
});

/**
 * POST /api/esocial/gerar-evento
 * Gera XML do evento
 */
router.post('/gerar-evento', async (req, res) => {
    try {
        const { evento_id, tipo_evento, dados } = req.body;

        if (!tipo_evento) {
            return res.status(400).json({ 
                success: false, 
                error: 'Tipo de evento é obrigatório' 
            });
        }

        // Gerar XML básico (estrutura simplificada)
        const xml = gerarXmlEvento(tipo_evento, dados || {});

        if (evento_id) {
            await pool.query(`
                UPDATE esocial_eventos SET xml_evento = ? WHERE id = ?
            `, [xml, evento_id]);
        }

        res.json({ success: true, data: { xml } });
    } catch (error) {
        console.error('[ESOCIAL] Erro ao gerar evento:', error);
        res.status(500).json({ success: false, error: 'Erro ao gerar evento' });
    }
});

/**
 * POST /api/esocial/enviar/:id
 * Envia evento para o eSocial
 */
router.post('/enviar/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Buscar evento
        const [eventos] = await pool.query(`
            SELECT * FROM esocial_eventos WHERE id = ?
        `, [id]);

        if (!eventos.length) {
            return res.status(404).json({ success: false, error: 'Evento não encontrado' });
        }

        // Simular envio (em produção, usaria webservice do eSocial)
        const protocolo = `REC${Date.now()}`;

        await pool.query(`
            UPDATE esocial_eventos SET
                status = 'enviado',
                protocolo = ?,
                data_envio = NOW()
            WHERE id = ?
        `, [protocolo, id]);

        res.json({ 
            success: true, 
            message: 'Evento enviado com sucesso',
            data: { protocolo }
        });
    } catch (error) {
        console.error('[ESOCIAL] Erro ao enviar evento:', error);
        res.status(500).json({ success: false, error: 'Erro ao enviar evento' });
    }
});

/**
 * GET /api/esocial/consultar/:protocolo
 * Consulta processamento de evento
 */
router.get('/consultar/:protocolo', async (req, res) => {
    try {
        const { protocolo } = req.params;

        const [eventos] = await pool.query(`
            SELECT * FROM esocial_eventos WHERE protocolo = ?
        `, [protocolo]);

        if (!eventos.length) {
            return res.status(404).json({ success: false, error: 'Evento não encontrado' });
        }

        // Simular consulta de processamento
        const evento = eventos[0];
        const resultado = {
            protocolo,
            status: evento.status,
            recibo: evento.recibo || null,
            data_processamento: evento.data_processamento || null,
            ocorrencias: []
        };

        res.json({ success: true, data: resultado });
    } catch (error) {
        console.error('[ESOCIAL] Erro ao consultar evento:', error);
        res.status(500).json({ success: false, error: 'Erro ao consultar evento' });
    }
});

/**
 * GET /api/esocial/funcionarios-pendentes
 * Lista funcionários com eventos pendentes
 */
router.get('/funcionarios-pendentes', async (req, res) => {
    try {
        const [funcionarios] = await pool.query(`
            SELECT DISTINCT
                f.id,
                f.nome,
                f.cpf,
                f.cargo,
                COUNT(e.id) as eventos_pendentes
            FROM funcionarios f
            INNER JOIN esocial_eventos e ON f.id = e.funcionario_id
            WHERE e.status = 'pendente'
            GROUP BY f.id, f.nome, f.cpf, f.cargo
            ORDER BY eventos_pendentes DESC
        `);

        res.json({ success: true, data: funcionarios });
    } catch (error) {
        res.json({ success: true, data: [] });
    }
});

/**
 * GET /api/esocial/estatisticas
 * Estatísticas do eSocial
 */
router.get('/estatisticas', async (req, res) => {
    try {
        const [stats] = await pool.query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'pendente' THEN 1 ELSE 0 END) as pendentes,
                SUM(CASE WHEN status = 'enviado' THEN 1 ELSE 0 END) as enviados,
                SUM(CASE WHEN status = 'processado' THEN 1 ELSE 0 END) as processados,
                SUM(CASE WHEN status = 'erro' THEN 1 ELSE 0 END) as erros
            FROM esocial_eventos
        `);

        // Eventos por tipo
        const [porTipo] = await pool.query(`
            SELECT tipo_evento, COUNT(*) as total
            FROM esocial_eventos
            GROUP BY tipo_evento
            ORDER BY total DESC
            LIMIT 10
        `);

        res.json({ 
            success: true, 
            data: {
                resumo: stats[0] || {},
                por_tipo: porTipo
            }
        });
    } catch (error) {
        res.json({ 
            success: true, 
            data: { resumo: {}, por_tipo: [] }
        });
    }
});

// Função para gerar XML simplificado
function gerarXmlEvento(tipoEvento, dados) {
    const timestamp = new Date().toISOString();
    const id = `ID${Date.now()}`;

    return `<?xml version="1.0" encoding="UTF-8"?>
<eSocial xmlns="http://www.esocial.gov.br/schema/evt/${tipoEvento.replace('S-', 'evt')}/v_S_01_02_00">
    <evtBase Id="${id}">
        <ideEvento>
            <indRetif>1</indRetif>
            <tpAmb>2</tpAmb>
            <procEmi>1</procEmi>
            <verProc>ALUFORCE_V2</verProc>
        </ideEvento>
        <ideEmpregador>
            <tpInsc>1</tpInsc>
            <nrInsc>${dados.cnpj || '00000000000000'}</nrInsc>
        </ideEmpregador>
        <!-- Dados específicos do evento ${tipoEvento} -->
        <dadosEvento>
            ${JSON.stringify(dados)}
        </dadosEvento>
    </evtBase>
</eSocial>`;
}

// Criar tabela de eventos se não existir
async function ensureTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS esocial_eventos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tipo_evento VARCHAR(20) NOT NULL,
                funcionario_id INT,
                competencia VARCHAR(7),
                dados JSON,
                xml_evento LONGTEXT,
                observacao TEXT,
                status ENUM('pendente', 'enviado', 'processado', 'erro') DEFAULT 'pendente',
                protocolo VARCHAR(50),
                recibo VARCHAR(50),
                data_envio DATETIME,
                data_processamento DATETIME,
                retorno_sefaz TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_tipo (tipo_evento),
                INDEX idx_status (status),
                INDEX idx_funcionario (funcionario_id),
                INDEX idx_protocolo (protocolo)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('[ESOCIAL] ✅ Tabela esocial_eventos verificada/criada');
    } catch (error) {
        console.error('[ESOCIAL] Erro ao criar tabela:', error.message);
    }
}

module.exports = function(deps) {
    pool = deps.pool;
    authenticateToken = deps.authenticateToken;
    ensureTable();
    return router;
};
