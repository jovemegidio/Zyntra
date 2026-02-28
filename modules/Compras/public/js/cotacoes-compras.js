/* ========================================
   COTAÇÕES
   ======================================== */

class CotacoesCompras {
    constructor() {
        this.cotacoes = [];
    }

    async init() {
        this.render();
    }

    render() {
        const container = document.getElementById('cotacoes-container');
        if (!container) return;

        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-file-invoice-dollar"></i>
                <h3>Cotações</h3>
                <p>Funcionalidade em desenvolvimento</p>
            </div>
        `;
    }
}

window.cotacoesCompras = new CotacoesCompras();
