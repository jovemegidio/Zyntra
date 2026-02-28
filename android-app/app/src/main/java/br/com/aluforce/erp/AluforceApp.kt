package br.com.aluforce.erp

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import dagger.hilt.android.HiltAndroidApp
import timber.log.Timber
import javax.inject.Inject

/**
 * Application class — Entry point for Hilt DI and global initialization.
 *
 * Responsibilities:
 * - Initialize Hilt dependency injection
 * - Configure WorkManager with Hilt
 * - Setup Timber logging (debug only)
 */
@HiltAndroidApp
class AluforceApp : Application(), Configuration.Provider {

    @Inject
    lateinit var workerFactory: HiltWorkerFactory

    override fun onCreate() {
        super.onCreate()

        // Initialize Timber for debug builds only
        if (BuildConfig.ENABLE_LOGGING) {
            Timber.plant(Timber.DebugTree())
        }

        Timber.i("🚀 ALUFORCE ERP Mobile v${BuildConfig.VERSION_NAME} initialized")
    }

    /**
     * WorkManager configuration with Hilt worker factory.
     * Allows injecting dependencies into Worker classes.
     */
    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .setMinimumLoggingLevel(
                if (BuildConfig.ENABLE_LOGGING) android.util.Log.DEBUG
                else android.util.Log.ERROR
            )
            .build()
}
