/**
 * CDR Scraper Service - SAC Plataforma IP (sip10.tsinfo.net.br)
 * Usa Puppeteer para fazer login e extrair dados do relatório de ligações
 * 
 * @author ALUFORCE System
 * @version 1.0.0
 */
const puppeteer = require('puppeteer-core');

// Configurações
const CDR_CONFIG = {
    url: process.env.CDR_PABX_URL || 'https://sip10.tsinfo.net.br',
    username: process.env.CDR_PABX_USER || 'Labor@',
    password: process.env.CDR_PABX_PASS || 'F.0582#9d5c?',
    chromiumPath: process.env.CHROMIUM_PATH || '/snap/bin/chromium'
};

// Mapeamento de ramais para nomes dos operadores
const RAMAL_NOMES = {
    'Labor_4207': 'Augusto',
    'Labor_4202': 'Renata',
    'Labor_4203': 'Fabíola',
    'Labor_1428': 'Márcia',
    'Labor_4206': 'João Victor',
    'Labor_4205': 'Ronaldo Torres',
    'Labor_4201': 'Fabiano Marques'
};

// Cache de dados para evitar scraping excessivo
let cdrDataCache = { data: null, timestamp: 0, dateKey: '', ttl: 5 * 60 * 1000 }; // 5 min TTL
let browserInstance = null;
let pageInstance = null;
let isLoggedIn = false;
let lastLoginTime = 0;
const LOGIN_TTL = 30 * 60 * 1000; // 30 min session TTL

/**
 * Obtém ou reutiliza instância do browser
 */
async function getBrowser() {
    if (browserInstance && browserInstance.isConnected()) {
        return browserInstance;
    }
    
    console.log('[CDR-Scraper] Iniciando browser Chromium...');
    browserInstance = await puppeteer.launch({
        executablePath: CDR_CONFIG.chromiumPath,
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-web-security',
            '--ignore-certificate-errors',
            '--disable-extensions',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'
        ]
    });
    
    isLoggedIn = false;
    pageInstance = null;
    return browserInstance;
}

/**
 * Obtém uma página logada no sistema
 */
async function getLoggedInPage() {
    const browser = await getBrowser();
    const now = Date.now();
    
    // Verificar se a sessão ainda é válida
    if (pageInstance && isLoggedIn && (now - lastLoginTime) < LOGIN_TTL) {
        try {
            // Teste rápido se a página ainda está ativa
            await pageInstance.title();
            return pageInstance;
        } catch (e) {
            console.log('[CDR-Scraper] Sessão expirada, fazendo novo login...');
            isLoggedIn = false;
        }
    }
    
    // Criar nova página ou reutilizar
    if (!pageInstance) {
        pageInstance = await browser.newPage();
        await pageInstance.setViewport({ width: 1920, height: 1080 });
    }
    
    // Fazer login
    console.log('[CDR-Scraper] Fazendo login em', CDR_CONFIG.url);
    await pageInstance.goto(CDR_CONFIG.url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Preencher formulário
    await pageInstance.type('#username', CDR_CONFIG.username, { delay: 20 });
    await pageInstance.type('#password', CDR_CONFIG.password, { delay: 20 });
    
    // Submit
    await Promise.all([
        pageInstance.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
        pageInstance.click('button[type="submit"]')
    ]);
    
    await new Promise(r => setTimeout(r, 2000));
    
    // Verificar se logou
    const currentUrl = pageInstance.url();
    if (currentUrl.includes('dashboard') || currentUrl.includes('customer')) {
        isLoggedIn = true;
        lastLoginTime = now;
        console.log('[CDR-Scraper] Login bem-sucedido!');
    } else {
        throw new Error('Falha no login CDR. URL: ' + currentUrl);
    }
    
    return pageInstance;
}

/**
 * Formata data para o formato esperado pelo sistema (DD/MM/YYYY)
 */
function formatDate(dateStr) {
    // Se já está no formato DD/MM/YYYY, retornar
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) return dateStr;
    
    // Se está no formato YYYY-MM-DD (ISO)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const [y, m, d] = dateStr.split('-');
        return `${d}/${m}/${y}`;
    }
    
    // Tentar parsear como Date
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
    }
    
    return dateStr;
}

/**
 * Converte duração em texto ("X min Y seg") para segundos
 */
function parseDuracao(tempoStr) {
    if (!tempoStr) return 0;
    let totalSeconds = 0;
    const minMatch = tempoStr.match(/(\d+)\s*min/);
    const segMatch = tempoStr.match(/(\d+)\s*seg/);
    if (minMatch) totalSeconds += parseInt(minMatch[1]) * 60;
    if (segMatch) totalSeconds += parseInt(segMatch[1]);
    return totalSeconds;
}

/**
 * Busca dados de CDR (ligações efetuadas) para um período
 * @param {string} dataInicio - Data início (YYYY-MM-DD ou DD/MM/YYYY)
 * @param {string} dataFim - Data fim (YYYY-MM-DD ou DD/MM/YYYY)
 * @param {string} tipo - Tipo de chamada: '' (todas), '1' (IP x IP), '2' (Fixo), '3' (Móvel)
 * @param {string} filtro - Filtro de origem/destino
 * @returns {Promise<Array>} Array de registros CDR
 */
async function fetchCDRData(dataInicio, dataFim, tipo = '0', filtro = '') {
    const dataI = formatDate(dataInicio);
    const dataF = formatDate(dataFim);
    const cacheKey = `${dataI}_${dataF}_${tipo}_${filtro}`;
    
    // Verificar cache
    const now = Date.now();
    if (cdrDataCache.data && cdrDataCache.dateKey === cacheKey && (now - cdrDataCache.timestamp) < cdrDataCache.ttl) {
        console.log('[CDR-Scraper] Usando cache (', cdrDataCache.data.length, 'registros)');
        return cdrDataCache.data;
    }
    
    const page = await getLoggedInPage();
    
    console.log(`[CDR-Scraper] Buscando CDR de ${dataI} a ${dataF}...`);
    
    // Navegar para o relatório de ligações via menu
    // Primeiro, garantir que estamos no dashboard
    if (!page.url().includes('dashboard')) {
        await page.goto(CDR_CONFIG.url + '/dashboard/customer/index', { waitUntil: 'networkidle2', timeout: 15000 });
        await new Promise(r => setTimeout(r, 1000));
    }
    
    // Clicar no menu Relatórios
    await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        for (const link of links) {
            if (link.innerText.trim() === 'Relatórios') {
                link.click();
                break;
            }
        }
    });
    await new Promise(r => setTimeout(r, 800));
    
    // Clicar em Ligações Efetuadas
    await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        for (const link of links) {
            const text = link.innerText.trim();
            if (text.includes('Liga') && text.includes('Efetuadas')) {
                link.click();
                break;
            }
        }
    });
    await new Promise(r => setTimeout(r, 3000));
    
    // Agora fazer a requisição AJAX diretamente no contexto da página
    const allRecords = [];
    let currentPage = 1;
    let hasMore = true;
    
    while (hasMore) {
        const pageData = await page.evaluate(async (params) => {
            const { dataI, dataF, tipo, filtro, pageNum } = params;
            const urlParams = new URLSearchParams({
                DATAI_TMP: dataI,
                DATAF_TMP: dataF,
                SORT_DIRECTION: 'DESC',
                SORT_CHANGE: '',
                SORT_TAG: 'data_index',
                PAGE: String(pageNum),
                txtDataI: dataI,
                txtDataF: dataF,
                txtTipo: tipo || '0',
                txtFiltro: filtro || ''
            });
            
            const response = await fetch(`/relatorioLigacoes/data?${Math.random()}&${urlParams.toString()}`, {
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
            const html = await response.text();
            
            // Parse HTML to extract table data
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            // Extrair informação de paginação
            const paginationText = doc.body.innerText;
            const match = paginationText.match(/Exibindo de (\d+) .* (\d+) de (\d+)/);
            const pagination = match ? { from: parseInt(match[1]), to: parseInt(match[2]), total: parseInt(match[3]) } : null;
            
            // Extrair dados da tabela
            const rows = doc.querySelectorAll('table tr');
            const records = [];
            rows.forEach((row, idx) => {
                if (idx === 0) return; // Skip header
                const cells = Array.from(row.querySelectorAll('td'));
                if (cells.length >= 6) {
                    records.push({
                        data: cells[0].innerText.trim(),
                        origem: cells[1].innerText.trim(),
                        destino: cells[2].innerText.trim(),
                        cidade: cells[3].innerText.trim(),
                        tempo: cells[4].innerText.trim(),
                        valor: cells[5].innerText.trim()
                    });
                }
            });
            
            // Check for "Nenhum registro"
            const noRecords = html.includes('Nenhum registro');
            
            return { records, pagination, noRecords };
        }, { dataI, dataF, tipo, filtro, pageNum: currentPage });
        
        if (pageData.noRecords || pageData.records.length === 0) {
            hasMore = false;
        } else {
            allRecords.push(...pageData.records);
            
            // Verificar se tem mais páginas
            if (pageData.pagination && pageData.pagination.to < pageData.pagination.total) {
                currentPage++;
            } else {
                hasMore = false;
            }
        }
    }
    
    // Processar os registros para formato padronizado
    const processedRecords = allRecords.map(r => {
        const duracaoSegundos = parseDuracao(r.tempo);
        
        // Determinar tipo de ligação pela cidade/região
        let tipoLigacao = 'saida';
        const cidadeLower = (r.cidade || '').toLowerCase();
        const isMobile = cidadeLower.includes('móvel') || cidadeLower.includes('movel');
        const isFixed = cidadeLower.includes('telemar') || cidadeLower.includes('telefônica') || cidadeLower.includes('telefonica') || cidadeLower.includes('gvt') || cidadeLower.includes('claro fixo') || cidadeLower.includes('oi fixo');
        const isIPxIP = cidadeLower.includes('ip x ip') || cidadeLower.includes('ip');
        
        let subTipo = 'outro';
        if (isMobile) subTipo = 'movel';
        else if (isFixed) subTipo = 'fixo';
        else if (isIPxIP) subTipo = 'ip';
        
        return {
            data: r.data,
            dataISO: converterDataParaISO(r.data),
            origem: r.origem,
            ramal: r.origem, // alias
            nomeOperador: RAMAL_NOMES[r.origem] || r.origem,
            destino: r.destino,
            cidade: r.cidade,
            tempo: r.tempo,
            duracao: duracaoSegundos,
            valor: parseFloat((r.valor || '0').replace(',', '.')) || 0,
            tipo: tipoLigacao,
            subtipo: subTipo,
            status: duracaoSegundos > 0 ? 'ANSWERED' : 'NO ANSWER'
        };
    });
    
    // Atualizar cache
    cdrDataCache = { data: processedRecords, timestamp: now, dateKey: cacheKey, ttl: 5 * 60 * 1000 };
    
    console.log(`[CDR-Scraper] ${processedRecords.length} registros obtidos`);
    return processedRecords;
}

/**
 * Converte data "DD/MM/YYYY HH:MM" para ISO
 */
function converterDataParaISO(dataStr) {
    try {
        const parts = dataStr.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
        if (parts) {
            return `${parts[3]}-${parts[2]}-${parts[1]}T${parts[4]}:${parts[5]}:00`;
        }
    } catch (e) {}
    return dataStr;
}

/**
 * Gera resumo/estatísticas das ligações
 */
function gerarResumo(registros) {
    const total = registros.length;
    const atendidas = registros.filter(r => r.status === 'ANSWERED').length;
    const naoAtendidas = registros.filter(r => r.status === 'NO ANSWER').length;
    const duracaoTotal = registros.reduce((sum, r) => sum + r.duracao, 0);
    const valorTotal = registros.reduce((sum, r) => sum + r.valor, 0);
    
    // Agrupar por ramal
    const porRamal = {};
    registros.forEach(r => {
        const ramal = r.ramal || 'Desconhecido';
        const nomeOp = RAMAL_NOMES[ramal] || ramal;
        if (!porRamal[ramal]) {
            porRamal[ramal] = { realizadas: 0, recebidas: 0, duracao: 0, valor: 0, nome: nomeOp };
        }
        porRamal[ramal].realizadas++;
        porRamal[ramal].duracao += r.duracao;
        porRamal[ramal].valor += r.valor;
    });
    
    // Agrupar por subtipo
    const porTipo = {};
    registros.forEach(r => {
        const st = r.subtipo || 'outro';
        if (!porTipo[st]) porTipo[st] = { count: 0, duracao: 0, valor: 0 };
        porTipo[st].count++;
        porTipo[st].duracao += r.duracao;
        porTipo[st].valor += r.valor;
    });
    
    // Agrupar por hora (para gráfico)
    const porHora = {};
    registros.forEach(r => {
        const match = r.data.match(/(\d{2}):\d{2}$/);
        if (match) {
            const hora = match[1] + ':00';
            if (!porHora[hora]) porHora[hora] = 0;
            porHora[hora]++;
        }
    });
    
    return {
        total,
        realizadas: total, // Todas são "efetuadas" neste relatório
        entrantes: 0, // Este relatório é só de saída
        atendidas,
        nao_atendidas: naoAtendidas,
        duracao_total: duracaoTotal,
        valor_total: valorTotal,
        por_ramal: porRamal,
        por_tipo: porTipo,
        por_hora: porHora
    };
}

/**
 * Lista os ramais (dispositivos) conhecidos
 */
async function listarRamais(dataInicio, dataFim) {
    const hoje = new Date();
    const di = dataInicio || hoje.toISOString().split('T')[0];
    const df = dataFim || hoje.toISOString().split('T')[0];
    
    const dados = await fetchCDRData(di, df);
    const ramais = [...new Set(dados.map(r => r.ramal))].filter(Boolean).sort();
    
    return ramais.map(r => ({
        username: r,
        name: RAMAL_NOMES[r] || r,
        callerid: RAMAL_NOMES[r] ? `${RAMAL_NOMES[r]} (${r})` : r,
        id: r
    }));
}

/**
 * Fecha o browser (para limpeza)
 */
async function closeBrowser() {
    if (browserInstance) {
        try {
            await browserInstance.close();
        } catch (e) {}
        browserInstance = null;
        pageInstance = null;
        isLoggedIn = false;
    }
}

/**
 * Verifica se o serviço está configurado e funcional
 */
function getStatus() {
    return {
        configurado: !!(CDR_CONFIG.url && CDR_CONFIG.username && CDR_CONFIG.password),
        url: CDR_CONFIG.url,
        username: CDR_CONFIG.username ? CDR_CONFIG.username.substring(0, 3) + '***' : '',
        browserAtivo: browserInstance ? browserInstance.isConnected() : false,
        logado: isLoggedIn,
        ultimoLogin: lastLoginTime ? new Date(lastLoginTime).toISOString() : null,
        cacheAtivo: !!(cdrDataCache.data && (Date.now() - cdrDataCache.timestamp) < cdrDataCache.ttl),
        cacheRegistros: cdrDataCache.data ? cdrDataCache.data.length : 0,
        mensagem: 'Integração CDR via Web Scraping (Puppeteer)'
    };
}

// Cleanup ao encerrar o processo
process.on('exit', closeBrowser);
process.on('SIGINT', closeBrowser);
process.on('SIGTERM', closeBrowser);

module.exports = {
    fetchCDRData,
    gerarResumo,
    listarRamais,
    closeBrowser,
    getStatus,
    CDR_CONFIG,
    RAMAL_NOMES
};
