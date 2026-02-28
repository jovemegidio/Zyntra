/**
 * API eSocial - Integração com o Sistema de Escrituração Digital das Obrigações Fiscais,
 * Previdenciárias e Trabalhistas (eSocial)
 * 
 * OBRIGATÓRIO desde 2019 para todas as empresas brasileiras
 * 
 * Referência: https://www.gov.br/esocial/pt-br
 * Layout: S-1.1 (versão simplificada)
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { maskCPF_LGPD, maskSalario_LGPD } = require('../../../src/helpers');
const jwt = require('jsonwebtoken');

// JWT_SECRET deve vir do .env (mesmo do server.js principal)
const JWT_SECRET = process.env.JWT_SECRET;

// Middleware de autenticação para eSocial (obrigatório para todas as rotas)
function esocialAuthMiddleware(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Token de autenticação ausente.' });
    }
    const token = auth.split(' ')[1];
    try {
        if (!JWT_SECRET) {
            console.error('[eSocial API] JWT_SECRET não configurado');
            return res.status(500).json({ message: 'Erro de configuração do servidor.' });
        }
        const payload = jwt.verify(token, JWT_SECRET);
        req.user = payload;
        // Apenas usuários admin/RH podem acessar eSocial
        const adminRoles = ['admin', 'administrador', 'rh', 'financeiro', 'diretoria', 'ti', 'analista de t.i'];
        const role = (payload.role || '').toLowerCase().trim();
        if (!adminRoles.includes(role)) {
            return res.status(403).json({ message: 'Acesso negado. Apenas RH/Admin podem acessar eSocial.' });
        }
        return next();
    } catch (err) {
        return res.status(401).json({ message: 'Token inválido ou expirado.' });
    }
}

// Aplicar autenticação em TODAS as rotas do eSocial
router.use(esocialAuthMiddleware);

// ===================================================================
// TABELAS DO eSocial
// ===================================================================

// Tabela 01 - Categorias de Trabalhadores
const CATEGORIAS_TRABALHADORES = {
    '101': 'Empregado - Geral',
    '102': 'Empregado - Trabalhador Rural por Pequeno Prazo',
    '103': 'Empregado - Aprendiz',
    '104': 'Empregado - Doméstico',
    '105': 'Empregado - Contrato Prazo Determinado',
    '106': 'Empregado - Contrato Verde e Amarelo',
    '111': 'Empregado - Contrato Intermitente',
    '201': 'Trabalhador Avulso Portuário',
    '202': 'Trabalhador Avulso Não Portuário',
    '301': 'Servidor Público Titular de Cargo Efetivo',
    '302': 'Servidor Público Ocupante de Cargo Exclusivo em Comissão',
    '303': 'Exercente de Mandato Eletivo',
    '401': 'Dirigente Sindical',
    '410': 'Trabalhador Cedido',
    '701': 'Contribuinte Individual - Autônomo',
    '711': 'Contribuinte Individual - Transportador',
    '721': 'Contribuinte Individual - Diretor não Empregado',
    '722': 'Contribuinte Individual - Cooperado',
    '723': 'Contribuinte Individual - MEI',
    '731': 'Contribuinte Individual - Serviço Prestado Empresa',
    '734': 'Contribuinte Individual - Produtor Rural',
    '738': 'Contribuinte Individual - Pescador',
    '741': 'Contribuinte Individual - Associado Cooperativa',
    '751': 'Contribuinte Individual - Microempreendedor Individual',
    '761': 'Contribuinte Individual - Empregador Doméstico',
    '771': 'Contribuinte Individual - Brasileiro Civil Exterior',
    '781': 'Ministro de Confissão Religiosa',
    '901': 'Estagiário',
    '902': 'Médico Residente',
    '903': 'Bolsista',
    '904': 'Participante Curso Formação Servidores',
    '905': 'Atleta não Profissional',
    '906': 'Prestador Serviço RPPS',
};

// Tabela 02 - Grau de Instrução
const GRAU_INSTRUCAO = {
    '01': 'Analfabeto',
    '02': 'Até 5ª ano incompleto Ensino Fundamental',
    '03': '5ª ano completo Ensino Fundamental',
    '04': '6ª a 9ª Ensino Fundamental',
    '05': 'Ensino Fundamental Completo',
    '06': 'Ensino Médio Incompleto',
    '07': 'Ensino Médio Completo',
    '08': 'Educação Superior Incompleta',
    '09': 'Educação Superior Completa',
    '10': 'Pós-Graduação completa',
    '11': 'Mestrado completo',
    '12': 'Doutorado completo',
};

// Tabela 03 - Natureza da Rubrica
const NATUREZA_RUBRICA = {
    '1000': 'Salário, Vencimento, Soldo',
    '1002': 'Hora Extra',
    '1003': 'Adicional de Insalubridade',
    '1004': 'Adicional de Periculosidade',
    '1005': 'Adicional Noturno',
    '1006': 'Adicional de Função/Cargo de Confiança',
    '1007': 'Adicional de Tempo de Serviço',
    '1009': 'Gratificação',
    '1010': 'Gratificação por Acordo/Convenção Coletiva',
    '1011': 'Prêmio',
    '1020': 'Comissão',
    '1021': 'DSR - Descanso Semanal Remunerado',
    '1023': 'Gorjeta',
    '1099': 'Outras Verbas Salariais',
    '1201': 'Ajuda de Custo',
    '1202': 'Auxílio-Alimentação',
    '1203': 'Auxílio-Transporte',
    '1204': 'Auxílio-Educação',
    '1205': 'Auxílio-Saúde',
    '1206': 'Auxílio-Creche',
    '1211': 'Diárias de Viagem',
    '1401': '13º Salário',
    '1402': 'Férias - Abono Pecuniário',
    '1403': 'Férias - Pagamento em Dobro',
    '1404': 'Férias - Pagamento Proporcional',
    '1405': 'Férias - 1/3 Constitucional',
    '1601': 'Aviso Prévio Indenizado',
    '1619': 'Multa Art. 477 CLT',
    '1620': 'Multa Art. 467 CLT',
    '1621': 'Indenização Art. 479 CLT',
    '1651': 'Rescisão - Saldo de Salário',
    '5001': 'Contribuição Sindical',
    '5501': 'Contribuição Previdenciária',
    '5502': 'IRRF',
    '5503': 'Pensão Alimentícia',
    '5504': 'Desconto de Adiantamento',
    '5505': 'Desconto de Vale-Transporte',
    '5506': 'Desconto de Vale-Refeição',
    '5507': 'Desconto de Assistência Médica',
    '5599': 'Outros Descontos',
    '9999': 'Informativo - Sem incidência',
};

// Tabela 06 - Motivos de Afastamento
const MOTIVOS_AFASTAMENTO = {
    '01': 'Acidente/Doença do Trabalho',
    '03': 'Acidente/Doença não Relacionados ao Trabalho',
    '05': 'Afastamento/Licença Gestante',
    '06': 'Licença Maternidade - 120 dias',
    '07': 'Afastamento por Aborto não criminoso',
    '08': 'Afastamento para Adoção/Guarda Judicial',
    '10': 'Licença Remunerada - Lei, Acordo, Conv. Coletiva',
    '11': 'Licença não Remunerada',
    '12': 'Gozo de Férias',
    '13': 'Licença Paternidade',
    '14': 'Licença por Participação Voluntária',
    '15': 'Mandato Sindical',
    '16': 'Mandato Eleitoral',
    '17': 'Pelo Empregador',
    '18': 'Por Motivo de Interesse',
    '19': 'Por Tempestades/Enchentes',
    '20': 'Ministrar Aulas/Cursos',
    '21': 'Auxílio-doença',
    '22': 'Aposentadoria por Invalidez',
    '23': 'Prisão',
    '24': 'Suspensão Disciplinar',
    '25': 'Serviço Militar',
    '26': 'Licença-prêmio ou equivalente',
    '27': 'Período Aquisitivo',
    '28': 'Descanso/Folga',
    '29': 'Faltas Injustificadas',
    '30': 'Participação em Programa de Qualificação',
    '31': 'Suspensão Contratual',
    '33': 'Licença para Tratamento de Saúde',
    '34': 'Licença para Tratar Assuntos Particulares',
    '35': 'Licença-casamento',
    '36': 'Licença por morte de familiar',
    '37': 'Afastamento amamentação',
    '50': 'COVID-19 - Quarentena',
    '51': 'COVID-19 - Isolamento',
};

// Tabela 18 - Motivos de Desligamento
const MOTIVOS_DESLIGAMENTO = {
    '01': 'Rescisão com Justa Causa (pelo empregador)',
    '02': 'Rescisão sem Justa Causa (pelo empregador)',
    '03': 'Rescisão Antecipada (pelo empregador)',
    '04': 'Rescisão Antecipada (pelo empregado)',
    '05': 'Término de Contrato por Prazo Determinado',
    '06': 'Rescisão por Culpa Recíproca',
    '07': 'Rescisão Indireta',
    '08': 'Transferência para Outra Empresa do Grupo',
    '09': 'Transferência para Outra Empresa do Consórcio',
    '10': 'Transferência para Empresa Consorciada',
    '11': 'Rescisão com Acordo entre as Partes',
    '12': 'Aposentadoria por Invalidez',
    '13': 'Aposentadoria por Idade',
    '14': 'Aposentadoria por Tempo de Contribuição',
    '15': 'Aposentadoria Especial',
    '16': 'Aposentadoria Compulsória',
    '17': 'Morte do Empregado',
    '18': 'Pedido de Demissão',
    '19': 'Rescisão por Extinção da Empresa',
    '20': 'Rescisão por Falência da Empresa',
    '21': 'Rescisão por Encerramento de Filial',
    '22': 'Rescisão por Sucessão de Empregadores',
    '23': 'Conversão de Contrato',
    '24': 'Alteração Contratual',
    '25': 'Término de Cessão',
    '26': 'Mandato Eletivo (afastamento)',
    '27': 'Exoneração de Cargo Comissionado',
    '28': 'Dispensa de Função',
    '29': 'Remoção/Redistribuição',
    '30': 'Vacncia',
    '31': 'Desligamento de não estatutário',
    '32': 'Exoneração a Pedido',
    '33': 'Demissão',
    '34': 'Readaptação',
    '35': 'Reintegração',
    '36': 'Reversão',
    '37': 'Recondução',
    '40': 'Dispensa Sem Justa Causa - Durante o Período de Garantia de Emprego',
};

// ===================================================================
// EVENTOS DO eSocial - S-1.1 (Simplificado)
// ===================================================================

/**
 * S-1000 - Informações do Empregador/Contribuinte/Órgão Público
 * OBRIGATÓRIO: Primeiro evento a ser enviado
 */
router.post('/eventos/s-1000', [
    body('cnpj').isLength({ min: 14, max: 14 }).withMessage('CNPJ deve ter 14 dígitos'),
    body('razaoSocial').notEmpty().withMessage('Razão Social é obrigatória'),
    body('classTrib').notEmpty().withMessage('Classificação Tributária é obrigatória'),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {
        const { cnpj, razaoSocial, classTrib, natJurid, indCoop, indConstr, indDesFolha, indOptRegEletron, contato } = req.body;

        const evento = {
            evtInfoEmpregador: {
                ideEvento: {
                    tpAmb: process.env.ESOCIAL_AMBIENTE || '2', // 1=Produção, 2=Homologação
                    procEmi: '1', // Aplicativo do empregador
                    verProc: '1.0.0'
                },
                ideEmpregador: {
                    tpInsc: '1', // 1=CNPJ
                    nrInsc: cnpj.substring(0, 8) // Raiz do CNPJ
                },
                infoEmpregador: {
                    inclusao: {
                        idePeriodo: {
                            iniValid: new Date().toISOString().substring(0, 7).replace('-', '')
                        },
                        infoCadastro: {
                            classTrib: classTrib,
                            indCoop: indCoop || '0',
                            indConstr: indConstr || '0',
                            indDesFolha: indDesFolha || '0',
                            indOptRegEletron: indOptRegEletron || '0',
                            nmRazao: razaoSocial,
                            natJurid: natJurid,
                            contato: contato || {}
                        }
                    }
                }
            }
        };

        // TODO: Integrar com webservice eSocial para envio real
        // Por enquanto, salva no banco para processamento posterior

        res.json({
            success: true,
            evento: 'S-1000',
            message: 'Evento S-1000 gerado com sucesso',
            xml: evento,
            proximoPasso: 'Enviar para ambiente de homologação do eSocial'
        });
    } catch (error) {
        console.error('Erro ao gerar S-1000:', error);
        res.status(500).json({ error: 'Erro ao gerar evento S-1000' });
    }
});

/**
 * S-1005 - Tabela de Estabelecimentos, Obras ou Unidades de Órgãos Públicos
 */
router.post('/eventos/s-1005', [
    body('cnpj').isLength({ min: 14, max: 14 }).withMessage('CNPJ deve ter 14 dígitos'),
    body('cnae').notEmpty().withMessage('CNAE é obrigatório'),
], async (req, res) => {
    try {
        const { cnpj, cnae, regPt, infoTrab } = req.body;

        const evento = {
            evtTabEstab: {
                ideEvento: {
                    tpAmb: process.env.ESOCIAL_AMBIENTE || '2',
                    procEmi: '1',
                    verProc: '1.0.0'
                },
                ideEmpregador: {
                    tpInsc: '1',
                    nrInsc: cnpj.substring(0, 8)
                },
                infoEstab: {
                    inclusao: {
                        ideEstab: {
                            tpInsc: '1',
                            nrInsc: cnpj
                        },
                        dadosEstab: {
                            cnaePrep: cnae,
                            regPt: regPt || '0',
                            aliqGilrat: infoTrab?.aliqGilrat || {}
                        }
                    }
                }
            }
        };

        res.json({
            success: true,
            evento: 'S-1005',
            message: 'Evento S-1005 gerado com sucesso',
            xml: evento
        });
    } catch (error) {
        console.error('Erro ao gerar S-1005:', error);
        res.status(500).json({ error: 'Erro ao gerar evento S-1005' });
    }
});

/**
 * S-1010 - Tabela de Rubricas
 */
router.post('/eventos/s-1010', [
    body('codRubr').notEmpty().withMessage('Código da rubrica é obrigatório'),
    body('natRubr').notEmpty().withMessage('Natureza da rubrica é obrigatória'),
    body('dscRubr').notEmpty().withMessage('Descrição da rubrica é obrigatória'),
], async (req, res) => {
    try {
        const { codRubr, ideTabRubr, natRubr, tpRubr, codIncCP, codIncIRRF, codIncFGTS, dscRubr, observacao } = req.body;

        const evento = {
            evtTabRubrica: {
                ideEvento: {
                    tpAmb: process.env.ESOCIAL_AMBIENTE || '2',
                    procEmi: '1',
                    verProc: '1.0.0'
                },
                ideEmpregador: {
                    tpInsc: '1',
                    nrInsc: req.body.cnpj?.substring(0, 8)
                },
                infoRubrica: {
                    inclusao: {
                        ideRubrica: {
                            codRubr: codRubr,
                            ideTabRubr: ideTabRubr || '1'
                        },
                        dadosRubrica: {
                            dscRubr: dscRubr,
                            natRubr: natRubr,
                            tpRubr: tpRubr || '1', // 1=Provento, 2=Desconto, 3=Informativo
                            codIncCP: codIncCP || '00', // Incidência Previdenciária
                            codIncIRRF: codIncIRRF || '00', // Incidência IRRF
                            codIncFGTS: codIncFGTS || '00', // Incidência FGTS
                            observacao: observacao
                        }
                    }
                }
            }
        };

        res.json({
            success: true,
            evento: 'S-1010',
            message: 'Evento S-1010 gerado com sucesso',
            xml: evento
        });
    } catch (error) {
        console.error('Erro ao gerar S-1010:', error);
        res.status(500).json({ error: 'Erro ao gerar evento S-1010' });
    }
});

/**
 * S-2200 - Cadastramento Inicial do Vínculo e Admissão/Ingresso de Trabalhador
 */
router.post('/eventos/s-2200', [
    body('cpf').isLength({ min: 11, max: 11 }).withMessage('CPF deve ter 11 dígitos'),
    body('nome').notEmpty().withMessage('Nome é obrigatório'),
    body('dataNascimento').isDate().withMessage('Data de nascimento inválida'),
    body('dataAdmissao').isDate().withMessage('Data de admissão inválida'),
], async (req, res) => {
    try {
        const {
            cpf, nome, dataNascimento, sexo, racaCor, estCiv, grauInstr,
            nmSoc, endereco, trabEstrangeiro, defFisica, defVisual, defAuditiva,
            defMental, defIntelectual, infoDeficiencia, dependente,
            dataAdmissao, tpRegTrab, tpRegPrev, indAdmissao, tpInsc, nrInsc,
            codCateg, matricula, cargo, cboCargo, codCargo, funcao, cboFuncao,
            codFuncao, vrSalFx, undSalFixo, tpContr, dscSalVar, horario
        } = req.body;

        // LGPD: mascarar CPF e salário antes de enviar para integrações externas
        const evento = {
            evtAdmissao: {
                ideEvento: {
                    indRetif: '1', // 1=Original, 2=Retificação
                    tpAmb: process.env.ESOCIAL_AMBIENTE || '2',
                    procEmi: '1',
                    verProc: '1.0.0'
                },
                ideEmpregador: {
                    tpInsc: '1',
                    nrInsc: req.body.cnpjEmpregador?.substring(0, 8)
                },
                trabalhador: {
                    cpfTrab: maskCPF_LGPD(cpf),
                    nmTrab: nome,
                    sexo: sexo || 'M',
                    racaCor: racaCor || '1',
                    estCiv: estCiv || '1',
                    grauInstr: grauInstr || '07',
                    nmSoc: nmSoc,
                    nascimento: {
                        dtNascto: dataNascimento,
                        codMunic: endereco?.codMunic,
                        uf: endereco?.uf,
                        paisNascto: '105', // Brasil
                        paisNac: '105'
                    },
                    endereco: {
                        brasil: {
                            tpLograd: endereco?.tpLograd || '001',
                            dscLograd: endereco?.logradouro,
                            nrLograd: endereco?.numero,
                            complemento: endereco?.complemento,
                            bairro: endereco?.bairro,
                            cep: endereco?.cep,
                            codMunic: endereco?.codMunic,
                            uf: endereco?.uf
                        }
                    },
                    defFisica: defFisica || 'N',
                    defVisual: defVisual || 'N',
                    defAuditiva: defAuditiva || 'N',
                    defMental: defMental || 'N',
                    defIntelectual: defIntelectual || 'N',
                    dependente: dependente || []
                },
                vinculo: {
                    matricula: matricula,
                    tpRegTrab: tpRegTrab || '1', // 1=CLT, 2=Estatutário
                    tpRegPrev: tpRegPrev || '1', // 1=RGPS, 2=RPPS, 3=RPPE
                    cadIni: 'S', // S=Cadastramento inicial
                    indAdmissao: indAdmissao || '1',
                    infoRegimeTrab: {
                        infoCeletista: {
                            dtAdm: dataAdmissao,
                            tpAdmissao: '1',
                            indAdmissao: '1',
                            nrProcTrab: null,
                            tpRegJor: '1', // 1=Submetido a horário
                            natAtividade: '1', // 1=Urbano
                            dtBase: '01',
                            cnpjSindCategProf: null
                        }
                    },
                    infoContrato: {
                        cargo: {
                            codCargo: codCargo,
                            nmCargo: cargo,
                            CBOCargo: cboCargo
                        },
                        funcao: funcao ? {
                            codFuncao: codFuncao,
                            nmFuncao: funcao,
                            CBOFuncao: cboFuncao
                        } : undefined,
                        remuneracao: {
                            vrSalFx: maskSalario_LGPD(vrSalFx),
                            undSalFixo: undSalFixo || '5', // 5=Mensal
                            dscSalVar: dscSalVar
                        },
                        duracao: {
                            tpContr: tpContr || '1' // 1=Indeterminado
                        },
                        horContratual: horario
                    }
                }
            }
        };

        res.json({
            success: true,
            evento: 'S-2200',
            message: 'Evento S-2200 (Admissão) gerado com sucesso',
            xml: evento,
            prazo: 'Enviar até o dia anterior ao início das atividades'
        });
    } catch (error) {
        console.error('Erro ao gerar S-2200:', error);
        res.status(500).json({ error: 'Erro ao gerar evento S-2200' });
    }
});

/**
 * S-2206 - Alteração de Contrato de Trabalho / Relação Estatutária
 */
router.post('/eventos/s-2206', async (req, res) => {
    try {
        const { cpf, matricula, dtAlteracao, cargo, salario, motivo } = req.body;

        const evento = {
            evtAltContratual: {
                ideEvento: {
                    indRetif: '1',
                    tpAmb: process.env.ESOCIAL_AMBIENTE || '2',
                    procEmi: '1',
                    verProc: '1.0.0'
                },
                ideVinculo: {
                    cpfTrab: cpf,
                    matricula: matricula
                },
                altContratual: {
                    dtAlteracao: dtAlteracao,
                    infoContrato: {
                        cargo: cargo,
                        remuneracao: salario ? { vrSalFx: salario } : undefined
                    }
                }
            }
        };

        res.json({
            success: true,
            evento: 'S-2206',
            message: 'Evento S-2206 (Alteração Contratual) gerado com sucesso',
            xml: evento
        });
    } catch (error) {
        console.error('Erro ao gerar S-2206:', error);
        res.status(500).json({ error: 'Erro ao gerar evento S-2206' });
    }
});

/**
 * S-2230 - Afastamento Temporário
 */
router.post('/eventos/s-2230', [
    body('cpf').isLength({ min: 11, max: 11 }),
    body('dtIniAfast').isDate(),
    body('codMotAfast').notEmpty(),
], async (req, res) => {
    try {
        const { cpf, matricula, dtIniAfast, dtFimAfast, codMotAfast, infoAtestado, infoMesmoMtv } = req.body;

        const evento = {
            evtAfastTemp: {
                ideEvento: {
                    indRetif: '1',
                    tpAmb: process.env.ESOCIAL_AMBIENTE || '2',
                    procEmi: '1',
                    verProc: '1.0.0'
                },
                ideVinculo: {
                    cpfTrab: cpf,
                    matricula: matricula
                },
                infoAfastamento: {
                    iniAfastamento: {
                        dtIniAfast: dtIniAfast,
                        codMotAfast: codMotAfast, // Ver Tabela 06
                        infoMesmoMtv: infoMesmoMtv,
                        infoAtestado: infoAtestado
                    },
                    fimAfastamento: dtFimAfast ? {
                        dtFimAfast: dtFimAfast
                    } : undefined
                }
            }
        };

        res.json({
            success: true,
            evento: 'S-2230',
            message: 'Evento S-2230 (Afastamento) gerado com sucesso',
            xml: evento,
            motivo: MOTIVOS_AFASTAMENTO[codMotAfast] || 'Motivo não identificado'
        });
    } catch (error) {
        console.error('Erro ao gerar S-2230:', error);
        res.status(500).json({ error: 'Erro ao gerar evento S-2230' });
    }
});

/**
 * S-2299 - Desligamento
 */
router.post('/eventos/s-2299', [
    body('cpf').isLength({ min: 11, max: 11 }),
    body('dtDeslig').isDate(),
    body('mtvDeslig').notEmpty(),
], async (req, res) => {
    try {
        const {
            cpf, matricula, dtDeslig, mtvDeslig, dtProjFimAPI, pensAlim,
            percAliment, vrAlim, indPagtoAPI, dtProjFimAPI2, indCumprParworking,
            qtdDiasInworking, observacao, verbasRescisoria
        } = req.body;

        const evento = {
            evtDeslig: {
                ideEvento: {
                    indRetif: '1',
                    tpAmb: process.env.ESOCIAL_AMBIENTE || '2',
                    procEmi: '1',
                    verProc: '1.0.0'
                },
                ideVinculo: {
                    cpfTrab: cpf,
                    matricula: matricula
                },
                infoDeslig: {
                    dtDeslig: dtDeslig,
                    mtvDeslig: mtvDeslig, // Ver Tabela 18
                    dtProjFimAPI: dtProjFimAPI,
                    pensAlim: pensAlim || '0',
                    percAliment: percAliment,
                    vrAlim: vrAlim,
                    indPagtoAPI: indPagtoAPI || 'N',
                    indCumprParworking: indCumprParworking || 'S',
                    qtdDiasInworking: qtdDiasInworking,
                    observacao: observacao,
                    verbasResc: verbasRescisoria ? {
                        dmDev: verbasRescisoria.map(v => ({
                            ideDmDev: v.id,
                            infoPerApur: {
                                ideEstabLot: v.estabelecimento,
                                detVerbas: v.verbas
                            }
                        }))
                    } : undefined
                }
            }
        };

        res.json({
            success: true,
            evento: 'S-2299',
            message: 'Evento S-2299 (Desligamento) gerado com sucesso',
            xml: evento,
            motivo: MOTIVOS_DESLIGAMENTO[mtvDeslig] || 'Motivo não identificado',
            prazo: 'Enviar até 10 dias após o desligamento (ou no 1º dia útil seguinte ao término do prazo, caso caia em fim de semana/feriado)'
        });
    } catch (error) {
        console.error('Erro ao gerar S-2299:', error);
        res.status(500).json({ error: 'Erro ao gerar evento S-2299' });
    }
});

/**
 * S-1200 - Remuneração de Trabalhador vinculado ao Regime Geral de Prev. Social
 * Enviado mensalmente (folha de pagamento)
 */
router.post('/eventos/s-1200', [
    body('cpf').isLength({ min: 11, max: 11 }),
    body('perApur').notEmpty().withMessage('Período de apuração é obrigatório (AAAA-MM)'),
], async (req, res) => {
    try {
        const { cpf, matricula, perApur, codCateg, indSimples, dmDev } = req.body;

        const evento = {
            evtRemun: {
                ideEvento: {
                    indRetif: '1',
                    tpAmb: process.env.ESOCIAL_AMBIENTE || '2',
                    procEmi: '1',
                    verProc: '1.0.0'
                },
                ideTrabalhador: {
                    cpfTrab: cpf,
                    infoMV: null,
                    infoComplem: null
                },
                dmDev: dmDev || [{
                    ideDmDev: '1',
                    codCateg: codCateg || '101', // Ver Tabela 01
                    infoPerApur: {
                        ideEstabLot: [{
                            tpInsc: '1',
                            nrInsc: req.body.cnpjEstab,
                            codLotacao: req.body.codLotacao || '001',
                            detVerbas: req.body.verbas || []
                        }]
                    }
                }]
            }
        };

        res.json({
            success: true,
            evento: 'S-1200',
            message: 'Evento S-1200 (Remuneração) gerado com sucesso',
            xml: evento,
            prazo: 'Enviar até o dia 15 do mês seguinte ao período de apuração'
        });
    } catch (error) {
        console.error('Erro ao gerar S-1200:', error);
        res.status(500).json({ error: 'Erro ao gerar evento S-1200' });
    }
});

/**
 * S-1210 - Pagamentos de Rendimentos do Trabalho
 */
router.post('/eventos/s-1210', async (req, res) => {
    try {
        const { cpf, perApur, dtPgto, tpPgto, perRef, ideDmDev, vrLiq } = req.body;

        const evento = {
            evtPgtos: {
                ideEvento: {
                    indRetif: '1',
                    tpAmb: process.env.ESOCIAL_AMBIENTE || '2',
                    procEmi: '1',
                    verProc: '1.0.0'
                },
                ideBenef: {
                    cpfBenef: cpf,
                    infoPgto: [{
                        dtPgto: dtPgto,
                        tpPgto: tpPgto || '1', // 1=Pagamento de remuneração
                        perRef: perRef,
                        ideDmDev: ideDmDev || '1',
                        vrLiq: vrLiq
                    }]
                }
            }
        };

        res.json({
            success: true,
            evento: 'S-1210',
            message: 'Evento S-1210 (Pagamentos) gerado com sucesso',
            xml: evento
        });
    } catch (error) {
        console.error('Erro ao gerar S-1210:', error);
        res.status(500).json({ error: 'Erro ao gerar evento S-1210' });
    }
});

/**
 * S-1299 - Fechamento dos Eventos Periódicos
 * Enviado ao final do período de apuração
 */
router.post('/eventos/s-1299', [
    body('perApur').notEmpty().withMessage('Período de apuração é obrigatório'),
], async (req, res) => {
    try {
        const { perApur, evtRemun, evtPgtos, evtAqProd, evtComProd, evtContratAvNP, evtInfoComplPer } = req.body;

        const evento = {
            evtFechaEvPer: {
                ideEvento: {
                    indRetif: '1',
                    tpAmb: process.env.ESOCIAL_AMBIENTE || '2',
                    procEmi: '1',
                    verProc: '1.0.0'
                },
                ideRespInf: {
                    nmResp: req.body.nomeResponsavel,
                    cpfResp: req.body.cpfResponsavel,
                    telefone: req.body.telefoneResponsavel,
                    email: req.body.emailResponsavel
                },
                infoFech: {
                    evtRemun: evtRemun || 'S', // S/N - Há remuneração no período
                    evtPgtos: evtPgtos || 'S', // S/N - Há pagamentos no período
                    evtAqProd: evtAqProd || 'N',
                    evtComProd: evtComProd || 'N',
                    evtContratAvNP: evtContratAvNP || 'N',
                    evtInfoComplPer: evtInfoComplPer || 'N'
                }
            }
        };

        res.json({
            success: true,
            evento: 'S-1299',
            message: 'Evento S-1299 (Fechamento) gerado com sucesso',
            xml: evento,
            prazo: 'Enviar até o dia 15 do mês seguinte ao período de apuração'
        });
    } catch (error) {
        console.error('Erro ao gerar S-1299:', error);
        res.status(500).json({ error: 'Erro ao gerar evento S-1299' });
    }
});

// ===================================================================
// ENDPOINTS UTILITÁRIOS
// ===================================================================

/**
 * GET /tabelas - Lista todas as tabelas do eSocial disponíveis
 */
router.get('/tabelas', (req, res) => {
    res.json({
        tabela01: { nome: 'Categorias de Trabalhadores', dados: CATEGORIAS_TRABALHADORES },
        tabela02: { nome: 'Grau de Instrução', dados: GRAU_INSTRUCAO },
        tabela03: { nome: 'Natureza da Rubrica', dados: NATUREZA_RUBRICA },
        tabela06: { nome: 'Motivos de Afastamento', dados: MOTIVOS_AFASTAMENTO },
        tabela18: { nome: 'Motivos de Desligamento', dados: MOTIVOS_DESLIGAMENTO }
    });
});

/**
 * GET /tabelas/:numero - Retorna uma tabela específica
 */
router.get('/tabelas/:numero', (req, res) => {
    const numero = req.params.numero;
    const tabelas = {
        '01': CATEGORIAS_TRABALHADORES,
        '02': GRAU_INSTRUCAO,
        '03': NATUREZA_RUBRICA,
        '06': MOTIVOS_AFASTAMENTO,
        '18': MOTIVOS_DESLIGAMENTO
    };

    if (tabelas[numero]) {
        res.json(tabelas[numero]);
    } else {
        res.status(404).json({ error: 'Tabela não encontrada' });
    }
});

/**
 * GET /status - Verifica status do ambiente eSocial
 */
router.get('/status', async (req, res) => {
    try {
        res.json({
            ambiente: process.env.ESOCIAL_AMBIENTE === '1' ? 'Produção' : 'Homologação',
            versaoLayout: 'S-1.1',
            dataHora: new Date().toISOString(),
            status: 'Operacional',
            eventosDisponiveis: [
                'S-1000', 'S-1005', 'S-1010', // Tabelas
                'S-2200', 'S-2206', 'S-2230', 'S-2299', // Não periódicos
                'S-1200', 'S-1210', 'S-1299' // Periódicos
            ],
            proximas_implementacoes: [
                'S-2190 - Registro Preliminar',
                'S-2205 - Alteração de Dados Cadastrais',
                'S-2210 - Comunicação de Acidente de Trabalho (CAT)',
                'S-2220 - Monitoramento da Saúde do Trabalhador',
                'S-2240 - Condições Ambientais do Trabalho',
                'S-2300 - Trabalhador Sem Vínculo de Emprego',
                'S-2400 - Cadastro de Benefício Previdenciário - RPPS'
            ]
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao verificar status' });
    }
});

/**
 * POST /validar-cpf - Valida um CPF
 */
router.post('/validar-cpf', (req, res) => {
    const { cpf } = req.body;
    
    if (!cpf || cpf.length !== 11) {
        return res.json({ valid: false, message: 'CPF deve ter 11 dígitos' });
    }

    // Validação do CPF
    const cpfLimpo = cpf.replace(/\D/g, '');
    
    // Verifica se todos os dígitos são iguais
    if (/^(\d)\1+$/.test(cpfLimpo)) {
        return res.json({ valid: false, message: 'CPF inválido' });
    }

    // Calcula primeiro dígito verificador
    let soma = 0;
    for (let i = 0; i < 9; i++) {
        soma += parseInt(cpfLimpo.charAt(i)) * (10 - i);
    }
    let resto = 11 - (soma % 11);
    let digito1 = resto > 9 ? 0 : resto;

    // Calcula segundo dígito verificador
    soma = 0;
    for (let i = 0; i < 10; i++) {
        soma += parseInt(cpfLimpo.charAt(i)) * (11 - i);
    }
    resto = 11 - (soma % 11);
    let digito2 = resto > 9 ? 0 : resto;

    // Verifica se os dígitos calculados são iguais aos informados
    if (parseInt(cpfLimpo.charAt(9)) === digito1 && parseInt(cpfLimpo.charAt(10)) === digito2) {
        res.json({ valid: true, cpf: cpfLimpo, formatted: `${cpfLimpo.substr(0,3)}.${cpfLimpo.substr(3,3)}.${cpfLimpo.substr(6,3)}-${cpfLimpo.substr(9,2)}` });
    } else {
        res.json({ valid: false, message: 'CPF inválido' });
    }
});

/**
 * POST /validar-cnpj - Valida um CNPJ
 */
router.post('/validar-cnpj', (req, res) => {
    const { cnpj } = req.body;
    
    if (!cnpj || cnpj.length !== 14) {
        return res.json({ valid: false, message: 'CNPJ deve ter 14 dígitos' });
    }

    const cnpjLimpo = cnpj.replace(/\D/g, '');

    // Verifica se todos os dígitos são iguais
    if (/^(\d)\1+$/.test(cnpjLimpo)) {
        return res.json({ valid: false, message: 'CNPJ inválido' });
    }

    // Validação do CNPJ
    const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

    let soma = 0;
    for (let i = 0; i < 12; i++) {
        soma += parseInt(cnpjLimpo.charAt(i)) * pesos1[i];
    }
    let resto = soma % 11;
    let digito1 = resto < 2 ? 0 : 11 - resto;

    soma = 0;
    for (let i = 0; i < 13; i++) {
        soma += parseInt(cnpjLimpo.charAt(i)) * pesos2[i];
    }
    resto = soma % 11;
    let digito2 = resto < 2 ? 0 : 11 - resto;

    if (parseInt(cnpjLimpo.charAt(12)) === digito1 && parseInt(cnpjLimpo.charAt(13)) === digito2) {
        res.json({
            valid: true,
            cnpj: cnpjLimpo,
            raiz: cnpjLimpo.substring(0, 8),
            formatted: `${cnpjLimpo.substr(0,2)}.${cnpjLimpo.substr(2,3)}.${cnpjLimpo.substr(5,3)}/${cnpjLimpo.substr(8,4)}-${cnpjLimpo.substr(12,2)}`
        });
    } else {
        res.json({ valid: false, message: 'CNPJ inválido' });
    }
});

module.exports = router;
