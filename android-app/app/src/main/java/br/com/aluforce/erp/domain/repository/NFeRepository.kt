package br.com.aluforce.erp.domain.repository

import br.com.aluforce.erp.core.network.Resource
import br.com.aluforce.erp.domain.model.*

interface NFeRepository {
    suspend fun getNotasFiscais(page: Int = 1, perPage: Int = 20, status: String? = null, search: String? = null, tipo: String? = null): Resource<List<NotaFiscal>>
    suspend fun getNotaFiscalById(id: Int): Resource<NotaFiscal>
    suspend fun emitirNotaFiscal(pedidoId: Int, naturezaOperacao: String?, observacoes: String?): Resource<NotaFiscal>
    suspend fun cancelarNotaFiscal(id: Int, motivo: String): Resource<NotaFiscal>
    suspend fun getDanfeUrl(id: Int): Resource<String>
    suspend fun getXmlUrl(id: Int): Resource<String>
}
