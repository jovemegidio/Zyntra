/* ========================================
   MATERIAIS
   ======================================== */

class MateriaisCompras {
    constructor() {
        this.materiais = [];
    }

    async init() {
        this.render();
    }

    render() {
        const container = document.getElementById('materiais-container');
        if (!container) return;

        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-cubes"></i>
                <h3>Materiais</h3>
                <p>Funcionalidade em desenvolvimento</p>
            </div>
        `;
    }
}

window.materiaisCompras = new MateriaisCompras();
