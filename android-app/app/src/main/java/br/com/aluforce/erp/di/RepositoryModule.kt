package br.com.aluforce.erp.di

import br.com.aluforce.erp.data.repository.AuthRepositoryImpl
import br.com.aluforce.erp.data.repository.ClientesRepositoryImpl
import br.com.aluforce.erp.data.repository.ComprasRepositoryImpl
import br.com.aluforce.erp.data.repository.DashboardRepositoryImpl
import br.com.aluforce.erp.data.repository.FinanceiroRepositoryImpl
import br.com.aluforce.erp.data.repository.NFeRepositoryImpl
import br.com.aluforce.erp.data.repository.PCPRepositoryImpl
import br.com.aluforce.erp.data.repository.RHRepositoryImpl
import br.com.aluforce.erp.data.repository.VendasRepositoryImpl
import br.com.aluforce.erp.domain.repository.AuthRepository
import br.com.aluforce.erp.domain.repository.ClientesRepository
import br.com.aluforce.erp.domain.repository.ComprasRepository
import br.com.aluforce.erp.domain.repository.DashboardRepository
import br.com.aluforce.erp.domain.repository.FinanceiroRepository
import br.com.aluforce.erp.domain.repository.NFeRepository
import br.com.aluforce.erp.domain.repository.PCPRepository
import br.com.aluforce.erp.domain.repository.RHRepository
import br.com.aluforce.erp.domain.repository.VendasRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt module binding repository interfaces to their implementations.
 * This enables swapping implementations for testing.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {

    @Binds
    @Singleton
    abstract fun bindAuthRepository(impl: AuthRepositoryImpl): AuthRepository

    @Binds
    @Singleton
    abstract fun bindDashboardRepository(impl: DashboardRepositoryImpl): DashboardRepository

    @Binds
    @Singleton
    abstract fun bindVendasRepository(impl: VendasRepositoryImpl): VendasRepository

    @Binds
    @Singleton
    abstract fun bindClientesRepository(impl: ClientesRepositoryImpl): ClientesRepository

    @Binds
    @Singleton
    abstract fun bindComprasRepository(impl: ComprasRepositoryImpl): ComprasRepository

    @Binds
    @Singleton
    abstract fun bindPCPRepository(impl: PCPRepositoryImpl): PCPRepository

    @Binds
    @Singleton
    abstract fun bindFinanceiroRepository(impl: FinanceiroRepositoryImpl): FinanceiroRepository

    @Binds
    @Singleton
    abstract fun bindRHRepository(impl: RHRepositoryImpl): RHRepository

    @Binds
    @Singleton
    abstract fun bindNFeRepository(impl: NFeRepositoryImpl): NFeRepository
}
