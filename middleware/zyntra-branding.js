// ============================================
// ZYNTRA BRANDING MIDDLEWARE
// Suporta múltiplas marcas via env BRAND=
//   - zyntra
//   - labor-eletric
//   - labor-energy
// ============================================

const BRAND = (process.env.BRAND || '').toLowerCase();
const IS_ZYNTRA = BRAND === 'zyntra';
const IS_LABOR_ELETRIC = BRAND === 'labor-eletric';
const IS_LABOR_ENERGY = BRAND === 'labor-energy';
const IS_DEMO = process.env.DEMO_MODE === 'true';
const MOUNT_PATH = process.env.MOUNT_PATH || '';

// Configurações por marca
const BRAND_CONFIG = {
    zyntra: {
        name: 'ZYNTRA',
        nameFull: 'Zyntra',
        nameLower: 'zyntra',
        logoFile: 'zyntra-branco.png',
        email: '@zyntra.com.br',
        primaryColor: '#6C5CE7',
        primaryHover: '#5A4BD1',
        accent: '#A29BFE',
    },
    'labor-eletric': {
        name: 'LABOR ELETRIC',
        nameFull: 'Labor Eletric',
        nameLower: 'labor-eletric',
        logoFile: 'labor-eletric-logo.png',
        email: '@labor.com.br',
        primaryColor: '#F39C12',
        primaryHover: '#D68910',
        accent: '#F8C471',
    },
    'labor-energy': {
        name: 'LABOR ENERGY',
        nameFull: 'Labor Energy',
        nameLower: 'labor-energy',
        logoFile: 'labor-energy-logo.png',
        logoFileWhite: 'labor-energy-logo-branco.png',
        email: '@labor.com.br',
        primaryColor: '#27AE60',
        primaryHover: '#1E8449',
        accent: '#58D68D',
    },
};

const activeBrand = BRAND_CONFIG[BRAND];
const IS_BRANDED = !!activeBrand;

// Banner de demo injetado no topo das páginas HTML
const DEMO_BANNER = IS_DEMO ? `
<style>
.zyntra-demo-banner {
    position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
    background: linear-gradient(135deg, #6C5CE7 0%, #4834d4 100%);
    color: white; text-align: center; padding: 6px 16px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px; font-weight: 500; letter-spacing: 0.3px;
    box-shadow: 0 2px 8px rgba(108,92,231,0.3);
    display: flex; align-items: center; justify-content: center; gap: 12px;
}
.zyntra-demo-banner a {
    color: white; background: rgba(255,255,255,0.2); padding: 3px 12px;
    border-radius: 20px; text-decoration: none; font-weight: 600;
    transition: background 0.2s;
}
.zyntra-demo-banner a:hover { background: rgba(255,255,255,0.35); }
body { padding-top: 36px !important; }
.sidebar, .nav-sidebar, [class*="sidebar"] { top: 36px !important; }
header, .header, .top-bar, [class*="header"] { top: 36px !important; }
</style>
<div class="zyntra-demo-banner">
    🚀 <strong>Modo Demonstração</strong> — Explore todas as funcionalidades livremente
    <a href="https://aluforce.api.br/Zyntra-SGE/" target="_blank">← Assinar Plano</a>
</div>
` : '';

// CSS de override de cores por marca
function buildBrandCSS(cfg) {
    if (!cfg) return '';
    return `
<style id="brand-override">
:root {
    --primary: ${cfg.primaryColor} !important;
    --primary-hover: ${cfg.primaryHover} !important;
    --accent: ${cfg.accent} !important;
}
</style>
`;
}

const BRAND_CSS = IS_BRANDED ? buildBrandCSS(activeBrand) : '';

// Script injetado quando app roda em sub-path (ex: /labor-eletric/)
// Intercepta fetch, XHR, history e links <a> para que caminhos absolutos
// sejam reescritos com o MOUNT_PATH correto, evitando que requests caiam
// no servidor Aluforce principal em vez da instância Labor.
const MOUNT_SCRIPT = MOUNT_PATH ? `<script id="zyntra-mount-intercept">
(function(){
  var B="${MOUNT_PATH}";
  window.__MOUNT_PATH__=B;
  window.__BASE_PATH=window.__BASE_PATH||B;
  // Caminhos GLOBAIS — pertencem ao hub aluforce, nunca devem receber prefixo da marca.
  var GLOBAL_PREFIXES=["/Zyntra-SGE/","/zyntra-sge/","/Zyntra-LandingPage/","/api/dashboard/hub-stats"];
  function isGlobal(u){
    for(var i=0;i<GLOBAL_PREFIXES.length;i++){
      if(u.indexOf(GLOBAL_PREFIXES[i])===0)return true;
    }
    return false;
  }
  function addBase(u){
    if(typeof u!=="string"||u[0]!=="/")return u;
    if(u.slice(0,B.length)===B)return u;
    if(isGlobal(u))return u;
    return B+u;
  }
  window.__withBasePath=addBase;
  // fetch
  var _f=window.fetch;
  window.fetch=function(u,o){return _f.call(this,addBase(u),o);};
  // XMLHttpRequest
  var _x=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){
    if(typeof u==="string"&&u[0]==="/"&&u.slice(0,B.length)!==B&&!isGlobal(u))arguments[1]=B+u;
    return _x.apply(this,arguments);
  };
  // history API
  ["pushState","replaceState"].forEach(function(k){
    var o=history[k].bind(history);
    history[k]=function(s,t,u){return o(s,t,addBase(u));};
  });
  // location.assign e location.replace
  try{
    var _a=window.location.assign.bind(window.location);
    window.location.assign=function(u){return _a(addBase(u));};
    var _r=window.location.replace.bind(window.location);
    window.location.replace=function(u){return _r(addBase(u));};
  }catch(e){}
  // links <a href="/...">
  function fixLinks(r){
    (r||document).querySelectorAll('a[href^="/"]').forEach(function(a){
      var h=a.getAttribute("href");
      if(h&&h.slice(0,B.length)!==B&&!isGlobal(h))a.setAttribute("href",B+h);
    });
  }
  function attachObserver(){
    fixLinks(document);
    new MutationObserver(function(ml){
      ml.forEach(function(m){
        m.addedNodes.forEach(function(n){if(n.nodeType===1)fixLinks(n);});
      });
    }).observe(document.body,{childList:true,subtree:true});
  }
  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",attachObserver);
  } else {
    attachObserver();
  }
})();
</script>` : '';

/**
 * Aplica substituições de branding em uma string HTML
 */
function applyBrandReplacements(body, cfg) {
    const logoColor = cfg.logoFile;
    const logoWhite = cfg.logoFileWhite || cfg.logoFile;
    return body
        // Logos PRIMEIRO — antes das substituições de texto, para que os caminhos
        // de imagem ainda contenham "Aluforce" quando os padrões forem avaliados.
        // Logos BRANCAS (dark mode / fundo escuro)
        .replace(/Logo Monocromatico - Branco - Aluforce copy\.webp/g, logoWhite)
        .replace(/Logo Monocromatico - Branco - Aluforce\.png/g, logoWhite)
        .replace(/Logo Monocromatico - Branco - Aluforce\.webp/g, logoWhite)
        // Logos COLORIDAS (light mode / fundo claro)
        .replace(/Logo Monocromatico - Azul - Aluforce\.png/g, logoColor)
        .replace(/Logo Monocromatico - Azul - Aluforce\.webp/g, logoColor)
        .replace(/Interativo-Aluforce\.png/g, logoColor)
        .replace(/Interativo-Aluforce\.webp/g, logoColor)
        // Nomes em maiúsculas — usa \b para não quebrar identificadores JS como ALUFORCE_PREFS
        .replace(/\bALUFORCE\b/g, cfg.name)
        // Nome capitalizado — não substitui dentro de identificadores camelCase (AluforceAuth, AluforceUtils, etc.)
        // pois cfg.nameFull contém espaço (ex: "Labor Energy") e quebraria o JS
        .replace(/\bAluforce\b(?![A-Za-z_])/g, cfg.nameFull)
        // Nome minúsculas (evitando substituir caminhos internos de API e identificadores como _aluforceSocket)
        .replace(/\baluforce\b(?!\.api\.br|\.ind\.br|_vendas|_db|[A-Za-z_])/g, cfg.nameLower)
        // Emails — aluforce e domínios labor legados (laboreletric.com.br, energy.com.br)
        // são reescritos para o domínio atual da marca (@labor.com.br para as duas Labor).
        .replace(/@aluforce\.ind\.br/g, cfg.email)
        .replace(/@aluforce\.com\.br/g, cfg.email)
        .replace(/@laboreletric\.com\.br/g, cfg.email)
        .replace(/@energy\.com\.br/g, cfg.email);
}

/**
 * Middleware Express que intercepta respostas HTML e aplica branding
 */
function zyntraBrandingMiddleware(req, res, next) {
    if (!IS_BRANDED) return next();

    const cfg = activeBrand;

    // Garante que redirects do servidor incluam o MOUNT_PATH como prefixo
    if (MOUNT_PATH) {
        const origRedirect = res.redirect.bind(res);
        res.redirect = function(status, url) {
            if (typeof status === 'string') { url = status; status = 302; }
            if (typeof url === 'string' && url.startsWith('/login.html')) {
                const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
                const host = req.get('x-forwarded-host') || req.get('host') || 'zyntraerp.com.br';
                const loginUrl = new URL(url, `${proto}://${host}`);
                const returnTo = loginUrl.searchParams.get('returnTo');
                if (returnTo && returnTo.startsWith('/') && !returnTo.startsWith(MOUNT_PATH)) {
                    loginUrl.searchParams.set('returnTo', MOUNT_PATH + returnTo);
                }
                return origRedirect.call(res, status, loginUrl.toString());
            }
            if (typeof url === 'string' && url.startsWith('/') && !url.startsWith(MOUNT_PATH)) {
                url = MOUNT_PATH + url;
            }
            return origRedirect.call(res, status, url);
        };
    }

    const originalSend = res.send;

    res.send = function(body) {
        if (typeof body === 'string' && (
            body.includes('<!DOCTYPE html') ||
            body.includes('<html') ||
            res.getHeader('content-type')?.includes('text/html')
        )) {
            body = applyBrandReplacements(body, cfg);

            if (body.includes('</head>')) {
                body = body.replace('</head>', MOUNT_SCRIPT + BRAND_CSS + '</head>');
            }

            if (DEMO_BANNER && body.includes('<body')) {
                body = body.replace(/(<body[^>]*>)/, '$1' + DEMO_BANNER);
            }

            res.setHeader('Content-Length', Buffer.byteLength(body));
        }

        return originalSend.call(this, body);
    };

    next();
}

/**
 * Transforma HTML string aplicando branding
 * Pode ser chamado diretamente (ex: no sendFile interceptor do server.js)
 */
function transformHtml(html) {
    if (!IS_BRANDED || typeof html !== 'string') return html;
    if (!html.includes('<!DOCTYPE html') && !html.includes('<html')) return html;

    const cfg = activeBrand;
    html = applyBrandReplacements(html, cfg);

    if (html.includes('</head>')) {
        html = html.replace('</head>', MOUNT_SCRIPT + BRAND_CSS + '</head>');
    }

    if (DEMO_BANNER && html.includes('<body')) {
        html = html.replace(/(<body[^>]*>)/, '$1' + DEMO_BANNER);
    }

    return html;
}

/**
 * Intercepta arquivos .html servidos por express.static.
 *
 * express.static usa res.sendFile internamente, que pula res.send e portanto não
 * passa pelo zyntraBrandingMiddleware. Este middleware DEVE ser montado ANTES de
 * express.static(public) — ele lê o arquivo do disco para qualquer requisição
 * .html (ou diretório sem extensão, resolvendo para index.html), aplica
 * transformHtml e responde diretamente. Apenas opera quando IS_BRANDED=true.
 */
const fs = require('fs');
const path = require('path');
function staticHtmlBrandingFactory(publicDir) {
    const rootDir = path.resolve(publicDir);
    return function staticHtmlBrandingMiddleware(req, res, next) {
        if (!IS_BRANDED) return next();
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();

        // Apenas paths terminando em .html (ou sem extensão, vamos tentar como dir/index.html)
        let urlPath = req.path;
        try { urlPath = decodeURIComponent(urlPath); } catch (_) {}
        const lower = urlPath.toLowerCase();
        const isHtml = lower.endsWith('.html') || lower.endsWith('.htm');
        if (!isHtml) return next();

        // Sanitização contra path traversal
        const safe = path.normalize(urlPath).replace(/^([\\/]+)/, '');
        const filePath = path.join(rootDir, safe);
        if (!filePath.startsWith(rootDir)) return next();

        fs.readFile(filePath, 'utf8', (err, content) => {
            if (err) return next();
            const transformed = transformHtml(content);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            if (req.method === 'HEAD') {
                res.setHeader('Content-Length', Buffer.byteLength(transformed));
                return res.end();
            }
            return res.send(transformed);
        });
    };
}

/**
 * Adiciona info de branding ao request
 */
function zyntraBrandInfo(req, res, next) {
    if (IS_BRANDED && activeBrand) {
        req.brand = BRAND;
        req.isDemo = IS_DEMO;
        res.locals.brand = BRAND;
        res.locals.brandName = activeBrand.nameFull;
        res.locals.isDemo = IS_DEMO;
    } else {
        req.brand = 'aluforce';
        req.isDemo = false;
        res.locals.brand = 'aluforce';
        res.locals.brandName = 'Aluforce';
        res.locals.isDemo = false;
    }
    next();
}

module.exports = {
    zyntraBrandingMiddleware,
    staticHtmlBrandingFactory,
    zyntraBrandInfo,
    transformHtml,
    IS_ZYNTRA,
    IS_LABOR_ELETRIC,
    IS_LABOR_ENERGY,
    IS_BRANDED,
    IS_DEMO,
    BRAND,
    MOUNT_PATH,
    BRAND_CONFIG,
    activeBrand,
};
