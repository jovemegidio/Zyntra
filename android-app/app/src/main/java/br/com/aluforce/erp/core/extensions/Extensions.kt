package br.com.aluforce.erp.core.extensions

import android.content.Context
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.google.android.material.snackbar.Snackbar
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// ========== VIEW EXTENSIONS ==========

fun View.visible() { visibility = View.VISIBLE }
fun View.gone() { visibility = View.GONE }
fun View.invisible() { visibility = View.INVISIBLE }

fun View.visibleIf(condition: Boolean) {
    visibility = if (condition) View.VISIBLE else View.GONE
}

fun View.hideKeyboard() {
    val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
    imm.hideSoftInputFromWindow(windowToken, 0)
}

// ========== FRAGMENT EXTENSIONS ==========

fun Fragment.showToast(message: String, duration: Int = Toast.LENGTH_SHORT) {
    Toast.makeText(requireContext(), message, duration).show()
}

fun Fragment.showSnackbar(
    message: String,
    duration: Int = Snackbar.LENGTH_SHORT,
    actionText: String? = null,
    action: (() -> Unit)? = null
) {
    val snackbar = Snackbar.make(requireView(), message, duration)
    if (actionText != null && action != null) {
        snackbar.setAction(actionText) { action() }
    }
    snackbar.show()
}

/**
 * Collect a Flow safely within the Fragment lifecycle.
 * Automatically cancels collection when Fragment is destroyed.
 */
fun <T> Fragment.collectFlow(flow: Flow<T>, action: suspend (T) -> Unit) {
    viewLifecycleOwner.lifecycleScope.launch {
        viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
            flow.collect { action(it) }
        }
    }
}

// ========== STRING EXTENSIONS ==========

fun String?.orDefault(default: String = "-"): String = if (isNullOrBlank()) default else this

fun String.capitalizeWords(): String = split(" ").joinToString(" ") { word ->
    word.lowercase().replaceFirstChar { it.uppercase() }
}

// ========== NUMBER EXTENSIONS ==========

/**
 * Format number as Brazilian currency (R$ 1.234,56)
 */
fun Double.toBRL(): String {
    val format = NumberFormat.getCurrencyInstance(Locale("pt", "BR"))
    return format.format(this)
}

/**
 * Format number as compact (1.2K, 3.5M)
 */
fun Long.toCompact(): String = when {
    this >= 1_000_000 -> String.format("%.1fM", this / 1_000_000.0)
    this >= 1_000 -> String.format("%.1fK", this / 1_000.0)
    else -> this.toString()
}

fun Int.toCompact(): String = this.toLong().toCompact()

// ========== DATE EXTENSIONS ==========

private val apiDateFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
private val displayDateFormat = SimpleDateFormat("dd/MM/yyyy", Locale("pt", "BR"))
private val displayDateTimeFormat = SimpleDateFormat("dd/MM/yyyy HH:mm", Locale("pt", "BR"))

fun String.toDisplayDate(): String = try {
    val date = apiDateFormat.parse(this)
    displayDateFormat.format(date!!)
} catch (e: Exception) {
    this
}

fun String.toDisplayDateTime(): String = try {
    val date = apiDateFormat.parse(this)
    displayDateTimeFormat.format(date!!)
} catch (e: Exception) {
    this
}

fun Date.toApiFormat(): String = apiDateFormat.format(this)
fun Date.toDisplayFormat(): String = displayDateFormat.format(this)
