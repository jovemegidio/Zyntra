// Mobile Sidebar Toggle
function toggleMobileSidebar() {
    const sidebar = document.getElementById('mobile-sidebar');
    const overlay = document.getElementById('sidebar-overlay') || document.getElementById('mobile-overlay');
    if (sidebar) sidebar.classList.toggle('mobile-open');
    if (overlay) overlay.classList.toggle('active');
}

// Fechar sidebar ao redimensionar para desktop
window.addEventListener('resize', function() {
    if (window.innerWidth > 768) {
        const sidebar = document.getElementById('mobile-sidebar');
        const overlay = document.getElementById('sidebar-overlay') || document.getElementById('mobile-overlay');
        if (sidebar) sidebar.classList.remove('mobile-open');
        if (overlay) overlay.classList.remove('active');
    }
});

// Criar botao e overlay dinamicamente se nao existirem
document.addEventListener('DOMContentLoaded', function() {
    // Verificar se ja existe botao mobile
    if (!document.querySelector('.mobile-menu-btn')) {
        const btn = document.createElement('button');
        btn.className = 'mobile-menu-btn';
        btn.onclick = toggleMobileSidebar;
        btn.innerHTML = '<i class=" fas fa-bars\></i>';
 document.body.insertBefore(btn, document.body.firstChild);
 }
 
 // Verificar se ja existe overlay
 if (!document.getElementById('mobile-overlay')) {
 const overlay = document.createElement('div');
 overlay.className = 'mobile-overlay';
 overlay.id = 'mobile-overlay';
 overlay.onclick = toggleMobileSidebar;
 document.body.insertBefore(overlay, document.body.firstChild);
 }
 
 // Adicionar id na sidebar se nao tiver
 const sidebar = document.querySelector('.sidebar');
 if (sidebar && !sidebar.id) {
 sidebar.id = 'mobile-sidebar';
 }
});
