package br.com.aluforce.erp.core.network

/**
 * Sealed class representing all possible outcomes of a network/data operation.
 * Used throughout the app for consistent state management.
 *
 * Usage in ViewModel:
 * ```
 * when (result) {
 *     is Resource.Loading -> showLoading()
 *     is Resource.Success -> showData(result.data)
 *     is Resource.Error -> showError(result.message)
 * }
 * ```
 */
sealed class Resource<out T> {

    data class Success<out T>(val data: T) : Resource<T>()

    data class Error(
        val message: String,
        val code: String? = null,
        val errors: List<FieldError>? = null
    ) : Resource<Nothing>()

    data object Loading : Resource<Nothing>()

    val isSuccess get() = this is Success
    val isError get() = this is Error
    val isLoading get() = this is Loading

    /**
     * Map the success data to another type.
     */
    fun <R> map(transform: (T) -> R): Resource<R> = when (this) {
        is Success -> Success(transform(data))
        is Error -> Error(message, code, errors)
        is Loading -> Loading
    }

    /**
     * Execute action only on success.
     */
    inline fun onSuccess(action: (T) -> Unit): Resource<T> {
        if (this is Success) action(data)
        return this
    }

    /**
     * Execute action only on error.
     */
    inline fun onError(action: (String, String?) -> Unit): Resource<T> {
        if (this is Error) action(message, code)
        return this
    }

    companion object {
        fun <T> loading(): Resource<T> = Loading
        fun <T> success(data: T): Resource<T> = Success(data)
        fun <T> error(message: String, code: String? = null): Resource<T> = Error(message, code)
    }
}

/**
 * Represents a field-level validation error from the API.
 */
data class FieldError(
    val field: String,
    val message: String,
    val code: String? = null
)
