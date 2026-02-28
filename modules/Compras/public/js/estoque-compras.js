/* ========================================
   ESTOQUE
   ======================================== */

class EstoqueCompras {
    constructor() {}

    async init() {
        this.render();
    }

    render() {
        const container = document.getElementById('estoque-container');
        if (!container) return;

        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-boxes"></i>
                <h3>Gestão de Estoque</h3>
                <p>Funcionalidade em desenvolvimento</p>
            </div>
        `;
    }
}

window.estoqueCompras = new EstoqueCompras();
