package br.com.aluforce.erp.core.network

import com.google.gson.annotations.SerializedName

/**
 * Standard API response envelope.
 * Mirrors the padronized backend response format.
 *
 * All API endpoints MUST return this structure:
 * ```json
 * {
 *   "success": true/false,
 *   "data": { ... } or [ ... ],
 *   "message": "...",
 *   "errors": [...],
 *   "meta": { "pagination": {...}, "timestamp": "..." }
 * }
 * ```
 */
data class ApiResponse<T>(
    @SerializedName("success")
    val success: Boolean,

    @SerializedName("data")
    val data: T?,

    @SerializedName("message")
    val message: String?,

    @SerializedName("errors")
    val errors: List<ApiFieldError>?,

    @SerializedName("meta")
    val meta: ApiMeta?
)

/**
 * API metadata envelope (pagination, timestamps, etc.)
 */
data class ApiMeta(
    @SerializedName("pagination")
    val pagination: ApiPagination?,

    @SerializedName("timestamp")
    val timestamp: String?,

    @SerializedName("requestId")
    val requestId: String?,

    @SerializedName("version")
    val version: String?,

    @SerializedName("errorCode")
    val errorCode: String?
)

/**
 * Standard pagination metadata.
 */
data class ApiPagination(
    @SerializedName("page")
    val page: Int,

    @SerializedName("perPage")
    val perPage: Int,

    @SerializedName("total")
    val total: Int,

    @SerializedName("totalPages")
    val totalPages: Int,

    @SerializedName("hasNext")
    val hasNext: Boolean,

    @SerializedName("hasPrev")
    val hasPrev: Boolean
)

/**
 * Field-level error from API validation.
 */
data class ApiFieldError(
    @SerializedName("field")
    val field: String,

    @SerializedName("message")
    val message: String,

    @SerializedName("code")
    val code: String?
)

/**
 * Paginated list wrapper for domain layer.
 */
data class PaginatedResult<T>(
    val items: List<T>,
    val page: Int,
    val perPage: Int,
    val total: Int,
    val totalPages: Int,
    val hasNext: Boolean
)
