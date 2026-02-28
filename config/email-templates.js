/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CONFIGURAÇÁO DE TEMPLATES DE EMAIL - ALUFORCE ERP
 * Sistema de emails com cartões digitais personalizados
 * ══════════════════════════════════════════════════════════════════════════════
 * 
 * EMAILS POR DEPARTAMENTO (para notificações e alertas):
 * ─────────────────────────────────────────────────────────────────────────────
 * RH:         rh@aluforce.ind.br
 * PCP:        pcp@aluforce.ind.br
 * Compras:    compras@aluforce.ind.br
 * Financeiro: financeiro@aluforce.ind.br, contasapagar@aluforce.ind.br, 
 *             contasareceber@aluforce.ind.br
 * TI:         ti@aluforce.ind.br
 * Comercial:  comercial@aluforce.ind.br
 * Produção:   producao@aluforce.ind.br
 * Qualidade:  qualidade@aluforce.ind.br
 * Logística:  logistica@aluforce.ind.br
 * Diretoria:  diretoria@aluforce.ind.br
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÁO DE DESTINATÁRIOS POR MÓDULO/TIPO DE NOTIFICAÇÁO
// ═══════════════════════════════════════════════════════════════════════════════
const destinatariosNotificacao = {
    // Recursos Humanos
    rh: {
        principal: 'rh@aluforce.ind.br',
        alertas: ['rh@aluforce.ind.br'],
        novoFuncionario: ['rh@aluforce.ind.br', 'ti@aluforce.ind.br'],
        ferias: ['rh@aluforce.ind.br'],
        demissao: ['rh@aluforce.ind.br', 'financeiro@aluforce.ind.br', 'ti@aluforce.ind.br'],
        aniversarios: ['rh@aluforce.ind.br']
    },
    
    // PCP - Planejamento e Controle de Produção
    pcp: {
        principal: 'pcp@aluforce.ind.br',
        alertas: ['pcp@aluforce.ind.br'],
        ordemProducao: ['pcp@aluforce.ind.br', 'producao@aluforce.ind.br'],
        atrasoProducao: ['pcp@aluforce.ind.br', 'diretoria@aluforce.ind.br'],
        materiaisFaltantes: ['pcp@aluforce.ind.br', 'compras@aluforce.ind.br']
    },
    
    // Compras
    compras: {
        principal: 'compras@aluforce.ind.br',
        alertas: ['compras@aluforce.ind.br'],
        novaSolicitacao: ['compras@aluforce.ind.br'],
        cotacao: ['compras@aluforce.ind.br'],
        pedidoAprovado: ['compras@aluforce.ind.br', 'financeiro@aluforce.ind.br'],
        estoqueMinimo: ['compras@aluforce.ind.br', 'pcp@aluforce.ind.br']
    },
    
    // Financeiro
    financeiro: {
        principal: 'financeiro@aluforce.ind.br',
        alertas: ['financeiro@aluforce.ind.br'],
        contasPagar: ['contasapagar@aluforce.ind.br', 'financeiro@aluforce.ind.br'],
        contasReceber: ['contasareceber@aluforce.ind.br', 'financeiro@aluforce.ind.br'],
        vencimentos: ['financeiro@aluforce.ind.br', 'contasapagar@aluforce.ind.br'],
        recebimentos: ['financeiro@aluforce.ind.br', 'contasareceber@aluforce.ind.br'],
        fluxoCaixa: ['financeiro@aluforce.ind.br', 'diretoria@aluforce.ind.br']
    },
    
    // Comercial/Vendas
    comercial: {
        principal: 'comercial@aluforce.ind.br',
        alertas: ['comercial@aluforce.ind.br'],
        novoPedido: ['comercial@aluforce.ind.br', 'pcp@aluforce.ind.br'],
        pedidoAprovado: ['comercial@aluforce.ind.br', 'financeiro@aluforce.ind.br']
    },
    
    // TI
    ti: {
        principal: 'ti@aluforce.ind.br',
        alertas: ['ti@aluforce.ind.br'],
        sistemaErro: ['ti@aluforce.ind.br'],
        novoUsuario: ['ti@aluforce.ind.br', 'rh@aluforce.ind.br']
    },
    
    // Diretoria
    diretoria: {
        principal: 'diretoria@aluforce.ind.br',
        alertas: ['diretoria@aluforce.ind.br'],
        relatorios: ['diretoria@aluforce.ind.br']
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAPEAMENTO DE EMAILS PARA FUNCIONÁRIOS (para aniversários)
// ═══════════════════════════════════════════════════════════════════════════════
const funcionariosEmail = {
    // PCP
    'pcp@aluforce.ind.br': {
        nome: 'Clemerson',
        sexo: 'M',
        departamento: 'PCP',
        cartaoAniversario: 'Feliz Aniversário - SGE (Clemerson).jpg'
    },
    // TI
    'ti@aluforce.ind.br': {
        nome: 'Egidio',
        sexo: 'M',
        departamento: 'TI',
        cartaoAniversario: 'Feliz Aniversário - SGE (T.I).jpg'
    },
    // RH
    'rh@aluforce.ind.br': {
        nome: 'Renata',
        sexo: 'F',
        departamento: 'RH',
        cartaoAniversario: 'Feliz Aniversário - SGE (Renata).jpg'
    },
    // Comercial
    'fernando.kofugi@aluforce.ind.br': {
        nome: 'Fernando',
        sexo: 'M',
        departamento: 'Comercial',
        cartaoAniversario: 'Feliz Aniversário - SGE (Fernando).jpg'
    },
    'marcia.scarcella@aluforce.ind.br': {
        nome: 'Márcia Scarcella',
        sexo: 'F',
        departamento: 'Comercial',
        cartaoAniversario: 'Feliz Aniversário - SGE (Márcia).jpg'
    },
    'representantes@aluforce.ind.br': {
        nome: 'Márcia Scarcella',
        sexo: 'F',
        departamento: 'Comercial',
        cartaoAniversario: 'Feliz Aniversário - SGE (Márcia).jpg'
    },
    // Financeiro
    'financeiro@aluforce.ind.br': {
        nome: 'Márcia',
        sexo: 'F',
        departamento: 'Financeiro',
        cartaoAniversario: 'Feliz Aniversário - SGE (Márcia).jpg'
    },
    'fabiola.souza@aluforce.ind.br': {
        nome: 'Fabíola',
        sexo: 'F',
        departamento: 'Financeiro',
        cartaoAniversario: null
    },
    'tatiane@aluforce.ind.br': {
        nome: 'Tatiane',
        sexo: 'F',
        departamento: 'Financeiro',
        cartaoAniversario: null
    },
    'contasapagar@aluforce.ind.br': {
        nome: 'Contas a Pagar',
        sexo: 'F',
        departamento: 'Financeiro',
        cartaoAniversario: null
    },
    'contasareceber@aluforce.ind.br': {
        nome: 'Contas a Receber',
        sexo: 'F',
        departamento: 'Financeiro',
        cartaoAniversario: null
    },
    // Produção
    'fabiano.marques@aluforce.ind.br': {
        nome: 'Fabiano',
        sexo: 'M',
        departamento: 'Produção',
        cartaoAniversario: 'Feliz Aniversário - SGE (Fabiano).jpg'
    },
    // Qualidade
    'qualidade@aluforce.ind.br': {
        nome: 'Felipe Simões',
        sexo: 'M',
        departamento: 'Qualidade',
        cartaoAniversario: 'Feliz Aniversário - SGE (Guilherme).jpg'
    },
    // Logística
    'logistica@aluforce.ind.br': {
        nome: 'Junior',
        sexo: 'M',
        departamento: 'Logística',
        cartaoAniversario: 'Feliz Aniversário - SGE (Junior).jpg'
    },
    'lorena@aluforce.ind.br': {
        nome: 'Lorena',
        sexo: 'F',
        departamento: 'Logística',
        cartaoAniversario: null
    },
    // Diretoria
    'diretoria@aluforce.ind.br': {
        nome: 'Antonio',
        sexo: 'M',
        departamento: 'Diretoria',
        cartaoAniversario: 'Feliz Aniversário - Antonio.jpg'
    },
    // Compras
    'compras@aluforce.ind.br': {
        nome: 'Compras',
        sexo: 'M',
        departamento: 'Compras',
        cartaoAniversario: null
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// PATHS DOS ARQUIVOS DE CARTÕES (detecta automaticamente o ambiente)
// ═══════════════════════════════════════════════════════════════════════════════
const path = require('path');

// Base path - detecta se está no servidor Linux ou Windows local
const isLinux = process.platform === 'linux';
const basePath = isLinux 
    ? '/var/www/aluforce/emails-sge'
    : path.join(__dirname, '..', 'emails-sge');

const paths = {
    cartoes: path.join(basePath, 'Aniversariantes'),
    boasVindas: path.join(basePath, 'Boas Vindas'),
    icones: path.join(basePath, 'Icone - Email')
};

// Cartões de Boas-Vindas por sexo
const cartoesBoasVindas = {
    M: 'Seja Bem Vindo.jpg',
    F: 'Seja Bem Vinda.jpg'
};

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATES DE EMAIL POR OCASIÁO
// ═══════════════════════════════════════════════════════════════════════════════
const templates = {
    // ─────────────────────────────────────────────────────────────────────────
    // ANIVERSÁRIO
    // ─────────────────────────────────────────────────────────────────────────
    aniversario: {
        assunto: '🎂 Feliz Aniversário, {nome}! A ALUFORCE celebra você!',
        htmlComCartao: (nome) => `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 650px; margin: 0 auto; background: #ffffff;">
                <div style="text-align: center; padding: 0;">
                    <img src="cid:cartao-aniversario" alt="Feliz Aniversário ${nome}" style="max-width: 100%; height: auto; display: block;">
                </div>
                <div style="background: linear-gradient(135deg, #263238 0%, #37474f 100%); padding: 20px; text-align: center;">
                    <p style="margin: 0; color: white; font-size: 14px;">
                        <strong>ALUFORCE</strong> - Sistema ERP Integrado
                    </p>
                    <p style="margin: 8px 0 0; color: rgba(255,255,255,0.6); font-size: 11px;">
                        © 2026 ALUFORCE - Este é um email automático do sistema
                    </p>
                </div>
            </div>
        `,
        htmlSemCartao: (nome) => `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border-radius: 16px; overflow: hidden; box-shadow: 0 8px 30px rgba(0,0,0,0.12);">
                <div style="background: linear-gradient(135deg, #ff6b35 0%, #f7931e 50%, #ffd700 100%); padding: 50px 40px; text-align: center;">
                    <div style="background: rgba(255,255,255,0.2); border-radius: 50%; width: 100px; height: 100px; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
                        <span style="font-size: 60px;">🎂</span>
                    </div>
                    <h1 style="color: white; margin: 0; font-size: 32px; font-weight: 700; text-shadow: 2px 2px 4px rgba(0,0,0,0.2);">
                        Feliz Aniversário, ${nome}!
                    </h1>
                    <p style="color: rgba(255,255,255,0.95); margin: 15px 0 0; font-size: 18px;">🎉🎈🎁</p>
                </div>
                <div style="background: #ffffff; padding: 40px; text-align: center;">
                    <p style="font-size: 18px; color: #333; line-height: 1.8;">
                        A família <strong style="color: #1565c0;">ALUFORCE</strong> deseja a você um dia incrível!
                    </p>
                    <p style="font-size: 16px; color: #666; margin-top: 20px;">
                        Que este novo ciclo seja cheio de sucesso e felicidade! 🥳
                    </p>
                </div>
                <div style="background: #263238; padding: 20px; text-align: center;">
                    <p style="color: rgba(255,255,255,0.6); font-size: 12px; margin: 0;">© 2026 ALUFORCE - Sistema ERP Integrado</p>
                </div>
            </div>
        `
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // BOAS-VINDAS (com cartão por sexo)
    // ─────────────────────────────────────────────────────────────────────────
    boasVindas: {
        assuntoM: '🚀 Seja Bem-Vindo à ALUFORCE, {nome}!',
        assuntoF: '🚀 Seja Bem-Vinda à ALUFORCE, {nome}!',
        htmlComCartao: (nome, login, senha, sexo) => `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 650px; margin: 0 auto; background: #ffffff;">
                <div style="text-align: center; padding: 0;">
                    <img src="cid:cartao-boasvindas" alt="${sexo === 'F' ? 'Seja Bem-Vinda' : 'Seja Bem-Vindo'} ${nome}" style="max-width: 100%; height: auto; display: block;">
                </div>
                <div style="background: linear-gradient(135deg, #263238 0%, #37474f 100%); padding: 20px; text-align: center;">
                    <p style="margin: 0; color: white; font-size: 14px;"><strong>ALUFORCE</strong> - Sistemas de Alumínio</p>
                    <p style="margin: 8px 0 0; color: rgba(255,255,255,0.6); font-size: 11px;">© 2026 ALUFORCE - Este é um email automático</p>
                </div>
            </div>
        `,
        htmlSemCartao: (nome, login, senha, sexo) => `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border-radius: 16px; overflow: hidden; box-shadow: 0 8px 30px rgba(0,0,0,0.12);">
                <div style="background: linear-gradient(135deg, #1565c0 0%, #0d47a1 50%, #1a237e 100%); padding: 50px 40px; text-align: center;">
                    <span style="font-size: 60px;">🚀</span>
                    <h1 style="color: white; margin: 20px 0 0; font-size: 28px;">${sexo === 'F' ? 'Seja Bem-Vinda' : 'Seja Bem-Vindo'}, ${nome}!</h1>
                    <p style="color: rgba(255,255,255,0.9); margin: 15px 0 0;">É uma alegria ter você em nossa equipe!</p>
                </div>
                <div style="background: #263238; padding: 20px; text-align: center;">
                    <p style="color: white; font-size: 14px; margin: 0;"><strong>ALUFORCE</strong> - Sistemas de Alumínio</p>
                    <p style="color: rgba(255,255,255,0.6); font-size: 12px; margin: 8px 0 0;">© 2026 ALUFORCE - Este é um email automático</p>
                </div>
            </div>
        `
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // RECUPERAÇÁO DE SENHA
    // ─────────────────────────────────────────────────────────────────────────
    recuperacaoSenha: {
        assunto: 'Recuperação de Senha - Zyntra',
        html: (nome, novaSenha) => `
<div style="margin:0;padding:0;background-color:#1a1a2e;width:100%;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="#1a1a2e" style="background-color:#1a1a2e;">
    <tr><td align="center" bgcolor="#1a1a2e" style="padding:32px 16px;background-color:#1a1a2e;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="520" style="max-width:520px;width:100%;">

        <!-- LOGO -->
        <tr><td bgcolor="#1a1a2e" style="padding:24px 0 28px;text-align:center;background-color:#1a1a2e;">
          <img src="https://aluforce.api.br/images/zyntra-branco.png" alt="Zyntra" style="height:48px;width:auto;display:inline-block;" />
        </td></tr>

        <!-- CARD -->
        <tr><td bgcolor="#242442" style="background-color:#242442;border-radius:16px;overflow:hidden;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="#242442">

            <!-- CONTENT -->
            <tr><td bgcolor="#242442" style="padding:40px 36px 32px;background-color:#242442;">
              <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:16px;color:#e2e8f0;margin:0 0 8px;">Olá <strong>${nome}</strong>,</p>
              <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;color:#94a3b8;margin:0 0 28px;line-height:1.6;">Sua senha foi redefinida. Use a nova senha abaixo para acessar o sistema:</p>

              <!-- PASSWORD BOX -->
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 20px;">
                <tr><td bgcolor="#1a1a2e" style="background-color:#1a1a2e;border-radius:12px;padding:24px;text-align:center;">
                  <span style="font-family:'Courier New',monospace;font-size:28px;font-weight:700;letter-spacing:4px;color:#ffffff;">${novaSenha}</span>
                </td></tr>
              </table>

              <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;color:#94a3b8;text-align:center;margin:0 0 28px;">Copie esta senha e use na tela de login para acessar sua conta.</p>

              <!-- CTA BUTTON -->
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;">
                <tr><td align="center">
                  <a href="https://aluforce.api.br/login.html" target="_blank" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;font-family:'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:600;padding:14px 40px;border-radius:10px;text-decoration:none;">Acessar o Sistema</a>
                </td></tr>
              </table>

              <!-- SECURITY WARNING BOX -->
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;">
                <tr><td bgcolor="#1e1e3a" style="background-color:#1e1e3a;border-radius:10px;padding:16px 20px;border-left:3px solid #f59e0b;">
                  <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#fbbf24;margin:0 0 6px;font-weight:600;">⚠️ Importante</p>
                  <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#cbd5e1;margin:0;line-height:1.5;">Recomendamos alterar sua senha após o primeiro acesso para manter sua conta protegida.</p>
                </td></tr>
              </table>

              <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#94a3b8;margin:0;line-height:1.6;">Se você não solicitou a redefinição de senha, entre em contato com o administrador do sistema imediatamente.</p>
            </td></tr>

            <!-- DIVIDER -->
            <tr><td bgcolor="#242442" style="padding:0 36px;background-color:#242442;"><div style="height:1px;background-color:#374151;"></div></td></tr>

            <!-- FOOTER -->
            <tr><td bgcolor="#242442" style="padding:20px 36px 28px;background-color:#242442;">
              <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#64748b;margin:0;text-align:center;">— Zyntra</p>
              <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#475569;margin:8px 0 0;text-align:center;">Este é um email automático, não responda.</p>
            </td></tr>

          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</div>
        `
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // NOTIFICAÇÕES RH
    // ─────────────────────────────────────────────────────────────────────────
    notificacaoRH: {
        novoFuncionario: {
            assunto: '👤 Novo Funcionário Cadastrado: {nome}',
            html: (funcionario) => `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border-radius: 16px; overflow: hidden; box-shadow: 0 8px 30px rgba(0,0,0,0.12);">
                    <div style="background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); padding: 40px; text-align: center;">
                        <span style="font-size: 50px;">👤</span>
                        <h1 style="color: white; margin: 15px 0 0; font-size: 24px;">Novo Funcionário Cadastrado</h1>
                    </div>
                    <div style="background: #ffffff; padding: 40px;">
                        <div style="background: #f3e8ff; border-radius: 12px; padding: 20px; margin: 20px 0;">
                            <p style="margin: 8px 0;"><strong>Nome:</strong> ${funcionario.nome}</p>
                            <p style="margin: 8px 0;"><strong>CPF:</strong> ${funcionario.cpf}</p>
                            <p style="margin: 8px 0;"><strong>Cargo:</strong> ${funcionario.cargo}</p>
                            <p style="margin: 8px 0;"><strong>Departamento:</strong> ${funcionario.departamento}</p>
                            <p style="margin: 8px 0;"><strong>Data Admissão:</strong> ${funcionario.dataAdmissao}</p>
                        </div>
                    </div>
                    <div style="background: #263238; padding: 20px; text-align: center;">
                        <p style="color: rgba(255,255,255,0.6); font-size: 12px; margin: 0;">© 2026 ALUFORCE - Sistema ERP</p>
                    </div>
                </div>
            `
        },
        solicitacaoFerias: {
            assunto: '🏖️ Solicitação de Férias: {nome}',
            html: (dados) => `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border-radius: 16px; overflow: hidden;">
                    <div style="background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); padding: 40px; text-align: center;">
                        <span style="font-size: 50px;">🏖️</span>
                        <h1 style="color: white; margin: 15px 0 0; font-size: 24px;">Solicitação de Férias</h1>
                    </div>
                    <div style="background: #ffffff; padding: 40px;">
                        <div style="background: #e0f2fe; border-radius: 12px; padding: 20px;">
                            <p style="margin: 8px 0;"><strong>Funcionário:</strong> ${dados.nome}</p>
                            <p style="margin: 8px 0;"><strong>Período:</strong> ${dados.dataInicio} a ${dados.dataFim}</p>
                            <p style="margin: 8px 0;"><strong>Dias:</strong> ${dados.dias}</p>
                        </div>
                    </div>
                    <div style="background: #263238; padding: 20px; text-align: center;">
                        <p style="color: rgba(255,255,255,0.6); font-size: 12px; margin: 0;">© 2026 ALUFORCE</p>
                    </div>
                </div>
            `
        }
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // NOTIFICAÇÕES PCP
    // ─────────────────────────────────────────────────────────────────────────
    notificacaoPCP: {
        ordemProducao: {
            assunto: '🏭 Nova Ordem de Produção: {numero}',
            html: (ordem) => `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border-radius: 16px; overflow: hidden;">
                    <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 40px; text-align: center;">
                        <span style="font-size: 50px;">🏭</span>
                        <h1 style="color: white; margin: 15px 0 0; font-size: 24px;">Nova Ordem de Produção</h1>
                    </div>
                    <div style="background: #ffffff; padding: 40px;">
                        <div style="background: #fef3c7; border-radius: 12px; padding: 20px;">
                            <p style="margin: 8px 0;"><strong>OP Nº:</strong> ${ordem.numero}</p>
                            <p style="margin: 8px 0;"><strong>Produto:</strong> ${ordem.produto}</p>
                            <p style="margin: 8px 0;"><strong>Quantidade:</strong> ${ordem.quantidade}</p>
                            <p style="margin: 8px 0;"><strong>Prazo:</strong> ${ordem.prazo}</p>
                        </div>
                    </div>
                    <div style="background: #263238; padding: 20px; text-align: center;">
                        <p style="color: rgba(255,255,255,0.6); font-size: 12px; margin: 0;">© 2026 ALUFORCE</p>
                    </div>
                </div>
            `
        }
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // NOTIFICAÇÕES COMPRAS
    // ─────────────────────────────────────────────────────────────────────────
    notificacaoCompras: {
        novaSolicitacao: {
            assunto: '📦 Nova Solicitação de Compra: {descricao}',
            html: (solicitacao) => `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border-radius: 16px; overflow: hidden;">
                    <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px; text-align: center;">
                        <span style="font-size: 50px;">📦</span>
                        <h1 style="color: white; margin: 15px 0 0; font-size: 24px;">Nova Solicitação de Compra</h1>
                    </div>
                    <div style="background: #ffffff; padding: 40px;">
                        <div style="background: #d1fae5; border-radius: 12px; padding: 20px;">
                            <p style="margin: 8px 0;"><strong>Material:</strong> ${solicitacao.material}</p>
                            <p style="margin: 8px 0;"><strong>Quantidade:</strong> ${solicitacao.quantidade}</p>
                            <p style="margin: 8px 0;"><strong>Solicitante:</strong> ${solicitacao.solicitante}</p>
                            <p style="margin: 8px 0;"><strong>Urgência:</strong> ${solicitacao.urgencia}</p>
                        </div>
                    </div>
                    <div style="background: #263238; padding: 20px; text-align: center;">
                        <p style="color: rgba(255,255,255,0.6); font-size: 12px; margin: 0;">© 2026 ALUFORCE</p>
                    </div>
                </div>
            `
        },
        estoqueMinimo: {
            assunto: '⚠️ Alerta: Estoque Mínimo - {produto}',
            html: (dados) => `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border-radius: 16px; overflow: hidden;">
                    <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 40px; text-align: center;">
                        <span style="font-size: 50px;">⚠️</span>
                        <h1 style="color: white; margin: 15px 0 0; font-size: 24px;">Alerta de Estoque Mínimo</h1>
                    </div>
                    <div style="background: #ffffff; padding: 40px;">
                        <div style="background: #fee2e2; border-radius: 12px; padding: 20px;">
                            <p style="margin: 8px 0;"><strong>Produto:</strong> ${dados.produto}</p>
                            <p style="margin: 8px 0;"><strong>Estoque Atual:</strong> ${dados.estoqueAtual}</p>
                            <p style="margin: 8px 0;"><strong>Estoque Mínimo:</strong> ${dados.estoqueMinimo}</p>
                        </div>
                    </div>
                    <div style="background: #263238; padding: 20px; text-align: center;">
                        <p style="color: rgba(255,255,255,0.6); font-size: 12px; margin: 0;">© 2026 ALUFORCE</p>
                    </div>
                </div>
            `
        }
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // NOTIFICAÇÕES FINANCEIRO
    // ─────────────────────────────────────────────────────────────────────────
    notificacaoFinanceiro: {
        contaPagar: {
            assunto: '💸 Conta a Pagar Vencendo: {descricao}',
            html: (conta) => `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border-radius: 16px; overflow: hidden;">
                    <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 40px; text-align: center;">
                        <span style="font-size: 50px;">💸</span>
                        <h1 style="color: white; margin: 15px 0 0; font-size: 24px;">Conta a Pagar</h1>
                    </div>
                    <div style="background: #ffffff; padding: 40px;">
                        <div style="background: #fee2e2; border-radius: 12px; padding: 20px;">
                            <p style="margin: 8px 0;"><strong>Fornecedor:</strong> ${conta.fornecedor}</p>
                            <p style="margin: 8px 0;"><strong>Descrição:</strong> ${conta.descricao}</p>
                            <p style="margin: 8px 0;"><strong>Valor:</strong> R$ ${conta.valor}</p>
                            <p style="margin: 8px 0;"><strong>Vencimento:</strong> ${conta.vencimento}</p>
                        </div>
                    </div>
                    <div style="background: #263238; padding: 20px; text-align: center;">
                        <p style="color: rgba(255,255,255,0.6); font-size: 12px; margin: 0;">© 2026 ALUFORCE</p>
                    </div>
                </div>
            `
        },
        contaReceber: {
            assunto: '💰 Conta a Receber: {descricao}',
            html: (conta) => `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border-radius: 16px; overflow: hidden;">
                    <div style="background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); padding: 40px; text-align: center;">
                        <span style="font-size: 50px;">💰</span>
                        <h1 style="color: white; margin: 15px 0 0; font-size: 24px;">Conta a Receber</h1>
                    </div>
                    <div style="background: #ffffff; padding: 40px;">
                        <div style="background: #dcfce7; border-radius: 12px; padding: 20px;">
                            <p style="margin: 8px 0;"><strong>Cliente:</strong> ${conta.cliente}</p>
                            <p style="margin: 8px 0;"><strong>Descrição:</strong> ${conta.descricao}</p>
                            <p style="margin: 8px 0;"><strong>Valor:</strong> R$ ${conta.valor}</p>
                            <p style="margin: 8px 0;"><strong>Vencimento:</strong> ${conta.vencimento}</p>
                        </div>
                    </div>
                    <div style="background: #263238; padding: 20px; text-align: center;">
                        <p style="color: rgba(255,255,255,0.6); font-size: 12px; margin: 0;">© 2026 ALUFORCE</p>
                    </div>
                </div>
            `
        }
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // NOTIFICAÇÁO GERAL
    // ─────────────────────────────────────────────────────────────────────────
    notificacaoGeral: {
        assunto: '📢 {titulo} - ALUFORCE',
        html: (titulo, mensagem, nome) => `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border-radius: 16px; overflow: hidden;">
                <div style="background: linear-gradient(135deg, #1565c0 0%, #0d47a1 100%); padding: 40px; text-align: center;">
                    <span style="font-size: 50px;">📢</span>
                    <h1 style="color: white; margin: 15px 0 0; font-size: 24px;">${titulo}</h1>
                </div>
                <div style="background: #ffffff; padding: 40px;">
                    <p style="font-size: 16px; color: #333;">Olá, <strong>${nome}</strong>!</p>
                    <div style="color: #555; line-height: 1.8;">${mensagem}</div>
                </div>
                <div style="background: #263238; padding: 20px; text-align: center;">
                    <p style="color: rgba(255,255,255,0.6); font-size: 12px; margin: 0;">© 2026 ALUFORCE</p>
                </div>
            </div>
        `
    }
};

module.exports = {
    funcionariosEmail,
    destinatariosNotificacao,
    templates,
    paths,
    cartoesBoasVindas
};
