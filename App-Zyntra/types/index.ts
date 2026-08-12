// ============================================================
// User and Auth Types - Based on Zyntra API auth-rbac.js
// ============================================================
export interface User {
  id: number;
  nome: string;
  email: string;
  role: 'admin' | 'usuario' | 'gestor' | 'vendedor' | 'consultoria';
  is_admin: number | boolean;
  setor?: string;
  apelido?: string;
  foto?: string;
  avatar?: string;        // caminho relativo ex: /avatars/Antonio.webp
  telefone?: string;
  bio?: string;
  ultimo_login?: string;
  areas: string[];
  status?: 'ativo' | 'inativo';
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  deviceId?: string;
  redirectTo?: string;
  forcePasswordChange?: boolean;
  user?: User;
  token?: string;
  refreshToken?: string;
  message?: string;
}

// ============================================================
// Module Types
// ============================================================
export interface Module {
  id: string;
  label: string;
  color: string;
  dim: string;
  description: string;
  area: string;
}

// ============================================================
// Dashboard Types - Based on routes/dashboard-api.js
// ============================================================
export interface DashboardKPIs {
  vendas: {
    valor: string;
    trend: string;
    trendUp: boolean;
    chart: number[];
  };
  pedidosAbertos: number;
  aReceber: string;
  ordensProducao: number;
}

export interface DashboardAlert {
  id: number;
  tipo: 'warning' | 'danger' | 'info' | 'success';
  titulo: string;
  mensagem: string;
  link?: string;
  data: string;
}

// /api/dashboard/atividade-recente retorna { text, modulo, ts, color } —
// normalizado em lib/api.ts para { descricao, data, modulo, color }
export interface Atividade {
  id?: number;
  tipo?: string;
  descricao: string;
  usuario?: string;
  data: string | null;
  modulo?: string;
  color?: string;
}

// ============================================================
// KPI Types
// ============================================================
export interface KPI {
  title: string;
  value: string;
  change?: string;
  up?: boolean;
  color: string;
  spark?: number[];
  sub?: string;
}

// ============================================================
// Notification Types - Based on notificacoes table
// ============================================================
export interface Notification {
  id: number;
  usuario_id: number;
  titulo: string;
  mensagem: string;
  tipo: 'info' | 'warning' | 'success' | 'error';
  link?: string;
  dados_extras?: any;
  lida: boolean;
  created_at: string;
}

// ============================================================
// Financial Types - Based on routes/financeiro-routes.js
// ============================================================
export interface FinanceiroDashboard {
  faturamento_total: number;
  contas_receber: number;
  contas_pagar: number;
  saldo_total: number;
}

export interface ContaReceber {
  id: number;
  cliente_id: number;
  cliente_nome?: string;
  descricao?: string;
  valor: number;
  data_vencimento: string;
  data_pagamento?: string;
  status: 'pendente' | 'pago' | 'vencido' | 'cancelado';
  forma_pagamento?: string;
}

export interface ContaPagar {
  id: number;
  fornecedor_id?: number;
  fornecedor_nome?: string;
  descricao?: string;
  valor: number;
  data_vencimento: string;
  data_pagamento?: string;
  status: 'pendente' | 'pago' | 'vencido' | 'cancelado';
}

export interface DREItem {
  label: string;
  value: number;
  tipo: 'receita' | 'despesa' | 'resultado';
}

// ============================================================
// Sales/CRM Types - Based on routes/vendas-routes.js
// ============================================================
export interface Pedido {
  id: number;
  numero?: string;
  cliente_id: number;
  cliente_nome?: string;
  vendedor_id?: number;
  vendedor_nome?: string;
  valor_total: number;
  status: 'orcamento' | 'aprovado' | 'faturado' | 'entregue' | 'cancelado';
  condicao_pagamento?: string;
  data_criacao: string;
  data_aprovacao?: string;
  observacoes?: string;
}

export interface Cliente {
  id: number;
  razao_social?: string;
  nome_fantasia?: string;
  cnpj?: string;
  cpf?: string;
  email?: string;
  telefone?: string;
  endereco?: string;
  cidade?: string;
  estado?: string;
  status: 'ativo' | 'inativo';
}

export interface FunilEtapa {
  etapa: string;
  quantidade: number;
  valor_total: number;
  cor: string;
}

export interface Meta {
  id: number;
  vendedor_id?: number;
  mes: number;
  ano: number;
  meta_valor: number;
  realizado: number;
  percentual: number;
}

// ============================================================
// HR Types - Based on routes/rh-routes.js
// ============================================================
export interface Funcionario {
  id: number;
  nome: string;
  cpf?: string;
  email?: string;
  cargo?: string;
  setor?: string;
  data_admissao?: string;
  salario?: number;
  status: 'ativo' | 'inativo' | 'ferias' | 'afastado';
  foto?: string;
  telefone?: string;
}

export interface RegistroPonto {
  id: number;
  funcionario_id: number;
  data: string;
  entrada?: string;
  almoco_saida?: string;
  almoco_retorno?: string;
  saida?: string;
  total_horas?: string;
}

export interface Holerite {
  id: number;
  funcionario_id: number;
  mes: number;
  ano: number;
  salario_bruto: number;
  descontos: number;
  salario_liquido: number;
  arquivo_url?: string;
}

export interface Ferias {
  id: number;
  funcionario_id: number;
  data_inicio: string;
  data_fim: string;
  dias_gozados: number;
  status: 'agendada' | 'em_gozo' | 'concluida' | 'cancelada';
}

// ============================================================
// PCP Types - Based on routes/pcp-routes.js
// ============================================================
export interface OrdemProducao {
  id: number;
  numero?: string;
  produto_id: number;
  produto_nome?: string;
  quantidade: number;
  quantidade_produzida?: number;
  data_inicio?: string;
  data_previsao?: string;
  data_conclusao?: string;
  status: 'planejada' | 'aguardando' | 'em_producao' | 'concluida' | 'cancelada';
  setor?: string;
  observacoes?: string;
}

export interface Setor {
  id: number;
  nome: string;
  descricao?: string;
  responsavel_id?: number;
  capacidade_diaria?: number;
}

export interface Eficiencia {
  setor: string;
  meta: number;
  realizado: number;
  percentual: number;
}

// ============================================================
// Logistics Types - Based on routes/logistica-routes.js
// ============================================================
export interface Entrega {
  id: number;
  pedido_id?: number;
  codigo_rastreio?: string;
  destinatario?: string;
  cliente?: string;
  endereco_entrega?: string;
  cidade?: string;
  estado?: string;
  cidade_uf?: string;
  nfe_numero?: string;
  previsao?: string;
  transportadora?: string;
  status: 'pendente' | 'aguardando' | 'aguardando_separacao' | 'em_separacao' | 'em_expedicao' | 'em_rota' | 'em_transporte' | 'entregue' | 'cancelada';
  data_envio?: string;
  data_entrega?: string;
}

export interface Rota {
  id: number;
  nome: string;
  motorista?: string;
  veiculo?: string;
  entregas_total: number;
  entregas_realizadas: number;
  status: 'planejada' | 'em_andamento' | 'concluida';
}

export interface Veiculo {
  id: number;
  placa: string;
  modelo: string;
  tipo: string;
  capacidade?: string;
  status: 'disponivel' | 'em_uso' | 'manutencao';
}

// ============================================================
// Billing/NF-e Types - Based on routes/nfe-routes.js
// ============================================================
export interface NotaFiscal {
  id: number;
  numero?: string;
  serie?: string;
  chave_nfe?: string;
  natureza_operacao?: string;
  destinatario_nome?: string;
  destinatario_cnpj?: string;
  valor_total: number;
  status: 'rascunho' | 'processando' | 'autorizada' | 'cancelada' | 'rejeitada';
  data_emissao?: string;
  data_autorizacao?: string;
  protocolo?: string;
}

// ============================================================
// Purchases Types - Based on routes/compras-routes.js
// ============================================================
export interface PedidoCompra {
  id: number;
  numero?: string;
  fornecedor_id: number;
  fornecedor_nome?: string;
  comprador_id?: number;
  valor_total: number;
  status: 'rascunho' | 'pendente' | 'aprovado' | 'parcial' | 'recebido' | 'cancelado';
  data_criacao: string;
  data_aprovacao?: string;
  data_previsao?: string;
  observacoes?: string;
}

export interface Fornecedor {
  id: number;
  razao_social?: string;
  nome_fantasia?: string;
  cnpj?: string;
  email?: string;
  telefone?: string;
  endereco?: string;
  cidade?: string;
  estado?: string;
  status: 'ativo' | 'inativo';
}

// ============================================================
// Product Types
// ============================================================
export interface Produto {
  id: number;
  codigo?: string;
  descricao: string;
  unidade?: string;
  ncm?: string;
  preco_venda?: number;
  preco_custo?: number;
  estoque_atual?: number;
  estoque_minimo?: number;
  categoria?: string;
  status: 'ativo' | 'inativo';
}

// ============================================================
// API Response Types
// ============================================================
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}
