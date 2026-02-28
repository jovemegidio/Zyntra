// Sistema de navegaçáo profissional - RH Aluforce V2.0
console.log('🚀 Inicializando sistema de navegaçáo profissional...');

// Funçáo principal de carregamento de páginas
function loadPageDirect(pageName, event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    
    console.log('🔄 Carregando página: ' + pageName);
    
    // Feedback visual no menu clicado
    if (event && event.target) {
        var clickedElement = event.target.closest('.nav-link');
        if (clickedElement) {
            clickedElement.style.background = '#4f46e5';
            clickedElement.style.transform = 'scale(0.95)';
            setTimeout(function() {
                clickedElement.style.background = '';
                clickedElement.style.transform = '';
            }, 200);
        }
    }
    
    var testStatus = document.getElementById('test-status');
    if (testStatus) {
        testStatus.innerHTML = '🔄 Carregando ' + pageName + '...';
    }
    
    var contentArea = document.querySelector('.content-area');
    if (!contentArea) {
        console.error('❌ Área de conteúdo náo encontrada!');
        alert('Erro: Área de conteúdo náo encontrada!');
        return false;
    }
    
    // Loading visual profissional
    contentArea.innerHTML = '<div class="loading-container" style="display: flex; justify-content: center; align-items: center; min-height: 500px; flex-direction: column; background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%); border-radius: 16px; margin: 24px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">' +
        '<div class="loading-spinner" style="width: 80px; height: 80px; border: 6px solid #e2e8f0; border-top: 6px solid #3b82f6; border-radius: 50%; animation: professionalSpin 1.2s linear infinite; margin-bottom: 24px; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);"></div>' +
        '<h3 style="color: #1e293b; margin: 0; font-size: 24px; font-weight: 700; font-family: Inter, sans-serif;">Carregando ' + pageName + '</h3>' +
        '<p style="color: #64748b; margin: 12px 0 0 0; font-size: 16px; font-weight: 500;">Por favor, aguarde...</p>' +
        '<div class="loading-bar" style="width: 200px; height: 4px; background: #e2e8f0; border-radius: 2px; margin-top: 20px; overflow: hidden;">' +
        '<div style="width: 40%; height: 100%; background: linear-gradient(90deg, #3b82f6, #8b5cf6); border-radius: 2px; animation: loadingProgress 1.5s ease-in-out infinite;"></div>' +
        '</div>' +
        '</div>' +
        '<style>' +
        '@keyframes professionalSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }' +
        '@keyframes loadingProgress { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }' +
        '</style>';
    
    // Carregar a página
    fetch('pages/' + pageName + '.html')
        .then(function(response) {
            console.log('📡 Resposta recebida: ' + response.status);
            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }
            return response.text();
        })
        .then(function(html) {
            console.log('📄 HTML recebido, processando...');
            
            // Extrair conteúdo do body se existir
            var parser = new DOMParser();
            var doc = parser.parseFromString(html, 'text/html');
            var bodyContent = doc.querySelector('body');
            var content = bodyContent ? bodyContent.innerHTML : html;
            
            contentArea.innerHTML = content;
            
            // Atualizar menu ativo
            var allLinks = document.querySelectorAll('.nav-link');
            for (var i = 0; i < allLinks.length; i++) {
                allLinks[i].classList.remove('active');
            }
            var activeLink = document.querySelector('[data-page="' + pageName + '"]');
            if (activeLink) {
                activeLink.classList.add('active');
            }
            
            console.log('✅ Página ' + pageName + ' carregada com sucesso!');
            
            var testStatus = document.getElementById('test-status');
            if (testStatus) {
                testStatus.innerHTML = '✅ Página "' + pageName + '" carregada com sucesso!';
            }
        })
        .catch(function(error) {
            console.error('❌ Erro ao carregar página:', error);
            
            var testStatus = document.getElementById('test-status');
            if (testStatus) {
                testStatus.innerHTML = '❌ Erro ao carregar "' + pageName + '": ' + error.message;
            }
            
            contentArea.innerHTML = '<div style="text-align: center; padding: 60px 20px; background: #fef2f2; border-radius: 8px; margin: 20px;">' +
                '<div style="font-size: 48px; margin-bottom: 20px;">⚠️</div>' +
                '<h3 style="color: #dc2626; margin-bottom: 10px;">Erro ao carregar página</h3>' +
                '<p style="color: #991b1b; margin-bottom: 20px;">Náo foi possível carregar "' + pageName + '"</p>' +
                '<p style="color: #7f1d1d; font-size: 14px; margin-bottom: 30px;">Erro: ' + error.message + '</p>' +
                '<button onclick="loadPageDirect(\'dashboard\')" style="background: #4f46e5; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-size: 16px;">Voltar ao Dashboard</button>' +
                '</div>';
        });
        
    return false;
}

// Funçáo de teste simples
function testSimple() {
    alert('Funçáo JavaScript funcionando!');
    var contentArea = document.querySelector('.content-area');
    if (contentArea) {
        contentArea.innerHTML = '<h1 style="color: green; text-align: center; padding: 50px;">✅ TESTE DE JAVASCRIPT FUNCIONOU!</h1>';
    }
}

// Funçáo de diagnóstico dos menus
function diagnosticarMenus() {
    console.log('🔍 Iniciando diagnóstico dos menus...');
    
    var menus = [
        { id: 'menu-dashboard', nome: 'Dashboard' },
        { id: 'menu-funcionarios', nome: 'Funcionários' },
        { id: 'menu-holerites', nome: 'Holerites' },
        { id: 'menu-relatórios', nome: 'Relatórios' }
    ];
    
    menus.forEach(function(menu) {
        var elemento = document.getElementById(menu.id);
        if (elemento) {
            console.log('✅ Menu ' + menu.nome + ' encontrado');
        } else {
            console.log('❌ Menu ' + menu.nome + ' NÁO encontrado');
        }
    });
}

// Configurar event listeners para os menus
function setupMenuListeners() {
    console.log('🔧 Configurando event listeners dos menus...');
    
    // Desabilitar navegações antigas que causam conflito
    if (typeof navigateToSection !== 'undefined') {
        window.navigateToSection = function() { 
            console.log('🚫 Navegaçáo antiga desabilitada'); 
        };
    }
    if (typeof improvedNavigateToSection !== 'undefined') {
        window.improvedNavigateToSection = function() { 
            console.log('🚫 Navegaçáo melhorada antiga desabilitada'); 
        };
    }
    
    // Dashboard
    var dashboardMenu = document.getElementById('menu-dashboard');
    if (dashboardMenu) {
        dashboardMenu.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('🖱️ Clique no menu Dashboard detectado');
            loadPageDirect('dashboard', e);
        });
        console.log('✅ Menu Dashboard configurado');
    }
    
    // Funcionários
    var funcionariosMenu = document.getElementById('menu-funcionarios');
    if (funcionariosMenu) {
        funcionariosMenu.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('🖱️ Clique no menu Funcionários detectado');
            loadPageDirect('funcionarios', e);
        });
        console.log('✅ Menu Funcionários configurado');
    }
    
    // Holerites
    var holeritesMenu = document.getElementById('menu-holerites');
    if (holeritesMenu) {
        holeritesMenu.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('🖱️ Clique no menu Holerites detectado');
            loadPageDirect('holerites', e);
        });
        console.log('✅ Menu Holerites configurado');
    }
    
    // Relatórios
    var relatóriosMenu = document.getElementById('menu-relatórios');
    if (relatóriosMenu) {
        relatóriosMenu.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('🖱️ Clique no menu Relatórios detectado');
            loadPageDirect('relatórios', e);
        });
        console.log('✅ Menu Relatórios configurado');
    }
    
    console.log('🎯 Todos os event listeners configurados!');
    
    // Adicionar listeners também nos ícones dentro dos links
    var icones = document.querySelectorAll('.nav-link i');
    icones.forEach(function(icone) {
        icone.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            var link = icone.closest('.nav-link');
            if (link) {
                var pageName = link.getAttribute('data-page');
                if (pageName) {
                    console.log('🖱️ Clique no ícone detectado: ' + pageName);
                    loadPageDirect(pageName, e);
                }
            }
        });
    });
    
    console.log('✨ Listeners dos ícones também configurados!');
    
    // Sistema de fallback com hover visual
    var navLinks = document.querySelectorAll('.nav-link:not(.logout-link)');
    navLinks.forEach(function(link) {
        link.addEventListener('mouseenter', function() {
            link.style.backgroundColor = 'rgba(79, 70, 229, 0.1)';
            link.style.transform = 'translateX(2px)';
        });
        
        link.addEventListener('mouseleave', function() {
            if (!link.classList.contains('active')) {
                link.style.backgroundColor = '';
            }
            link.style.transform = '';
        });
    });
}

// Inicializaçáo quando a página carregar
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Iniciando sistema de navegaçáo RH...');
    
    // Configurar menus e diagnóstico
    setTimeout(function() {
        diagnosticarMenus();
        setupMenuListeners();
    }, 100);
    
    // Adicionar botáo de teste visível (apenas em desenvolvimento)
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        var testButton = document.createElement('button');
        testButton.innerHTML = '🧪 TESTAR JS';
        testButton.style.cssText = 'position: fixed; top: 10px; right: 10px; z-index: 9999; background: #ff4444; color: white; border: none; padding: 10px; border-radius: 5px; cursor: pointer;';
        testButton.onclick = testSimple;
        document.body.appendChild(testButton);
    }
    
    // Carregar dashboard
    setTimeout(function() {
        console.log('📊 Carregando dashboard inicial...');
        loadPageDirect('dashboard');
    }, 500);
});

console.log('✅ Sistema de navegaçáo carregado!');