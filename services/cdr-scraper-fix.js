/**
 * CDR Scraper Service - SAC Plataforma IP (sip10.tsinfo.net.br)
 * Usa Puppeteer para fazer login e extrair dados do relatório de ligações
 *
 * @author ALUFORCE System
 * @version 1.1.0 - Fix timeout + fallback HTTP direto
 */
const puppeteer = require('puppeteer-core');
const https = require('https');

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

// Cookies da sessão para fallback HTTP direto
let sessionCookies = null;

// Mutex para evitar login concorrente
let loginPromise = null;
let fetchPromise = null;

/**
 * Obtém ou reutiliza instância do browser
 */
async function getBrowser() {
    if (browserInstance && browserInstance.isConnected()) {
        return browserInstance;
    }

    // Fechar instância antiga se existir
    if (browserInstance) {
        try { await browserInstance.close(); } catch (e) {}
        browserInstance = null;
        pageInstance = null;
        isLoggedIn = false;
    }

    console.log('[CDR-Scraper] Iniciando browser Chromium...');
    browserInstance = await puppeteer.launch({
        executablePath: CDR_CONFIG.chromiumPath,
        headless: 'new',
        protocolTimeout: 120000, // 120s protocol timeout (fix timeout error)
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
            '--disable-renderer-backgrounding',
            '--single-process',
            '--no-zygote'
        ]
    });

    isLoggedIn = false;
    pageInstance = null;
    return browserInstance;
}

/**
 * Obtém uma página logada no sistema (com mutex para evitar login concorrente)
 */
async function getLoggedInPage() {
    // Se já há um login em andamento, esperar
    if (loginPromise) {
        console.log('[CDR-Scraper] Login já em andamento, aguardando...');
        await loginPromise;
        if (pageInstance && isLoggedIn) return pageInstance;
    }

    const browser = await getBrowser();
    const now = Date.now();

    // Verificar se a sessão ainda é válida
    if (pageInstance && isLoggedIn && (now - lastLoginTime) < LOGIN_TTL) {
        try {
            await pageInstance.title();
            return pageInstance;
        } catch (e) {
            console.log('[CDR-Scraper] Sessão expirada, fazendo novo login...');
            isLoggedIn = false;
            try { await pageInstance.close(); } catch (e2) {}
            pageInstance = null;
        }
    }

    // Iniciar login com mutex
    loginPromise = _doLogin(browser, now);
    try {
        await loginPromise;
        return pageInstance;
    } finally {
        loginPromise = null;
    }
}

/**
 * Realiza o login efetivo (chamado internamente com mutex)
 */
async function _doLogin(browser, now) {
    // Sempre criar página nova para login limpo
    if (pageInstance) {
        try { await pageInstance.close(); } catch (e) {}
        pageInstance = null;
    }

    pageInstance = await browser.newPage();
    await pageInstance.setViewport({ width: 1920, height: 1080 });
    pageInstance.setDefaultNavigationTimeout(30000);
    pageInstance.setDefaultTimeout(60000);

    // Tentar login até 2 vezes
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            console.log('[CDR-Scraper] Fazendo login em', CDR_CONFIG.url, '(tentativa', attempt + ')');
            await pageInstance.goto(CDR_CONFIG.url, { waitUntil: 'networkidle2', timeout: 30000 });

            // Limpar campos (em caso de retry)
            await pageInstance.evaluate(() => {
                const u = document.querySelector('#username');
                const p = document.querySelector('#password');
                if (u) u.value = '';
                if (p) p.value = '';
            });

            // Preencher formulário
            await pageInstance.type('#username', CDR_CONFIG.username, { delay: 30 });
            await pageInstance.type('#password', CDR_CONFIG.password, { delay: 30 });

            // Submit
            await Promise.all([
                pageInstance.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
                pageInstance.click('button[type="submit"]')
            ]);

            await new Promise(r => setTimeout(r, 3000));

            // Verificar se logou
            const currentUrl = pageInstance.url();
            if (currentUrl.includes('dashboard') || currentUrl.includes('customer')) {
                isLoggedIn = true;
                lastLoginTime = now;
                console.log('[CDR-Scraper] Login bem-sucedido!');

                // Salvar cookies para fallback HTTP direto
                try {
                    const cookies = await pageInstance.cookies();
                    sessionCookies = cookies.map(c => `${c.name}=${c.value}`).join('; ');
                    console.log('[CDR-Scraper] Cookies de sessão salvos para fallback HTTP');
                } catch (e) {
                    console.log('[CDR-Scraper] Aviso: não conseguiu salvar cookies:', e.message);
                }
                return pageInstance;
            }

            console.log('[CDR-Scraper] Login falhou, URL:', currentUrl);
            if (attempt < 2) {
                await new Promise(r => setTimeout(r, 2000));
            }
        } catch (loginError) {
            console.error('[CDR-Scraper] Erro no login (tentativa ' + attempt + '):', loginError.message);
            if (attempt < 2) {
                // Recriar página para tentativa limpa
                try { await pageInstance.close(); } catch (e) {}
                pageInstance = await browser.newPage();
                await pageInstance.setViewport({ width: 1920, height: 1080 });
                pageInstance.setDefaultNavigationTimeout(30000);
                pageInstance.setDefaultTimeout(60000);
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }

    throw new Error('Falha no login CDR após 2 tentativas. URL: ' + (pageInstance ? pageInstance.url() : 'N/A'));
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
 * Fallback: Faz requisição HTTP direta usando cookies da sessão Puppeteer
 */
function fetchCDRViaHTTP(dataI, dataF, tipo, filtro, pageNum) {
    return new Promise((resolve, reject) => {
        if (!sessionCookies) {
            return reject(new Error('Sem cookies de sessão para fallback HTTP'));
        }

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

        const urlPath = `/relatorioLigacoes/data?${Math.random()}&${urlParams.toString()}`;
        const baseUrl = new URL(CDR_CONFIG.url);

        const options = {
            hostname: baseUrl.hostname,
            port: 443,
            path: urlPath,
            method: 'GET',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Cookie': sessionCookies,
                'Accept': 'text/html, */*',
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
            },
            rejectUnauthorized: false,
            timeout: 30000
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode === 302 || res.statusCode === 401) {
                    return reject(new Error('Sessão expirada no fallback HTTP'));
                }
                resolve(data);
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout HTTP fallback')); });
        req.end();
    });
}

/**
 * Parse HTML de resposta CDR para extrair registros
 */
function parseHTMLRecords(html) {
    // Check for "Nenhum registro"
    if (html.includes('Nenhum registro')) {
        return { records: [], pagination: null, noRecords: true };
    }

    // Parse usando regex (Node.js não tem DOMParser)
    const records = [];
    // Buscar linhas <tr> com <td>
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    let rowIndex = 0;

    while ((rowMatch = rowRegex.exec(html)) !== null) {
        if (rowIndex === 0) { rowIndex++; continue; } // Skip header
        rowIndex++;

        const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        const cells = [];
        let cellMatch;
        while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
            // Limpar tags HTML internas
            cells.push(cellMatch[1].replace(/<[^>]*>/g, '').trim());
        }

        if (cells.length >= 6) {
            records.push({
                data: cells[0],
                origem: cells[1],
                destino: cells[2],
                cidade: cells[3],
                tempo: cells[4],
                valor: cells[5]
            });
        }
    }

    // Extrair paginação
    let pagination = null;
    const paginationMatch = html.match(/Exibindo de (\d+).*?(\d+) de (\d+)/);
    if (paginationMatch) {
        pagination = {
            from: parseInt(paginationMatch[1]),
            to: parseInt(paginationMatch[2]),
            total: parseInt(paginationMatch[3])
        };
    }

    return { records, pagination, noRecords: false };
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

    // Se já há uma busca em andamento, aguardar e reutilizar resultado
    if (fetchPromise) {
        console.log('[CDR-Scraper] Busca CDR já em andamento, aguardando resultado...');
        try {
            await fetchPromise;
            // Verificar cache novamente após aguardar
            if (cdrDataCache.data && cdrDataCache.dateKey === cacheKey && (now - cdrDataCache.timestamp) < cdrDataCache.ttl) {
                return cdrDataCache.data;
            }
        } catch (e) {
            // Busca anterior falhou, tentar novamente
        }
    }

    // Executar busca com mutex
    fetchPromise = _doFetchCDR(dataI, dataF, tipo, filtro, cacheKey);
    try {
        return await fetchPromise;
    } finally {
        fetchPromise = null;
    }
}

/**
 * Execução real da busca CDR (chamado internamente com mutex)
 */
async function _doFetchCDR(dataI, dataF, tipo, filtro, cacheKey) {
    const now = Date.now();

    // Garantir que temos uma sessão logada
    const page = await getLoggedInPage();

    console.log(`[CDR-Scraper] Buscando CDR de ${dataI} a ${dataF}...`);

    const allRecords = [];
    let currentPage = 1;
    let hasMore = true;
    let useFallback = false;

    // Primeiro: tentar navegar para o relatório (necessário para primeira chamada)
    try {
        // Garantir que estamos no dashboard
        if (!page.url().includes('dashboard') && !page.url().includes('relatorio')) {
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
    } catch (navError) {
        console.log('[CDR-Scraper] Erro na navegação, usando fallback HTTP:', navError.message);
        useFallback = true;
    }

    while (hasMore) {
        try {
            let pageData;

            if (!useFallback) {
                // Método 1: page.evaluate com timeout protegido
                const evaluatePromise = page.evaluate(async (params) => {
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

                // Timeout de 60 segundos para o evaluate
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('evaluate timeout 60s')), 60000)
                );

                try {
                    pageData = await Promise.race([evaluatePromise, timeoutPromise]);
                } catch (evalError) {
                    console.log('[CDR-Scraper] page.evaluate falhou, mudando para fallback HTTP:', evalError.message);
                    useFallback = true;
                    // Tentar via HTTP
                    const html = await fetchCDRViaHTTP(dataI, dataF, tipo, filtro, currentPage);
                    pageData = parseHTMLRecords(html);
                }
            } else {
                // Método 2: Fallback HTTP direto usando cookies da sessão
                console.log(`[CDR-Scraper] Usando fallback HTTP (página ${currentPage})...`);
                const html = await fetchCDRViaHTTP(dataI, dataF, tipo, filtro, currentPage);
                pageData = parseHTMLRecords(html);
            }

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
        } catch (fetchError) {
            console.error('[CDR-Scraper] Erro na busca (página ' + currentPage + '):', fetchError.message);
            hasMore = false;

            // Se a sessão expirou, resetar login
            if (fetchError.message.includes('expirada') || fetchError.message.includes('302')) {
                isLoggedIn = false;
                sessionCookies = null;
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

    try {
        const dados = await fetchCDRData(di, df);
        const ramais = [...new Set(dados.map(r => r.ramal))].filter(Boolean).sort();

        // Combinar ramais encontrados com os estáticos
        const todosRamais = new Set(ramais);
        Object.keys(RAMAL_NOMES).forEach(r => todosRamais.add(r));

        return Array.from(todosRamais).sort().map(r => ({
            username: r,
            name: RAMAL_NOMES[r] || r,
            callerid: RAMAL_NOMES[r] ? `${RAMAL_NOMES[r]} (${r})` : r,
            id: r
        }));
    } catch (error) {
        console.log('[CDR-Scraper] Erro ao listar ramais, retornando estáticos:', error.message);
        // Retornar lista estática quando scraper falha
        return Object.entries(RAMAL_NOMES).map(([id, name]) => ({
            username: id,
            name,
            callerid: `${name} (${id})`,
            id
        }));
    }
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
        sessionCookies = null;
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
        temCookiesFallback: !!sessionCookies,
        mensagem: 'Integração CDR via Web Scraping (Puppeteer) + HTTP Fallback'
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
