package br.com.aluforce.erp.core.security

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import timber.log.Timber
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "aluforce_prefs")

/**
 * Secure token management using Android Keystore + EncryptedSharedPreferences.
 *
 * Security measures:
 * - Tokens stored in EncryptedSharedPreferences (AES-256-SIV + AES-256-GCM)
 * - Master key backed by Android Keystore (hardware-backed when available)
 * - Device ID persisted across sessions for multi-device tracking
 * - Non-sensitive preferences in standard DataStore
 */
@Singleton
class TokenManager @Inject constructor(
    @ApplicationContext private val context: Context
) {

    companion object {
        private const val ENCRYPTED_PREFS_NAME = "aluforce_secure_prefs"
        private const val KEY_ACCESS_TOKEN = "access_token"
        private const val KEY_REFRESH_TOKEN = "refresh_token"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_TOKEN_EXPIRY = "token_expiry"

        // DataStore keys (non-sensitive)
        private val KEY_USER_ID = stringPreferencesKey("user_id")
        private val KEY_USER_NAME = stringPreferencesKey("user_name")
        private val KEY_USER_EMAIL = stringPreferencesKey("user_email")
        private val KEY_USER_ROLE = stringPreferencesKey("user_role")
        private val KEY_USER_AVATAR = stringPreferencesKey("user_avatar")
    }

    private val masterKey by lazy {
        MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
    }

    private val encryptedPrefs by lazy {
        try {
            EncryptedSharedPreferences.create(
                context,
                ENCRYPTED_PREFS_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            Timber.e(e, "Failed to create EncryptedSharedPreferences, falling back")
            // Fallback: delete corrupted file and retry
            context.getSharedPreferences(ENCRYPTED_PREFS_NAME, Context.MODE_PRIVATE)
                .edit().clear().apply()
            EncryptedSharedPreferences.create(
                context,
                ENCRYPTED_PREFS_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        }
    }

    // ========== ACCESS TOKEN ==========

    suspend fun saveAccessToken(token: String, expiryMs: Long) {
        encryptedPrefs.edit()
            .putString(KEY_ACCESS_TOKEN, token)
            .putLong(KEY_TOKEN_EXPIRY, System.currentTimeMillis() + expiryMs)
            .apply()
        Timber.d("Access token saved (expires in ${expiryMs / 1000}s)")
    }

    suspend fun getAccessToken(): String? {
        val expiry = encryptedPrefs.getLong(KEY_TOKEN_EXPIRY, 0)
        if (expiry > 0 && System.currentTimeMillis() > expiry) {
            Timber.d("Access token expired locally")
            return null // Token expired
        }
        return encryptedPrefs.getString(KEY_ACCESS_TOKEN, null)
    }

    fun isTokenExpired(): Boolean {
        val expiry = encryptedPrefs.getLong(KEY_TOKEN_EXPIRY, 0)
        return expiry > 0 && System.currentTimeMillis() > expiry
    }

    // ========== REFRESH TOKEN ==========

    suspend fun saveRefreshToken(token: String) {
        encryptedPrefs.edit()
            .putString(KEY_REFRESH_TOKEN, token)
            .apply()
        Timber.d("Refresh token saved")
    }

    suspend fun getRefreshToken(): String? {
        return encryptedPrefs.getString(KEY_REFRESH_TOKEN, null)
    }

    // ========== DEVICE ID ==========

    suspend fun getDeviceId(): String {
        var deviceId = encryptedPrefs.getString(KEY_DEVICE_ID, null)
        if (deviceId.isNullOrBlank()) {
            deviceId = UUID.randomUUID().toString()
            encryptedPrefs.edit().putString(KEY_DEVICE_ID, deviceId).apply()
            Timber.i("New device ID generated: $deviceId")
        }
        return deviceId
    }

    // ========== USER INFO (NON-SENSITIVE) ==========

    suspend fun saveUserInfo(id: String, name: String, email: String, role: String, avatar: String?) {
        context.dataStore.edit { prefs ->
            prefs[KEY_USER_ID] = id
            prefs[KEY_USER_NAME] = name
            prefs[KEY_USER_EMAIL] = email
            prefs[KEY_USER_ROLE] = role
            avatar?.let { prefs[KEY_USER_AVATAR] = it }
        }
    }

    suspend fun getUserId(): String? = context.dataStore.data.map { it[KEY_USER_ID] }.first()
    suspend fun getUserName(): String? = context.dataStore.data.map { it[KEY_USER_NAME] }.first()
    suspend fun getUserEmail(): String? = context.dataStore.data.map { it[KEY_USER_EMAIL] }.first()
    suspend fun getUserRole(): String? = context.dataStore.data.map { it[KEY_USER_ROLE] }.first()

    // ========== CLEAR ALL ==========

    suspend fun clearAll() {
        encryptedPrefs.edit().clear().apply()
        context.dataStore.edit { it.clear() }
        Timber.i("All tokens and user info cleared")
    }

    /**
     * Check if user has a valid (non-expired) session.
     */
    suspend fun hasValidSession(): Boolean {
        val token = getAccessToken()
        return !token.isNullOrBlank() && !isTokenExpired()
    }
}
