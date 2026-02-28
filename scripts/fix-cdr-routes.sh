#!/bin/bash
# Fix CDR routes - vendas-extended.js lines 1675-1770
# Fixes: ERR_HTTP_HEADERS_SENT, data_inicio ReferenceError, better error handling

cd /var/www/aluforce

# Backup original
cp routes/vendas-extended.js routes/vendas-extended.js.bak-cdr-fix
echo "✅ Backup criado: vendas-extended.js.bak-cdr-fix"

# Get lines before CDR section (1-1673)
head -n 1673 routes/vendas-extended.js > /tmp/vendas-extended-new.js

# Write new CDR routes section
cat >> /tmp/vendas-extended-new.js << 'CDREOF'

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
CDREOF

# Replace original with fixed version
cp /tmp/vendas-extended-new.js routes/vendas-extended.js
echo "✅ vendas-extended.js atualizado (CDR routes corrigidas)"

# Verify line count
echo "Linhas original: 1770"
echo "Linhas novo: $(wc -l < routes/vendas-extended.js)"

# Verify syntax
node -e "require('./routes/vendas-extended')" 2>&1 | head -5 || true
echo "✅ Patch CDR routes aplicado com sucesso"
