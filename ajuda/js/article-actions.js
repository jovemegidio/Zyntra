/**
 * article-actions.js — Auto-injeta barra de ações e comentários em cada artigo.
 *
 * Como funciona:
 *   - Detecta automaticamente o "slug" do artigo a partir do pathname (ex:
 *     "/ajuda/artigos/emitir-nfe.html" → "artigos/emitir-nfe").
 *   - Injeta no fim do <main> (ou no fim do <body>) uma barra horizontal com 4
 *     botões: Curtir, Comentar, Compartilhar, Salvar.
 *   - Renderiza abaixo da barra a seção de comentários (form + lista).
 *   - Curtidas e comentários persistem no backend (/api/ajuda/*).
 *   - "Salvar" usa localStorage por dispositivo.
 *   - "Compartilhar" tenta Web Share API, com fallback de copiar link.
 *
 * Requer apenas estar logado (cookie httpOnly) — usuários anônimos veem a barra
 * mas qualquer ação que toque o backend dispara um modal pedindo login.
 */
(function () {
    'use strict';

    // ===== Slug do artigo =====
    function detectSlug() {
        // Path típico: /ajuda/artigos/<nome>.html OU /ajuda/colecoes/<nome>.html
        const m = location.pathname.match(/\/ajuda\/((?:artigos|colecoes)\/[\w\-]+)\.html?$/i);
        if (m) return m[1];
        // Fallback: nome do arquivo sem .html
        const last = location.pathname.split('/').filter(Boolean).pop() || 'index';
        return last.replace(/\.html?$/i, '');
    }
    const SLUG = detectSlug();

    // Só roda em páginas de artigo/coleção, não na home
    if (SLUG === 'index' || SLUG === '' || SLUG === 'ajuda') return;

    // ===== CSS injection =====
    const css = `
        .aa-bar { display:flex; gap:8px; flex-wrap:wrap; margin:32px 0 18px; padding:14px 16px;
                  background:#fff; border:1px solid #e2e4ed; border-radius:12px;
                  box-shadow:0 1px 3px rgba(0,0,0,0.04); font-family:'Inter',-apple-system,sans-serif; }
        .aa-btn { display:inline-flex; align-items:center; gap:6px; padding:8px 14px; border-radius:8px;
                  border:1px solid #e2e4ed; background:#fff; color:#4a4d68; cursor:pointer;
                  font-size:13px; font-weight:500; transition:all .2s; font-family:inherit; }
        .aa-btn:hover { background:#f8f9fc; border-color:#c8cbd8; }
        .aa-btn.active { background:#6C5CE7; color:#fff; border-color:#6C5CE7; }
        .aa-btn.active:hover { background:#5A4BD1; }
        .aa-btn i, .aa-btn svg { font-size:14px; }
        .aa-btn__count { font-weight:700; margin-left:2px; }
        .aa-btn--saved { background:#00B894; color:#fff; border-color:#00B894; }
        .aa-btn--saved:hover { background:#00a884; }

        .aa-comments { margin:24px 0 64px; padding:24px; background:#fff;
                       border:1px solid #e2e4ed; border-radius:12px;
                       font-family:'Inter',-apple-system,sans-serif; }
        .aa-comments__title { display:flex; align-items:center; gap:8px; font-size:16px; font-weight:700;
                              color:#24263d; margin-bottom:18px; }
        .aa-form { display:flex; gap:12px; margin-bottom:24px; }
        .aa-form__avatar { width:38px; height:38px; flex-shrink:0; border-radius:50%;
                           background:linear-gradient(135deg,#6C5CE7,#5A4BD1); color:#fff;
                           display:flex; align-items:center; justify-content:center; font-weight:700; font-size:14px; }
        .aa-form__avatar img { width:100%; height:100%; border-radius:50%; object-fit:cover; }
        .aa-form__wrap { flex:1; }
        .aa-form__textarea { width:100%; padding:10px 12px; border:1px solid #e2e4ed; border-radius:8px;
                             font-family:inherit; font-size:13.5px; color:#24263d; resize:vertical;
                             min-height:64px; transition:all .2s; }
        .aa-form__textarea:focus { outline:none; border-color:#6C5CE7; box-shadow:0 0 0 3px rgba(108,92,231,0.12); }
        .aa-form__actions { display:flex; justify-content:flex-end; gap:8px; margin-top:8px; }
        .aa-form__submit { display:inline-flex; align-items:center; gap:6px; padding:8px 16px; border:0;
                           border-radius:8px; background:#6C5CE7; color:#fff; font-weight:600; font-size:13px;
                           cursor:pointer; font-family:inherit; transition:all .2s; }
        .aa-form__submit:hover { background:#5A4BD1; }
        .aa-form__submit:disabled { background:#c8cbd8; cursor:not-allowed; }

        .aa-comment { display:flex; gap:12px; padding:14px 0; border-top:1px solid #f0f1f6; }
        .aa-comment:first-of-type { border-top:0; padding-top:0; }
        .aa-comment.reply { margin-left:50px; padding-left:14px; border-left:2px solid #f0f1f6; border-top:0; padding-top:14px; }
        .aa-comment__head { display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; margin-bottom:4px; }
        .aa-comment__name { font-weight:600; font-size:13.5px; color:#24263d; }
        .aa-comment__time { font-size:12px; color:#9a9db4; }
        .aa-comment__body { font-size:13.5px; color:#4a4d68; line-height:1.55; white-space:pre-wrap; word-break:break-word; }
        .aa-comment__actions { margin-top:6px; display:flex; gap:14px; }
        .aa-comment__action { background:0; border:0; padding:0; color:#9a9db4; font-size:12px; cursor:pointer;
                              font-family:inherit; transition:color .2s; }
        .aa-comment__action:hover { color:#6C5CE7; }
        .aa-comment__action--danger:hover { color:#d63031; }
        .aa-comment__delete { color:#c8cbd8; }
        .aa-empty { padding:30px; text-align:center; color:#9a9db4; font-size:13px; }

        .aa-toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%) translateY(80px);
                    background:#1A1A36; color:#fff; padding:10px 18px; border-radius:8px; font-size:13px;
                    opacity:0; transition:all .3s; z-index:99999; font-family:'Inter',-apple-system,sans-serif; }
        .aa-toast.show { opacity:1; transform:translateX(-50%) translateY(0); }

        @media (max-width:600px) {
            .aa-bar { padding:12px; gap:6px; }
            .aa-btn { padding:7px 10px; font-size:12px; }
            .aa-comment.reply { margin-left:20px; }
        }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    // ===== Estado =====
    let stats = { curtidas: 0, jaCurtiu: false, comentarios: 0 };
    let comentarios = [];
    let currentUser = null;  // { id, email, nome, foto }
    let replyToId = null;

    // ===== Toast =====
    function toast(msg) {
        let t = document.getElementById('aa-toast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'aa-toast';
            t.className = 'aa-toast';
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(toast._tm);
        toast._tm = setTimeout(() => t.classList.remove('show'), 2800);
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function timeAgo(d) {
        const now = Date.now();
        const t = new Date(d).getTime();
        const diff = Math.floor((now - t) / 1000);
        if (diff < 60) return 'agora';
        if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
        if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
        if (diff < 604800) return `há ${Math.floor(diff / 86400)} d`;
        return new Date(d).toLocaleDateString('pt-BR');
    }

    function initialsOf(name, email) {
        const src = (name || email || '?').trim();
        const parts = src.split(/[\s.@]+/).filter(Boolean);
        const i1 = parts[0]?.[0] || '?';
        const i2 = parts[1]?.[0] || '';
        return (i1 + i2).toUpperCase();
    }

    // ===== Backend calls =====
    function apiFetch(url, opts) {
        return fetch(url, Object.assign({ credentials: 'include' }, opts || {}));
    }

    async function loadCurrentUser() {
        try {
            const r = await apiFetch('/api/me');
            if (r.ok) currentUser = await r.json();
        } catch (e) { /* anônimo */ }
    }

    async function loadStats() {
        try {
            const r = await apiFetch(`/api/ajuda/artigo-stats?slug=${encodeURIComponent(SLUG)}`);
            if (r.ok) stats = await r.json();
        } catch (e) { /* ok */ }
    }

    async function loadComentarios() {
        try {
            const r = await apiFetch(`/api/ajuda/comentarios?slug=${encodeURIComponent(SLUG)}`);
            if (r.ok) {
                const data = await r.json();
                comentarios = data.comentarios || [];
            }
        } catch (e) { comentarios = []; }
    }

    async function toggleCurtida() {
        if (!currentUser) { toast('Faça login para curtir.'); return; }
        try {
            const r = await apiFetch('/api/ajuda/curtida', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ artigo_slug: SLUG }),
            });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const data = await r.json();
            stats.curtidas = data.curtidas;
            stats.jaCurtiu = data.jaCurtiu;
            renderBar();
            toast(stats.jaCurtiu ? 'Curtido! ❤️' : 'Curtida removida.');
        } catch (e) { toast('Erro ao curtir: ' + e.message); }
    }

    async function postComentario(conteudo, parentId) {
        if (!currentUser) { toast('Faça login para comentar.'); return; }
        try {
            const r = await apiFetch('/api/ajuda/comentarios', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ artigo_slug: SLUG, conteudo, parent_id: parentId || null }),
            });
            if (!r.ok) {
                const err = await r.json().catch(() => ({}));
                throw new Error(err.message || 'HTTP ' + r.status);
            }
            const data = await r.json();
            if (data.comentario) comentarios.push(data.comentario);
            stats.comentarios = (Number(stats.comentarios) || 0) + 1;
            replyToId = null;
            renderComentarios();
            renderBar();
            toast('Comentário enviado.');
        } catch (e) { toast('Erro: ' + e.message); }
    }

    async function deleteComentario(id) {
        if (!confirm('Excluir este comentário?')) return;
        try {
            const r = await apiFetch('/api/ajuda/comentarios/' + id, { method: 'DELETE' });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            comentarios = comentarios.filter(c => c.id !== id);
            stats.comentarios = Math.max(0, (Number(stats.comentarios) || 0) - 1);
            renderComentarios();
            renderBar();
            toast('Comentário excluído.');
        } catch (e) { toast('Erro: ' + e.message); }
    }

    // ===== Save (localStorage) =====
    function getSavedSet() {
        try { return new Set(JSON.parse(localStorage.getItem('ajuda_salvos') || '[]')); }
        catch (e) { return new Set(); }
    }
    function isSaved() { return getSavedSet().has(SLUG); }
    function toggleSaved() {
        const s = getSavedSet();
        if (s.has(SLUG)) { s.delete(SLUG); toast('Removido dos salvos.'); }
        else { s.add(SLUG); toast('Salvo para depois.'); }
        localStorage.setItem('ajuda_salvos', JSON.stringify(Array.from(s)));
        renderBar();
    }

    // ===== Share =====
    async function share() {
        const url = location.href;
        const title = document.title || 'Tutorial Zyntra';
        if (navigator.share) {
            try { await navigator.share({ title, url }); toast('Compartilhado.'); return; }
            catch (e) { /* user cancelou */ if (e.name !== 'AbortError') console.warn(e); }
        }
        try {
            await navigator.clipboard.writeText(url);
            toast('Link copiado.');
        } catch (e) {
            prompt('Copie o link:', url);
        }
    }

    // ===== Render =====
    let barEl, commentsEl;

    function renderBar() {
        if (!barEl) return;
        const curtiu = stats.jaCurtiu;
        const salvo = isSaved();
        barEl.innerHTML = `
            <button class="aa-btn ${curtiu ? 'active' : ''}" id="aaLike">
                <i class="${curtiu ? 'fas' : 'far'} fa-heart"></i>
                ${curtiu ? 'Curtido' : 'Curtir'}
                <span class="aa-btn__count">${Number(stats.curtidas) || 0}</span>
            </button>
            <button class="aa-btn" id="aaComment">
                <i class="far fa-comment"></i>
                Comentar
                <span class="aa-btn__count">${Number(stats.comentarios) || 0}</span>
            </button>
            <button class="aa-btn" id="aaShare">
                <i class="fas fa-share-alt"></i>
                Compartilhar
            </button>
            <button class="aa-btn ${salvo ? 'aa-btn--saved' : ''}" id="aaSave">
                <i class="${salvo ? 'fas' : 'far'} fa-bookmark"></i>
                ${salvo ? 'Salvo' : 'Salvar'}
            </button>
        `;
        barEl.querySelector('#aaLike').onclick = toggleCurtida;
        barEl.querySelector('#aaShare').onclick = share;
        barEl.querySelector('#aaSave').onclick = toggleSaved;
        barEl.querySelector('#aaComment').onclick = () => {
            commentsEl?.scrollIntoView({ behavior: 'smooth' });
            commentsEl?.querySelector('textarea')?.focus();
        };
    }

    function renderComentarios() {
        if (!commentsEl) return;
        const me = currentUser;
        const meName = me?.nome || me?.name || me?.email || 'Você';
        const meFoto = me?.foto || me?.avatar || null;
        const meInit = initialsOf(meName, me?.email);

        // Group por parent
        const roots = comentarios.filter(c => !c.parent_id);
        const childrenOf = id => comentarios.filter(c => c.parent_id === id);

        const formHTML = me ? `
            <div class="aa-form">
                <div class="aa-form__avatar">${meFoto ? `<img src="${esc(meFoto)}">` : esc(meInit)}</div>
                <div class="aa-form__wrap">
                    <textarea class="aa-form__textarea" id="aaTextarea" rows="2"
                              placeholder="${replyToId ? 'Sua resposta...' : 'Deixe sua dúvida ou comentário sobre este tutorial...'}"></textarea>
                    <div class="aa-form__actions">
                        ${replyToId ? `<button class="aa-comment__action" id="aaCancelReply">Cancelar resposta</button>` : ''}
                        <button class="aa-form__submit" id="aaSubmit" disabled>
                            <i class="fas fa-paper-plane"></i> Enviar
                        </button>
                    </div>
                </div>
            </div>` : `
            <div class="aa-empty">
                Faça <a href="/login.html" style="color:#6C5CE7;font-weight:600;">login</a> para comentar.
            </div>`;

        const renderOne = c => {
            const init = initialsOf(c.usuario_nome, c.usuario_email);
            const canDelete = me && (me.id === c.usuario_id || me.is_admin);
            return `
                <div class="aa-comment ${c.parent_id ? 'reply' : ''}">
                    <div class="aa-form__avatar">${c.usuario_foto ? `<img src="${esc(c.usuario_foto)}">` : esc(init)}</div>
                    <div style="flex:1;">
                        <div class="aa-comment__head">
                            <span class="aa-comment__name">${esc(c.usuario_nome || (c.usuario_email || '').split('@')[0])}</span>
                            <span class="aa-comment__time">${timeAgo(c.created_at)}</span>
                        </div>
                        <div class="aa-comment__body">${esc(c.conteudo)}</div>
                        <div class="aa-comment__actions">
                            ${!c.parent_id ? `<button class="aa-comment__action" data-reply="${c.id}"><i class="fas fa-reply"></i> Responder</button>` : ''}
                            ${canDelete ? `<button class="aa-comment__action aa-comment__action--danger" data-delete="${c.id}"><i class="fas fa-trash"></i> Excluir</button>` : ''}
                        </div>
                    </div>
                </div>
            `;
        };

        const listHTML = roots.length
            ? roots.map(c => renderOne(c) + childrenOf(c.id).map(renderOne).join('')).join('')
            : `<div class="aa-empty">Nenhum comentário ainda. Seja o primeiro!</div>`;

        commentsEl.innerHTML = `
            <h3 class="aa-comments__title">
                <i class="far fa-comments"></i> Comentários (${Number(stats.comentarios) || 0})
            </h3>
            ${formHTML}
            ${listHTML}
        `;

        const ta = commentsEl.querySelector('#aaTextarea');
        const sb = commentsEl.querySelector('#aaSubmit');
        if (ta && sb) {
            ta.addEventListener('input', () => { sb.disabled = !ta.value.trim(); });
            sb.addEventListener('click', () => {
                const v = ta.value.trim();
                if (!v) return;
                sb.disabled = true;
                postComentario(v, replyToId).then(() => { ta.value = ''; sb.disabled = true; });
            });
        }
        commentsEl.querySelector('#aaCancelReply')?.addEventListener('click', () => {
            replyToId = null;
            renderComentarios();
        });
        commentsEl.querySelectorAll('[data-reply]').forEach(b => b.onclick = () => {
            replyToId = Number(b.dataset.reply);
            renderComentarios();
            commentsEl.querySelector('#aaTextarea')?.focus();
        });
        commentsEl.querySelectorAll('[data-delete]').forEach(b => b.onclick = () => deleteComentario(Number(b.dataset.delete)));
    }

    // ===== Init =====
    async function init() {
        // Cria container de ações no fim do conteúdo principal
        const host = document.querySelector('main, .article-content, .conteudo, article, .container, body');
        if (!host) return;

        barEl = document.createElement('div');
        barEl.className = 'aa-bar';
        commentsEl = document.createElement('section');
        commentsEl.className = 'aa-comments';
        host.appendChild(barEl);
        host.appendChild(commentsEl);

        renderBar();
        renderComentarios();

        // Carrega dados em paralelo
        await Promise.all([loadCurrentUser(), loadStats(), loadComentarios()]);
        renderBar();
        renderComentarios();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
