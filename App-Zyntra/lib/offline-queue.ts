import * as SecureStore from './secure-store';

// ════════════════════════════════════════════════════════════════════════════
// FILA OFFLINE DE ESCRITAS
//
// O app escreve exatamente onde o sinal cai: ponto e apontamento de chão de
// fábrica (galpão), solicitação de RH e atestado (rua). Sem fila, um POST que
// sai no momento errado some — o usuário vê "não foi possível registrar o
// ponto" e a batida simplesmente não existe.
//
// O lado do servidor JÁ existe: `middleware/idempotency.js` está montado em
// `app.use('/api', idempotency())`, lê o header `X-Idempotency-Key` (TTL 24h) e
// devolve a resposta original com `X-Idempotency-Replay: true` em vez de gravar
// de novo. Esta fila é a outra metade — a que faltava no mobile.
//
// ── A chave nasce ANTES da primeira tentativa, não no enfileiramento ─────────
// O caso que duplica é a rede cair DEPOIS de o servidor gravar e antes de a
// resposta chegar. Se a chave só nascesse ao enfileirar, a tentativa original
// teria ido sem chave nenhuma e o servidor não teria como ligar o reenvio à
// gravação que já fez. Por isso quem gera a chave é o interceptor de request de
// `lib/api.ts`, em TODA escrita, e o item da fila apenas herda essa mesma chave.
//
// ── Por que SecureStore e não um arquivo ────────────────────────────────────
// É o único armazenamento persistente já presente nas dependências (não há
// async-storage nem file-system no projeto). O Android avisa acima de ~2 KB por
// entrada, então a fila NÃO é um blob único: um índice guarda só os ids e cada
// item vive na sua própria chave, todos pequenos.
// ════════════════════════════════════════════════════════════════════════════

const CHAVE_INDICE = 'zyntra_fila_offline_idx';
const PREFIXO_ITEM = 'zyntra_fila_offline_';

/** Teto de segurança: 200 escritas pendentes já indicam algo muito errado. */
const MAX_ITENS = 200;

/** Depois disso o item para de ser reenviado sozinho e espera ação do usuário. */
const MAX_TENTATIVAS = 8;

export type MetodoEscrita = 'post' | 'put' | 'patch' | 'delete';

export interface ItemFila {
  /** É também a chave de idempotência enviada ao servidor. */
  id: string;
  criadoEm: number;
  metodo: MetodoEscrita;
  /** Caminho relativo à baseURL do axios (ex.: '/rh/ponto/marcacoes'). */
  url: string;
  /** Corpo JSON. Multipart não entra na fila — ver `podeEnfileirar`. */
  dados?: unknown;
  /** Texto curto mostrado ao usuário ("Ponto — entrada"). */
  rotulo: string;
  tentativas: number;
  ultimoErro?: string;
  /** true quando o servidor recusou de forma definitiva (4xx que não adianta repetir). */
  falhou?: boolean;
}

// ── Chave de idempotência ───────────────────────────────────────────────────

/**
 * Identificador único por escrita. Não usa `crypto.randomUUID` porque o
 * Hermes não o expõe em todas as versões; a combinação tempo + aleatório é
 * suficiente aqui, já que a chave só precisa ser única por dispositivo e o
 * servidor a guarda por 24 h.
 *
 * O FORMATO NÃO É LIVRE: `middleware/idempotency.js` valida a chave contra
 * `/^[a-zA-Z0-9\-_]{8,64}$/` e responde 400 se não casar. Base36 e hífen ficam
 * dentro dessa faixa — um ponto ou dois-pontos aqui derrubaria toda escrita do
 * app com "X-Idempotency-Key inválida". Há teste amarrando isso
 * (`tests/app-mobile-fila-offline.test.js`).
 *
 * Nota sobre alcance: o middleware está montado com as opções padrão
 * (`app.use('/api', idempotency())`), e o padrão é `methods: ['POST']`. Logo o
 * dedup do servidor vale para POST — que é o que as quatro escritas de campo
 * usam. PUT/DELETE na fila (marcar notificação lida) não têm dedup no servidor,
 * mas são naturalmente idempotentes.
 */
export function novaChaveIdempotencia(): string {
  const tempo = Date.now().toString(36);
  const acaso = Math.random().toString(36).slice(2, 12);
  const acaso2 = Math.random().toString(36).slice(2, 8);
  return `mob-${tempo}-${acaso}${acaso2}`;
}

// ── Persistência ────────────────────────────────────────────────────────────

async function lerIndice(): Promise<string[]> {
  try {
    const cru = await SecureStore.getItemAsync(CHAVE_INDICE);
    if (!cru) return [];
    const lista = JSON.parse(cru);
    return Array.isArray(lista) ? lista.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

async function gravarIndice(ids: string[]): Promise<void> {
  await SecureStore.setItemAsync(CHAVE_INDICE, JSON.stringify(ids));
}

async function lerItem(id: string): Promise<ItemFila | null> {
  try {
    const cru = await SecureStore.getItemAsync(PREFIXO_ITEM + id);
    if (!cru) return null;
    const item = JSON.parse(cru) as ItemFila;
    return item && typeof item.id === 'string' ? item : null;
  } catch {
    return null;
  }
}

async function gravarItem(item: ItemFila): Promise<void> {
  await SecureStore.setItemAsync(PREFIXO_ITEM + item.id, JSON.stringify(item));
}

async function apagarItem(id: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(PREFIXO_ITEM + id);
  } catch {
    // item já ausente: nada a fazer
  }
}

// ── Assinantes (a UI reage sem polling) ─────────────────────────────────────

type Ouvinte = (itens: ItemFila[]) => void;
const ouvintes = new Set<Ouvinte>();

export function assinar(ouvinte: Ouvinte): () => void {
  ouvintes.add(ouvinte);
  void listar().then((itens) => ouvinte(itens));
  return () => {
    ouvintes.delete(ouvinte);
  };
}

async function avisar(): Promise<void> {
  if (!ouvintes.size) return;
  const itens = await listar();
  ouvintes.forEach((ouvinte) => {
    try {
      ouvinte(itens);
    } catch {
      // um assinante quebrado não pode derrubar os outros
    }
  });
}

// ── Leitura ─────────────────────────────────────────────────────────────────

/** Itens na ordem em que foram criados (a ordem em que serão reenviados). */
export async function listar(): Promise<ItemFila[]> {
  const ids = await lerIndice();
  const itens: ItemFila[] = [];
  const idsVivos: string[] = [];
  for (const id of ids) {
    const item = await lerItem(id);
    if (item) {
      itens.push(item);
      idsVivos.push(id);
    }
  }
  // Índice pode citar item que sumiu (storage limpo, downgrade): reconcilia.
  if (idsVivos.length !== ids.length) await gravarIndice(idsVivos);
  return itens;
}

export async function contar(): Promise<number> {
  return (await lerIndice()).length;
}

/** Pendentes de verdade — exclui os que o servidor já recusou definitivamente. */
export async function contarPendentes(): Promise<number> {
  return (await listar()).filter((item) => !item.falhou).length;
}

// ── Escrita ─────────────────────────────────────────────────────────────────

/**
 * Multipart não entra na fila: o corpo é um `FormData` com um arquivo, que não
 * sobrevive a `JSON.stringify` nem a um restart do app (o URI apontaria para um
 * cache que o Android pode ter limpado). Enfileirar isso gravaria um envio que
 * falharia para sempre — pior que falhar na hora, que ao menos o usuário vê.
 */
export function podeEnfileirar(metodo: string | undefined, dados: unknown): boolean {
  const m = String(metodo || '').toLowerCase();
  if (!['post', 'put', 'patch', 'delete'].includes(m)) return false;
  if (typeof FormData !== 'undefined' && dados instanceof FormData) return false;
  return true;
}

export async function enfileirar(entrada: {
  id: string;
  metodo: MetodoEscrita;
  url: string;
  dados?: unknown;
  rotulo: string;
}): Promise<ItemFila | null> {
  const ids = await lerIndice();
  if (ids.includes(entrada.id)) return lerItem(entrada.id);
  if (ids.length >= MAX_ITENS) return null;

  const item: ItemFila = {
    id: entrada.id,
    criadoEm: Date.now(),
    metodo: entrada.metodo,
    url: entrada.url,
    dados: entrada.dados,
    rotulo: entrada.rotulo,
    tentativas: 1, // a tentativa original, a que falhou, já conta
  };

  await gravarItem(item);
  await gravarIndice([...ids, item.id]);
  await avisar();
  return item;
}

export async function descartar(id: string): Promise<void> {
  const ids = await lerIndice();
  await gravarIndice(ids.filter((outro) => outro !== id));
  await apagarItem(id);
  await avisar();
}

export async function limpar(): Promise<void> {
  const ids = await lerIndice();
  for (const id of ids) await apagarItem(id);
  await gravarIndice([]);
  await avisar();
}

// ── Reenvio ─────────────────────────────────────────────────────────────────

export interface ResultadoEnvio {
  ok: boolean;
  /** true quando falhou por rede — o resto da fila nem deve ser tentado. */
  semRede?: boolean;
  /** true quando o servidor recusou de forma definitiva (não adianta repetir). */
  definitivo?: boolean;
  erro?: string;
}

export type Executor = (item: ItemFila) => Promise<ResultadoEnvio>;

export interface ResumoSincronizacao {
  enviados: number;
  falhados: number;
  restantes: number;
  interrompido: boolean;
}

let sincronizando = false;

/**
 * Reenvia a fila em ordem. Para na primeira falha de rede — se a conexão caiu,
 * insistir nos itens seguintes só queima bateria e embaralha a ordem das
 * escritas, que importa (uma saída de ponto depois de uma entrada).
 */
export async function sincronizar(executar: Executor): Promise<ResumoSincronizacao> {
  if (sincronizando) {
    return { enviados: 0, falhados: 0, restantes: await contar(), interrompido: true };
  }
  sincronizando = true;

  let enviados = 0;
  let falhados = 0;
  let interrompido = false;

  try {
    const itens = await listar();
    for (const item of itens) {
      if (item.falhou) continue;
      if (item.tentativas >= MAX_TENTATIVAS) {
        item.falhou = true;
        item.ultimoErro = 'Número máximo de tentativas atingido.';
        await gravarItem(item);
        falhados++;
        continue;
      }

      const resultado = await executar(item);

      if (resultado.ok) {
        await descartar(item.id);
        enviados++;
        continue;
      }

      if (resultado.semRede) {
        interrompido = true;
        break;
      }

      item.tentativas++;
      item.ultimoErro = resultado.erro;
      if (resultado.definitivo) {
        item.falhou = true;
        falhados++;
      }
      await gravarItem(item);
    }
  } finally {
    sincronizando = false;
    await avisar();
  }

  return { enviados, falhados, restantes: await contar(), interrompido };
}
