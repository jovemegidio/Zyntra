const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'modules', 'Vendas', 'public', 'dashboard.html');

let content = fs.readFileSync(filePath, 'utf8');

// Mapeamento de caracteres com problemas de encoding
const replacements = [
    ['GRÃ‰FICOS', 'GRÁFICOS'],
    ['NotificaÃ§Ãµes', 'Notificações'],
    ['disponÃ­vel', 'disponível'],
    ['TambÃ©m', 'Também'],
    ['TambÃ‰m', 'Também'],
    ['grÃ¡fico', 'gráfico'],
    ['histÃ³ricoMensal', 'historicoMensal'],
    ['histÃ³rico', 'histórico'],
    ['orÃ§amento', 'orcamento'],
    ['notificaÃ§Ãµes', 'notificações'],
    ['VocÃª', 'Você'],
    ['1Ã‰', '1º'],
    ['disponÃ­veis', 'disponíveis'],
    ['Ãºltimo_pedido', 'ultimo_pedido'],
    ['nÃºmero', 'número'],
    ['NÃºmero', 'Número'],
    ['ReuniÃ£o', 'Reunião'],
    ['ReuniÃ‰o', 'Reunião'],
    ['ApresentaÃ§Ã£o', 'Apresentação'],
    ['ProduÃ§Ã£o', 'Produção'],
    ['produÃ§Ã£o', 'produção'],
    ['GestÃ£o', 'Gestão'],
    ['MÃ¡quinas', 'Máquinas'],
    ['mÃ¡quinas', 'máquinas'],
    ['EficiÃªncia', 'Eficiência'],
    ['eficiÃªncia', 'eficiência'],
    ['MÃ©dia', 'Média'],
    ['mÃ©dia', 'média'],
    ['PerÃ­odo', 'Período'],
    ['perÃ­odo', 'período'],
    ['AÃ§Ãµes', 'Ações'],
    ['aÃ§Ãµes', 'ações'],
    ['SeÃ§Ã£o', 'Seção'],
    ['seÃ§Ã£o', 'seção'],
    ['ConclusÃ£o', 'Conclusão'],
    ['conclusÃ£o', 'conclusão'],
    ['RelaÃ§Ã£o', 'Relação'],
    ['relaÃ§Ã£o', 'relação'],
    ['InformaÃ§Ã£o', 'Informação'],
    ['informaÃ§Ã£o', 'informação'],
    ['DescriÃ§Ã£o', 'Descrição'],
    ['descriÃ§Ã£o', 'descrição'],
    ['PrevisÃ£o', 'Previsão'],
    ['previsÃ£o', 'previsão'],
    ['SituaÃ§Ã£o', 'Situação'],
    ['situaÃ§Ã£o', 'situação'],
    ['OperaÃ§Ã£o', 'Operação'],
    ['operaÃ§Ã£o', 'operação'],
    ['AtualizaÃ§Ã£o', 'Atualização'],
    ['atualizaÃ§Ã£o', 'atualização'],
    ['ConfiguraÃ§Ã£o', 'Configuração'],
    ['configuraÃ§Ã£o', 'configuração'],
    ['AlteraÃ§Ã£o', 'Alteração'],
    ['alteraÃ§Ã£o', 'alteração'],
    ['ExclusÃ£o', 'Exclusão'],
    ['exclusÃ£o', 'exclusão'],
    ['ImportaÃ§Ã£o', 'Importação'],
    ['importaÃ§Ã£o', 'importação'],
    ['ExportaÃ§Ã£o', 'Exportação'],
    ['exportaÃ§Ã£o', 'exportação'],
    ['ValidaÃ§Ã£o', 'Validação'],
    ['validaÃ§Ã£o', 'validação'],
    ['AutenticaÃ§Ã£o', 'Autenticação'],
    ['autenticaÃ§Ã£o', 'autenticação'],
    ['AutorizaÃ§Ã£o', 'Autorização'],
    ['autorizaÃ§Ã£o', 'autorização'],
    ['Ã©', 'é'],
    ['Ã¡', 'á'],
    ['Ã­', 'í'],
    ['Ã³', 'ó'],
    ['Ãº', 'ú'],
    ['Ã£', 'ã'],
    ['Ãµ', 'õ'],
    ['Ã§', 'ç'],
    ['Ãª', 'ê'],
    ['Ã¢', 'â'],
    ['Ã´', 'ô'],
];

let count = 0;
for (const [from, to] of replacements) {
    const regex = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const matches = content.match(regex);
    if (matches) {
        count += matches.length;
        content = content.replace(regex, to);
    }
}

fs.writeFileSync(filePath, content, 'utf8');
console.log(`✅ Encoding corrigido! ${count} substituições realizadas em dashboard.html`);
