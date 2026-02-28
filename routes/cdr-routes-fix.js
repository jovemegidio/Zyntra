// CDR Routes fix patch - replaces lines 1675-1770 of vendas-extended.js
// Fixes:
// 1. ERR_HTTP_HEADERS_SENT in /ligacoes/dispositivos (added return after res.json)
// 2. ReferenceError: data_inicio is not defined in /ligacoes/resumo catch block
// 3. Better error handling throughout

    // ========================================
    // LIGAÇÕES - CDR Scraper via Puppeteer
    // ========================================
    const cdrScraper = require('../services/cdr-scraper');

    // GET /ligacoes/status
    router.get('/ligacoes/status', authorizeArea('vendas'), async (req, res) => {
        try {
            const status = cdrScraper.getStatus();
            res.json(status);
        } catch (error) {
            res.json({ configurado: false, erro: error.message });
        }
    });

    // GET /ligacoes/dispositivos
    router.get('/ligacoes/dispositivos', authorizeArea('vendas'), async (req, res) => {
        try {
            const { data_inicio, data_fim } = req.query;
            const ramais = await cdrScraper.listarRamais(data_inicio, data_fim);
            return res.json(ramais);
        } catch (error) {
            console.error('Erro ao listar ramais CDR:', error.message);
            // Fallback: retornar lista estática de ramais quando scraper falha
            const RAMAL_NOMES = cdrScraper.RAMAL_NOMES || {};
            const fallback = Object.entries(RAMAL_NOMES).map(([id, name]) => ({
                username: id, name, callerid: `${name} (${id})`, id
            }));
            return res.json(fallback);
        }
    });

    // GET /ligacoes/cdr
    router.get('/ligacoes/cdr', authorizeArea('vendas'), async (req, res) => {
        try {
            const { data_inicio, data_fim, ramal, tipo } = req.query;

            const hoje = new Date().toISOString().split('T')[0];
            const di = data_inicio || hoje;
            const df = data_fim || hoje;

            let chamadas = await cdrScraper.fetchCDRData(di, df);

            if (ramal) {
                chamadas = chamadas.filter(c => c.ramal === ramal || c.origem === ramal);
            }
            if (tipo === 'movel') {
                chamadas = chamadas.filter(c => c.subtipo === 'movel');
            } else if (tipo === 'fixo') {
                chamadas = chamadas.filter(c => c.subtipo === 'fixo');
            }

            res.json({
                total: chamadas.length,
                chamadas,
                periodo: { inicio: di, fim: df }
            });
        } catch (error) {
            console.error('Erro ao buscar CDR:', error.message);
            res.status(500).json({ error: error.message, chamadas: [], total: 0 });
        }
    });

    // GET /ligacoes/online
    router.get('/ligacoes/online', authorizeArea('vendas'), async (req, res) => {
        res.json({ total: 0, chamadas: [] });
    });

    // GET /ligacoes/resumo
    router.get('/ligacoes/resumo', authorizeArea('vendas'), async (req, res) => {
        try {
            const { data_inicio, data_fim } = req.query;

            const hoje = new Date().toISOString().split('T')[0];
            const di = data_inicio || hoje;
            const df = data_fim || hoje;

            const chamadas = await cdrScraper.fetchCDRData(di, df);
            const resumo = cdrScraper.gerarResumo(chamadas);
            resumo.periodo = { inicio: di, fim: df };

            res.json(resumo);
        } catch (error) {
            console.error('Erro ao gerar resumo de ligações:', error.message);
            // Fallback: retornar resumo vazio em vez de 500
            const hoje = new Date().toISOString().split('T')[0];
            res.json({
                total: 0, realizadas: 0, atendidas: 0, nao_atendidas: 0,
                duracao_total: 0, por_ramal: {},
                periodo: {
                    inicio: req.query.data_inicio || hoje,
                    fim: req.query.data_fim || hoje
                },
                erro: error.message
            });
        }
    });

    // ======================================
    // FIM DAS ROTAS DO MÓDULO VENDAS
    // ======================================


    return router;
};
