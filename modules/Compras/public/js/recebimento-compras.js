/* ========================================
   RECEBIMENTO
   ======================================== */

class RecebimentoCompras {
    constructor() {}

    async init() {
        this.render();
    }

    render() {
        const container = document.getElementById('recebimento-container');
        if (!container) return;

        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-truck-loading"></i>
                <h3>Recebimento</h3>
                <p>Funcionalidade em desenvolvimento</p>
            </div>
        `;
    }
}

window.recebimentoCompras = new RecebimentoCompras();
