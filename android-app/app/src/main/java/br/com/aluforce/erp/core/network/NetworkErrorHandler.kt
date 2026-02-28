package br.com.aluforce.erp.core.network

import com.google.gson.Gson
import retrofit2.HttpException
import retrofit2.Response
import timber.log.Timber
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/**
 * Centralized network error handler.
 * Converts all types of errors into consistent Resource.Error responses.
 *
 * Handles:
 * - HTTP errors (4xx, 5xx) with API error body parsing
 * - Network errors (no internet, timeout, DNS)
 * - Unexpected exceptions
 */
object NetworkErrorHandler {

    private val gson = Gson()

    /**
     * Execute a suspending API call safely, returning Resource.
     */
    suspend fun <T> safeApiCall(apiCall: suspend () -> Response<ApiResponse<T>>): Resource<T> {
        return try {
            val response = apiCall()
            handleResponse(response)
        } catch (e: Exception) {
            handleException(e)
        }
    }

    /**
     * Process an HTTP response into a Resource.
     */
    private fun <T> handleResponse(response: Response<ApiResponse<T>>): Resource<T> {
        if (response.isSuccessful) {
            val body = response.body()
            return when {
                body == null -> Resource.error("Resposta vazia do servidor")
                body.success && body.data != null -> Resource.success(body.data)
                body.success && body.data == null -> Resource.error(body.message ?: "Dados não encontrados")
                else -> Resource.error(
                    message = body.message ?: "Erro desconhecido",
                    code = body.meta?.errorCode
                )
            }
        }

        // Parse error body
        return parseErrorBody(response)
    }

    /**
     * Parse error response body for structured error information.
     */
    private fun <T> parseErrorBody(response: Response<ApiResponse<T>>): Resource<T> {
        val errorBody = response.errorBody()?.string()
        return try {
            if (errorBody != null) {
                val apiError = gson.fromJson(errorBody, ApiResponse::class.java)
                Resource.Error(
                    message = apiError?.message ?: getDefaultMessage(response.code()),
                    code = apiError?.meta?.errorCode ?: response.code().toString(),
                    errors = apiError?.errors?.map {
                        FieldError(field = it.field, message = it.message, code = it.code)
                    }
                )
            } else {
                Resource.error(getDefaultMessage(response.code()), response.code().toString())
            }
        } catch (e: Exception) {
            Timber.w(e, "Failed to parse error body")
            Resource.error(getDefaultMessage(response.code()), response.code().toString())
        }
    }

    /**
     * Convert exceptions to Resource.Error with user-friendly messages.
     */
    private fun <T> handleException(exception: Exception): Resource<T> {
        Timber.e(exception, "API call failed")
        return when (exception) {
            is SocketTimeoutException -> Resource.error(
                "Tempo de conexão esgotado. Verifique sua internet.",
                "TIMEOUT"
            )
            is UnknownHostException -> Resource.error(
                "Sem conexão com a internet.",
                "NO_INTERNET"
            )
            is IOException -> Resource.error(
                "Erro de conexão. Tente novamente.",
                "NETWORK_ERROR"
            )
            is HttpException -> Resource.error(
                getDefaultMessage(exception.code()),
                exception.code().toString()
            )
            else -> Resource.error(
                "Erro inesperado: ${exception.localizedMessage}",
                "UNKNOWN"
            )
        }
    }

    /**
     * Default user-friendly messages for HTTP status codes.
     */
    private fun getDefaultMessage(code: Int): String = when (code) {
        400 -> "Dados inválidos. Verifique os campos."
        401 -> "Sessão expirada. Faça login novamente."
        403 -> "Você não tem permissão para esta ação."
        404 -> "Recurso não encontrado."
        409 -> "Conflito: o registro já existe."
        422 -> "Dados não puderam ser processados."
        429 -> "Muitas requisições. Aguarde um momento."
        500 -> "Erro interno do servidor."
        503 -> "Serviço temporariamente indisponível."
        else -> "Erro $code: Tente novamente."
    }
}
