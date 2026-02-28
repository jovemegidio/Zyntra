const express = require('express');

module.exports = function createApiNfeRouter({ pool, authenticateToken, authorizeArea }) {
  const router = express.Router();
  router.use(authenticateToken);
  router.use(authorizeArea('nfe'));

  // 1. Dashboard NFe - NOVA FUNCIONALIDADE
  router.get('/dashboard', async (req, res, next) => {
    try {
      // NFes emitidas no mês
      const [nfesMes] = await pool.query(`
        SELECT COUNT(*) as total, COALESCE(SUM(valor), 0) as valor_total
        FROM nfe 
        WHERE MONTH(data_emissao) = MONTH(CURRENT_DATE()) 
        AND YEAR(data_emissao) = YEAR(CURRENT_DATE())
      `);
      
      // NFes por status
      const [nfesPorStatus] = await pool.query(`
        SELECT status, COUNT(*) as quantidade
        FROM nfe 
        WHERE MONTH(data_emissao) = MONTH(CURRENT_DATE()) 
        AND YEAR(data_emissao) = YEAR(CURRENT_DATE())
        GROUP BY status
      `);
      
      // Impostos arrecadados
      const [impostos] = await pool.query(`
        SELECT 
          COALESCE(SUM(iss), 0) as total_iss,
          COALESCE(SUM(pis), 0) as total_pis,
          COALESCE(SUM(cofins), 0) as total_cofins,
          COALESCE(SUM(irrf), 0) as total_irrf
        FROM nfe 
        WHERE status = 'autorizada'
        AND MONTH(data_emissao) = MONTH(CURRENT_DATE()) 
        AND YEAR(data_emissao) = YEAR(CURRENT_DATE())
      `);

      res.json({
        success: true,
        data: {
          resumo_mes: {
            total_nfes: nfesMes[0].total,
            valor_total: nfesMes[0].valor_total
          },
          status_distribuicao: nfesPorStatus,
          impostos_mes: impostos[0],
          periodo: new Date().toISOString().slice(0, 7)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // 2. Listagem de NFes com filtros avançados
  router.get('/notas', async (req, res, next) => {
    try {
      const { page = 1, limit = 20, status, cliente_id, data_inicio, data_fim } = req.query;
      const offset = (page - 1) * limit;
      
      let whereClause = 'WHERE 1=1';
      const params = [];
      
      if (status) {
        whereClause += ' AND n.status = ?';
        params.push(status);
      }
      
      if (cliente_id) {
        whereClause += ' AND n.cliente_id = ?';
        params.push(cliente_id);
      }
      
      if (data_inicio && data_fim) {
        whereClause += ' AND n.data_emissao BETWEEN ? AND ?';
        params.push(data_inicio, data_fim);
      }
      
      const [notas] = await pool.query(`
        SELECT 
          n.*,
          c.nome as cliente_nome,
          c.cnpj as cliente_cnpj
        FROM nfe n
        LEFT JOIN clientes c ON n.cliente_id = c.id
        ${whereClause}
        ORDER BY n.data_emissao DESC
        LIMIT ? OFFSET ?
      `, [...params, parseInt(limit), offset]);

      res.json({
        success: true,
        data: { notas }
      });
    } catch (error) {
      next(error);
    }
  });

  // 3. Cálculo Automático de Impostos MELHORADO
  // Integrado com configurações centralizadas do sistema
  router.post('/calcular-impostos', async (req, res, next) => {
    try {
      const { valor, municipio, tipo_servico, cliente_cnpj } = req.body;
      
      if (!valor || valor <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Valor deve ser maior que zero'
        });
      }
      
      // Buscar configurações de impostos do sistema
      let configSistema = null;
      if (global.getConfiguracoesImpostos) {
        try {
          configSistema = await global.getConfiguracoesImpostos();
        } catch (e) {
          console.log('Não foi possível buscar config de impostos:', e.message);
        }
      }
      
      // Alíquotas baseadas no sistema ou valores padrão
      const aliquotas = {
        iss: configSistema?.iss ? parseFloat(configSistema.iss) / 100 : (municipio === 'SP' ? 0.05 : 0.03),
        pis: configSistema?.pis ? parseFloat(configSistema.pis) / 100 : 0.0065,
        cofins: configSistema?.cofins ? parseFloat(configSistema.cofins) / 100 : 0.03,
        csll: configSistema?.csll ? parseFloat(configSistema.csll) / 100 : 0.01,
        irrf: configSistema?.irpj ? parseFloat(configSistema.irpj) / 100 : 0.015
      };
      
      // Ajustes baseados no tipo de serviço
      if (tipo_servico === 'construcao') {
        aliquotas.iss = 0.02; // ISS reduzido para construção
      }
      
      const impostos = {
        iss: valor * aliquotas.iss,
        pis: valor * aliquotas.pis,
        cofins: valor * aliquotas.cofins,
        csll: valor * aliquotas.csll,
        irrf: valor * aliquotas.irrf
      };
      
      const total_impostos = Object.values(impostos).reduce((sum, tax) => sum + tax, 0);
      const valor_liquido = valor - total_impostos;

      res.json({
        success: true,
        data: {
          valor_bruto: valor,
          impostos,
          total_impostos,
          valor_liquido,
          aliquotas_aplicadas: aliquotas,
          config_sistema: configSistema ? {
            regime: configSistema.regime_tributario,
            fonte: 'configuracoes_sistema'
          } : { fonte: 'valores_padrao' }
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // 4. Sugestão de Preenchimento com Base no Histórico MELHORADA
  router.get('/sugestao/:cliente_id', async (req, res, next) => {
    try {
      const { cliente_id } = req.params;
      
      // Buscar últimas NFes do cliente
      const [historico] = await pool.query(`
        SELECT 
          descricao_servico,
          valor,
          iss,
          pis,
          cofins,
          irrf,
          COUNT(*) as frequencia
        FROM nfe 
        WHERE cliente_id = ? AND status = 'autorizada'
        GROUP BY descricao_servico, valor, iss, pis, cofins, irrf
        ORDER BY COUNT(*) DESC, data_emissao DESC 
        LIMIT 5
      `, [cliente_id]);
      
      // Calcular valores médios
      const [medias] = await pool.query(`
        SELECT 
          AVG(valor) as valor_medio,
          AVG(iss) as iss_medio,
          COUNT(*) as total_nfes
        FROM nfe 
        WHERE cliente_id = ? AND status = 'autorizada'
      `, [cliente_id]);

      res.json({
        success: true,
        data: {
          servicos_frequentes: historico,
          estatisticas: medias[0],
          tem_historico: historico.length > 0
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // 5. Validação de Dados em Tempo Real MELHORADA
  router.post('/validar-cliente', async (req, res, next) => {
    try {
      const { cnpj, cpf, inscricao_municipal, email } = req.body;
      
      const validacoes = {
        documento: false,
        inscricao: false,
        email: false
      };
      
      // Validar CNPJ ou CPF (simulação básica)
      if (cnpj && cnpj.length >= 14) {
        validacoes.documento = true;
      } else if (cpf && cpf.length >= 11) {
        validacoes.documento = true;
      }
      
      // Validar inscrição municipal
      if (inscricao_municipal && inscricao_municipal.length >= 6) {
        validacoes.inscricao = true;
      }
      
      // Validar email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (email && emailRegex.test(email)) {
        validacoes.email = true;
      }
      
      const todas_validas = Object.values(validacoes).every(v => v);

      res.json({
        success: true,
        data: {
          valido: todas_validas,
          validacoes,
          mensagem: todas_validas ? 'Todos os dados são válidos' : 'Alguns dados precisam ser corrigidos'
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // 6. Emissão de NF-e MELHORADA
  router.post('/emitir', async (req, res, next) => {
    try {
      const { 
        cliente_id, 
        descricao_servico, 
        valor, 
        impostos, 
        data_vencimento,
        observacoes 
      } = req.body;
      
      if (!cliente_id || !descricao_servico || !valor || !impostos) {
        return res.status(400).json({
          success: false,
          message: 'Dados obrigatórios: cliente_id, descricao_servico, valor, impostos'
        });
      }
      
      // Iniciar transação
      const connection = await pool.getConnection();
      await connection.beginTransaction();
      
      try {
        // Gerar número da NFe (simulação)
        const numero_nfe = Math.floor(Math.random() * 1000000);
        
        // Inserir NFe
        const [nfeResult] = await connection.query(`
          INSERT INTO nfe 
          (numero, cliente_id, descricao_servico, valor, iss, pis, cofins, irrf, csll, status, data_emissao, observacoes, usuario_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'autorizada', NOW(), ?, ?)
        `, [
          numero_nfe,
          cliente_id, 
          descricao_servico, 
          valor,
          impostos.iss || 0,
          impostos.pis || 0,
          impostos.cofins || 0,
          impostos.irrf || 0,
          impostos.csll || 0,
          observacoes,
          req.user.id
        ]);
        
        // Integrar com financeiro (criar conta a receber)
        if (data_vencimento) {
          await connection.query(`
            INSERT INTO contas_receber 
            (cliente_id, valor, data_vencimento, descricao, categoria, status, nfe_id)
            VALUES (?, ?, ?, ?, 'servicos', 'pendente', ?)
          `, [cliente_id, valor, data_vencimento, `NFe ${numero_nfe} - ${descricao_servico}`, nfeResult.insertId]);
        }
        
        await connection.commit();
        
        res.status(201).json({
          success: true,
          message: 'NFe emitida com sucesso',
          data: {
            id: nfeResult.insertId,
            numero: numero_nfe,
            valor,
            status: 'autorizada'
          }
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      next(error);
    }
  });

  // 7. Relatórios NFe - NOVA FUNCIONALIDADE
  router.get('/relatorios/impostos-periodo', async (req, res, next) => {
    try {
      const { data_inicio, data_fim, agrupamento = 'mes' } = req.query;
      
      if (!data_inicio || !data_fim) {
        return res.status(400).json({
          success: false,
          message: 'Data de início e fim são obrigatórias'
        });
      }
      
      let dateFormat = '%Y-%m'; // Por padrão agrupa por mês
      if (agrupamento === 'dia') {
        dateFormat = '%Y-%m-%d';
      } else if (agrupamento === 'ano') {
        dateFormat = '%Y';
      }
      
      const [impostos] = await pool.query(`
        SELECT 
          DATE_FORMAT(data_emissao, ?) as periodo,
          COUNT(*) as total_nfes,
          SUM(valor) as valor_total,
          SUM(iss) as total_iss,
          SUM(pis) as total_pis,
          SUM(cofins) as total_cofins,
          SUM(irrf) as total_irrf,
          SUM(csll) as total_csll
        FROM nfe 
        WHERE data_emissao BETWEEN ? AND ? 
        AND status = 'autorizada'
        GROUP BY DATE_FORMAT(data_emissao, ?)
        ORDER BY periodo ASC
      `, [dateFormat, data_inicio, data_fim, dateFormat]);

      res.json({
        success: true,
        data: {
          periodo: { inicio: data_inicio, fim: data_fim },
          agrupamento,
          impostos
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // 8. Envio Automático por E-mail MELHORADO
  router.post('/enviar-email', async (req, res, next) => {
    try {
      const { nfe_id, email_cliente, incluir_xml = true, incluir_pdf = true } = req.body;
      
      if (!nfe_id || !email_cliente) {
        return res.status(400).json({
          success: false,
          message: 'ID da NFe e email do cliente são obrigatórios'
        });
      }
      
      // Buscar dados da NFe
      const [nfe] = await pool.query(`
        SELECT n.*, c.nome as cliente_nome 
        FROM nfe n 
        LEFT JOIN clientes c ON n.cliente_id = c.id 
        WHERE n.id = ?
      `, [nfe_id]);
      
      if (!nfe.length) {
        return res.status(404).json({
          success: false,
          message: 'NFe não encontrada'
        });
      }
      
      // Simular envio de email
      const anexos = [];
      if (incluir_pdf) anexos.push('PDF');
      if (incluir_xml) anexos.push('XML');
      
      // Registrar envio no banco
      await pool.query(`
        UPDATE nfe 
        SET email_enviado = true, data_envio_email = NOW() 
        WHERE id = ?
      `, [nfe_id]);

      res.json({
        success: true,
        message: `Email enviado para ${email_cliente}`,
        data: {
          destinatario: email_cliente,
          anexos,
          nfe_numero: nfe[0].numero,
          data_envio: new Date().toISOString()
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // 6. Cancelamento e Carta de Correção
  router.post('/cancelar/:nfe_id', async (req, res, next) => {
    try {
      const { nfe_id } = req.params;
      const { motivo } = req.body;
      await pool.query('UPDATE nfe SET status = "cancelada", motivo_cancelamento = ? WHERE id = ?', [motivo, nfe_id]);
      res.json({ message: 'NF-e cancelada.' });
    } catch (error) { next(error); }
  });

  router.post('/carta-correcao/:nfe_id', async (req, res, next) => {
    try {
      const { nfe_id } = req.params;
      const { correcao } = req.body;
      await pool.query('UPDATE nfe SET carta_correcao = ? WHERE id = ?', [correcao, nfe_id]);
      res.json({ message: 'Carta de Correção registrada.' });
    } catch (error) { next(error); }
  });

  // 7. Relatórios Gerenciais
  router.get('/relatorios/faturamento', async (req, res, next) => {
    const { inicio, fim, cliente_id, servico_id } = req.query;
    let where = 'data_emissao >= ? AND data_emissao <= ?';
    let params = [inicio, fim];
    if (cliente_id) { where += ' AND cliente_id = ?'; params.push(cliente_id); }
    if (servico_id) { where += ' AND servico_id = ?'; params.push(servico_id); }
    const [rows] = await pool.query(`SELECT cliente_id, servico_id, SUM(valor) AS total FROM nfe WHERE ${where} GROUP BY cliente_id, servico_id`, params);
    res.json(rows);
  });

  // 8. Dashboard de Status das NF-e
  router.get('/dashboard', async (req, res, next) => {
    const [autorizadas] = await pool.query('SELECT COUNT(*) AS qtd, SUM(valor) AS total FROM nfe WHERE status = "autorizada" AND MONTH(data_emissao) = MONTH(CURRENT_DATE())');
    const [canceladas] = await pool.query('SELECT COUNT(*) AS qtd, SUM(valor) AS total FROM nfe WHERE status = "cancelada" AND MONTH(data_emissao) = MONTH(CURRENT_DATE())');
    const [pendentes] = await pool.query('SELECT COUNT(*) AS qtd, SUM(valor) AS total FROM nfe WHERE status IN ("pendente", "rejeitada") AND MONTH(data_emissao) = MONTH(CURRENT_DATE())');
    res.json({ autorizadas: autorizadas[0], canceladas: canceladas[0], pendentes: pendentes[0] });
  });

  // 9. Livro de Registro de Serviços Prestados
  router.get('/livro-registro', async (req, res, next) => {
    try {
      const { inicio, fim } = req.query;
      
      if (!inicio || !fim) {
        return res.status(400).json({
          success: false,
          message: 'Período de início e fim são obrigatórios'
        });
      }
      
      const [rows] = await pool.query(`
        SELECT 
          numero,
          data_emissao,
          cliente_id,
          descricao_servico,
          valor,
          iss,
          status
        FROM nfe 
        WHERE data_emissao >= ? AND data_emissao <= ?
        ORDER BY data_emissao ASC
      `, [inicio, fim]);
      
      res.json({
        success: true,
        data: {
          periodo: { inicio, fim },
          registros: rows
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // 10. Integração com Contabilidade - download XMLs em lote
  router.get('/contabilidade/xmls', async (req, res, next) => {
    try {
      const { inicio, fim } = req.query;
      
      if (!inicio || !fim) {
        return res.status(400).json({
          success: false,
          message: 'Período de início e fim são obrigatórios'
        });
      }
      
      const [rows] = await pool.query(`
        SELECT 
          id,
          numero,
          data_emissao,
          valor,
          'XML_DISPONIVEL' as xml_status
        FROM nfe 
        WHERE data_emissao >= ? AND data_emissao <= ?
        AND status = 'autorizada'
        ORDER BY data_emissao ASC
      `, [inicio, fim]);
      
      res.json({
        success: true,
        data: {
          periodo: { inicio, fim },
          xmls_disponiveis: rows.length,
          xmls: rows
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // 11. GET /api/nfe/configuracoes - Obter configurações NFe
  router.get('/configuracoes', async (req, res, next) => {
    try {
      const empresaId = req.user?.empresa_id || 1;
      
      // Buscar configurações da empresa (tabela empresa_config)
      const [rows] = await pool.query(`
        SELECT 
          cnpj, razao_social, nome_fantasia, inscricao_estadual,
          endereco, numero, bairro, cidade, estado, cep,
          telefone, email,
          nfe_ambiente, nfe_serie
        FROM empresa_config 
        WHERE id = ?
      `, [empresaId]);
      
      if (rows.length === 0) {
        return res.json({
          success: true,
          ambiente: 2,
          emitente: {}
        });
      }
      
      const empresa = rows[0];
      
      res.json({
        success: true,
        ambiente: empresa.nfe_ambiente || 2,
        emitente: {
          cnpj: empresa.cnpj,
          razaoSocial: empresa.razao_social,
          nomeFantasia: empresa.nome_fantasia,
          inscricaoEstadual: empresa.inscricao_estadual,
          endereco: {
            logradouro: empresa.endereco,
            numero: empresa.numero,
            bairro: empresa.bairro,
            municipio: empresa.cidade,
            uf: empresa.estado,
            cep: empresa.cep
          },
          telefone: empresa.telefone,
          email: empresa.email
        },
        serie: empresa.nfe_serie || 1
      });
    } catch (error) {
      console.error('Erro ao obter configurações NFe:', error);
      next(error);
    }
  });

  // 12. POST /api/nfe/configuracoes - Salvar configurações NFe
  router.post('/configuracoes', async (req, res, next) => {
    try {
      const empresaId = req.user?.empresa_id || 1;
      const { emitente, ambiente, serie } = req.body;
      
      // Atualizar apenas campos editáveis
      const updates = [];
      const params = [];
      
      if (emitente) {
        if (emitente.inscricaoEstadual !== undefined) {
          updates.push('inscricao_estadual = ?');
          params.push(emitente.inscricaoEstadual);
        }
        if (emitente.razaoSocial !== undefined) {
          updates.push('razao_social = ?');
          params.push(emitente.razaoSocial);
        }
        if (emitente.nomeFantasia !== undefined) {
          updates.push('nome_fantasia = ?');
          params.push(emitente.nomeFantasia);
        }
      }
      
      if (ambiente !== undefined) {
        updates.push('nfe_ambiente = ?');
        params.push(parseInt(ambiente));
      }
      
      if (serie !== undefined) {
        updates.push('nfe_serie = ?');
        params.push(parseInt(serie));
      }
      
      if (updates.length > 0) {
        params.push(empresaId);
        await pool.query(`
          UPDATE empresa_config SET ${updates.join(', ')} WHERE id = ?
        `, params);
      }
      
      res.json({
        success: true,
        message: 'Configurações salvas com sucesso'
      });
    } catch (error) {
      console.error('Erro ao salvar configurações NFe:', error);
      next(error);
    }
  });

  return router;
};
