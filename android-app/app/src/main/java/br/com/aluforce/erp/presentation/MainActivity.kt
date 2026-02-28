package br.com.aluforce.erp.presentation

import android.os.Bundle
import android.view.View
import android.widget.TextView
import androidx.activity.viewModels
import androidx.appcompat.app.ActionBarDrawerToggle
import androidx.appcompat.app.AppCompatActivity
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.GravityCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.NavController
import androidx.navigation.fragment.NavHostFragment
import androidx.navigation.ui.AppBarConfiguration
import androidx.navigation.ui.navigateUp
import androidx.navigation.ui.setupActionBarWithNavController
import androidx.navigation.ui.setupWithNavController
import br.com.aluforce.erp.R
import br.com.aluforce.erp.core.security.SessionManager
import br.com.aluforce.erp.databinding.ActivityMainBinding
import br.com.aluforce.erp.presentation.auth.AuthViewModel
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * Single Activity — hosts all fragments via Navigation Component.
 *
 * Responsibilities:
 * - Splash screen handling
 * - Navigation graph management
 * - Drawer navigation with all modules
 * - Session event observation (expired, force logout)
 * - Toolbar + drawer visibility control
 */
@AndroidEntryPoint
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var navController: NavController
    private lateinit var appBarConfiguration: AppBarConfiguration
    private lateinit var drawerToggle: ActionBarDrawerToggle
    private val authViewModel: AuthViewModel by viewModels()

    @Inject
    lateinit var sessionManager: SessionManager

    // Top-level destinations (show hamburger icon, not back arrow)
    private val topLevelDestinations = setOf(
        R.id.dashboardFragment,
        R.id.pedidosListFragment,
        R.id.clientesListFragment,
        R.id.comprasListFragment,
        R.id.pcpListFragment,
        R.id.financeiroFragment,
        R.id.rhListFragment,
        R.id.nfeListFragment
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        // Splash screen
        val splashScreen = installSplashScreen()
        splashScreen.setKeepOnScreenCondition { authViewModel.isCheckingSession.value }

        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupToolbar()
        setupNavigation()
        setupDrawer()
        observeSessionEvents()
        observeAuthState()
    }

    private fun setupToolbar() {
        setSupportActionBar(binding.toolbar)
    }

    private fun setupNavigation() {
        val navHostFragment = supportFragmentManager
            .findFragmentById(R.id.nav_host_fragment) as NavHostFragment
        navController = navHostFragment.navController

        // Configure top-level destinations for drawer
        appBarConfiguration = AppBarConfiguration(topLevelDestinations, binding.drawerLayout)
        setupActionBarWithNavController(navController, appBarConfiguration)

        // Setup drawer navigation view with nav controller
        binding.navigationView.setupWithNavController(navController)

        // Control toolbar/drawer visibility based on destination
        navController.addOnDestinationChangedListener { _, destination, _ ->
            when (destination.id) {
                R.id.loginFragment -> {
                    binding.appBarLayout.visibility = View.GONE
                    binding.drawerLayout.setDrawerLockMode(
                        androidx.drawerlayout.widget.DrawerLayout.LOCK_MODE_LOCKED_CLOSED
                    )
                }
                else -> {
                    binding.appBarLayout.visibility = View.VISIBLE
                    binding.drawerLayout.setDrawerLockMode(
                        androidx.drawerlayout.widget.DrawerLayout.LOCK_MODE_UNLOCKED
                    )
                }
            }
        }
    }

    private fun setupDrawer() {
        drawerToggle = ActionBarDrawerToggle(
            this,
            binding.drawerLayout,
            binding.toolbar,
            R.string.open_drawer,
            R.string.close_drawer
        )
        binding.drawerLayout.addDrawerListener(drawerToggle)
        drawerToggle.syncState()

        // Handle logout item separately
        binding.navigationView.setNavigationItemSelectedListener { menuItem ->
            when (menuItem.itemId) {
                R.id.nav_logout -> {
                    binding.drawerLayout.closeDrawer(GravityCompat.START)
                    authViewModel.logout()
                    true
                }
                else -> {
                    // Let NavigationUI handle the navigation
                    val handled = androidx.navigation.ui.NavigationUI
                        .onNavDestinationSelected(menuItem, navController)
                    if (handled) {
                        binding.drawerLayout.closeDrawer(GravityCompat.START)
                    }
                    handled
                }
            }
        }

        // Update header with user info when available
        updateDrawerHeader()
    }

    private fun updateDrawerHeader() {
        val headerView = binding.navigationView.getHeaderView(0)
        val tvName = headerView?.findViewById<TextView>(R.id.tvHeaderName)
        val tvEmail = headerView?.findViewById<TextView>(R.id.tvHeaderEmail)

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                // Update header with user session info if available
                tvName?.text = sessionManager.getUserName() ?: "ALUFORCE ERP"
                tvEmail?.text = sessionManager.getUserEmail() ?: ""
            }
        }
    }

    private fun observeSessionEvents() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                sessionManager.sessionEvents.collect { event ->
                    when (event) {
                        is SessionManager.SessionEvent.SessionExpired -> {
                            Timber.w("Session expired, navigating to login")
                            navigateToLogin()
                        }
                        is SessionManager.SessionEvent.ForceLogout -> {
                            Timber.w("Force logout received")
                            navigateToLogin()
                        }
                        is SessionManager.SessionEvent.SessionRefreshed -> {
                            Timber.d("Session refreshed")
                        }
                    }
                }
            }
        }
    }

    private fun observeAuthState() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                authViewModel.navigateToLogin.collect { shouldNavigate ->
                    if (shouldNavigate) {
                        navigateToLogin()
                    }
                }
            }
        }
    }

    private fun navigateToLogin() {
        navController.navigate(R.id.loginFragment)
    }

    override fun onUserInteraction() {
        super.onUserInteraction()
        sessionManager.recordActivity()
    }

    override fun onSupportNavigateUp(): Boolean {
        return navController.navigateUp(appBarConfiguration) || super.onSupportNavigateUp()
    }

    @Deprecated("Use onBackPressedDispatcher")
    override fun onBackPressed() {
        if (binding.drawerLayout.isDrawerOpen(GravityCompat.START)) {
            binding.drawerLayout.closeDrawer(GravityCompat.START)
        } else {
            super.onBackPressed()
        }
    }
}
