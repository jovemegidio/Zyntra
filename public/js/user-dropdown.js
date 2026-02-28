/**
 * USER DROPDOWN MENU - ALUFORCE V.2
 * Auto-injeta dropdown de logout em todas as páginas
 * Inclua via: <script src="/js/user-dropdown.js"></script>
 */
(function() {
    'use strict';

    // CSS do dropdown
    const dropdownCSS = `
        .user-greeting {
            position: relative;
            cursor: pointer;
            user-select: none;
        }
        .user-dropdown-menu {
            position: absolute;
            top: calc(100% + 8px);
            right: 0;
            width: 260px;
            background: #fff;
            border-radius: 16px;
            box-shadow: 0 20px 50px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.04);
            border: none;
            opacity: 0;
            visibility: hidden;
            transform: translateY(-8px);
            transition: all 0.2s ease;
            z-index: 9999;
            overflow: hidden;
        }
        .user-dropdown-menu.active {
            opacity: 1;
            visibility: visible;
            transform: translateY(0);
        }
        .dropdown-user-info {
            padding: 16px;
            border-bottom: 1px solid #f1f5f9;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .dropdown-user-info .dropdown-avatar {
            width: 44px;
            height: 44px;
            min-width: 44px;
            min-height: 44px;
            border-radius: 50%;
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: 600;
            font-size: 15px;
            overflow: hidden;
            flex-shrink: 0;
            aspect-ratio: 1 / 1;
        }
        .dropdown-user-info .dropdown-avatar img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            border-radius: 50%;
        }
        .dropdown-user-info .dropdown-details {
            overflow: hidden;
            min-width: 0;
            flex: 1;
        }
        .dropdown-user-info .dropdown-details .dropdown-name {
            font-weight: 600;
            font-size: 14px;
            color: #1e293b;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            line-height: 1.3;
        }
        .dropdown-user-info .dropdown-details .dropdown-email {
            font-size: 12px;
            color: #94a3b8;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            line-height: 1.3;
        }
        .dropdown-menu-items {
            padding: 6px;
        }
        .dropdown-menu-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 12px;
            border-radius: 10px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            color: #475569;
            transition: all 0.15s;
            border: none;
            background: none;
            width: 100%;
            text-align: left;
        }
        .dropdown-menu-item:hover {
            background: #f1f5f9;
            color: #1e293b;
        }
        .dropdown-menu-item i {
            width: 18px;
            text-align: center;
            font-size: 14px;
            color: #94a3b8;
        }
        .dropdown-menu-item:hover i {
            color: #64748b;
        }
        .dropdown-menu-item.logout-item {
            color: #ef4444;
        }
        .dropdown-menu-item.logout-item i {
            color: #ef4444;
        }
        .dropdown-menu-item.logout-item:hover {
            background: #fef2f2;
        }
        .dropdown-divider {
            height: 1px;
            background: #f1f5f9;
            margin: 4px 6px;
        }
    `;

    function injectCSS() {
        if (document.getElementById('user-dropdown-css')) return;
        const style = document.createElement('style');
        style.id = 'user-dropdown-css';
        style.textContent = dropdownCSS;
        document.head.appendChild(style);
    }

    function createDropdown() {
        const greetingEl = document.querySelector('.user-greeting');
        if (!greetingEl || document.getElementById('user-dropdown-menu')) return;

        // Criar dropdown HTML
        const dropdown = document.createElement('div');
        dropdown.className = 'user-dropdown-menu';
        dropdown.id = 'user-dropdown-menu';
        dropdown.innerHTML = `
            <div class="dropdown-user-info">
                <div class="dropdown-avatar" id="dropdown-avatar-icon">U</div>
                <div class="dropdown-details">
                    <div class="dropdown-name" id="dropdown-user-name">Usuário</div>
                    <div class="dropdown-email" id="dropdown-user-email">usuario@aluforce.ind.br</div>
                </div>
            </div>
            <div class="dropdown-menu-items">
                <button class="dropdown-menu-item" onclick="window.location.href='/dashboard'">
                    <i class="fas fa-home"></i>
                    <span>Painel Principal</span>
                </button>
                <div class="dropdown-divider"></div>
                <button class="dropdown-menu-item logout-item" id="dropdown-logout-btn">
                    <i class="fas fa-sign-out-alt"></i>
                    <span>Sair</span>
                </button>
            </div>
        `;

        greetingEl.appendChild(dropdown);

        // Toggle ao clicar no greeting
        greetingEl.addEventListener('click', function(e) {
            e.stopPropagation();
            dropdown.classList.toggle('active');
        });

        // Fechar ao clicar fora
        document.addEventListener('click', function(e) {
            if (!greetingEl.contains(e.target)) {
                dropdown.classList.remove('active');
            }
        });

        // Logout
        document.getElementById('dropdown-logout-btn').addEventListener('click', function(e) {
            e.stopPropagation();
            // Limpar dados de sessão
            ['authToken', 'token', 'userData', 'user', 'user_data', 'userName'].forEach(function(k) {
                try { localStorage.removeItem(k); } catch(ex) {}
                try { sessionStorage.removeItem(k); } catch(ex) {}
            });
            // Limpar cookie de sessão
            document.cookie = 'connect.sid=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
            // Redirecionar para login
            window.location.href = '/login.html';
        });

        // Carregar dados do usuário para o dropdown
        loadUserData();
    }

    async function loadUserData() {
        try {
            const response = await fetch('/api/me', { credentials: 'include' });
            if (!response.ok) return;
            const user = await response.json();

            const nameEl = document.getElementById('dropdown-user-name');
            const emailEl = document.getElementById('dropdown-user-email');
            const avatarEl = document.getElementById('dropdown-avatar-icon');

            // Exibir apenas Nome + Sobrenome (nome completo só em RH)
            function nomeESobrenome(nome) {
                if (!nome) return 'Usuário';
                var parts = nome.trim().split(/\s+/);
                if (parts.length <= 2) return nome;
                return parts[0] + ' ' + parts[parts.length - 1];
            }

            var nomeExibicao = user.apelido || nomeESobrenome(user.nome);
            if (nameEl) nameEl.textContent = nomeExibicao;
            if (emailEl) emailEl.textContent = user.email || '';

            if (avatarEl) {
                // Avatar mapping completo
                var avatarMap = {
                    'clemerson': '/avatars/Clemerson.webp',
                    'isabela': '/avatars/Isabela.webp',
                    'thaina': '/avatars/Thaina.webp',
                    'thiago': '/avatars/Thiago.webp',
                    'nicolas': '/avatars/NicolasDaniel.webp',
                    'nicolasdaniel': '/avatars/NicolasDaniel.webp',
                    'rh': '/avatars/Rh.webp',
                    'admin': '/avatars/admin.webp',
                    'ti': '/avatars/TI.webp',
                    'tialuforce': '/avatars/TI.webp',
                    'antonio': '/avatars/Antonio.webp',
                    'andreia': '/avatars/Andreia.webp',
                    'guilherme': '/avatars/Guilherme.webp',
                    'augusto': '/avatars/Augusto.jpg',
                    'renata': '/avatars/Renata.jpg',
                    'fabiano': '/avatars/Fabiano.webp',
                    'fabiola': '/avatars/Fabiola.webp',
                    'marcia': '/avatars/Marcia.webp',
                    'ronaldo': '/avatars/RonaldoTorres.jpg',
                    'joao': '/avatars/JoaoVictor.jpg',
                    'douglas': '/avatars/Douglas.webp',
                    'fernando': '/avatars/Fernando.webp'
                };

                var foto = user.avatar || user.foto || user.foto_perfil_url;
                if (!foto || foto === '/avatars/default.webp') {
                    // Tentar pelo email
                    var username = (user.email || '').split('@')[0].split('.')[0].toLowerCase();
                    foto = avatarMap[username];
                    if (!foto && user.nome) {
                        var firstName = user.nome.split(' ')[0].toLowerCase();
                        foto = avatarMap[firstName];
                    }
                }

                if (foto) {
                    avatarEl.innerHTML = '<img src="' + foto + '" alt="Foto">';
                } else {
                    var nome = user.apelido || user.nome || 'U';
                    var iniciais = nome.split(' ').map(function(n) { return n[0]; }).join('').substring(0, 2).toUpperCase();
                    avatarEl.textContent = iniciais;
                }
            }
        } catch (err) {
            console.log('[Dropdown] Erro ao carregar dados:', err.message);
        }
    }

    // Inicializar quando DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            injectCSS();
            createDropdown();
        });
    } else {
        injectCSS();
        createDropdown();
    }
})();
