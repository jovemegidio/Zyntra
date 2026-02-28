package br.com.aluforce.erp.di

import br.com.aluforce.erp.data.remote.api.AuthApiService
import br.com.aluforce.erp.data.remote.api.ClientesApiService
import br.com.aluforce.erp.data.remote.api.ComprasApiService
import br.com.aluforce.erp.data.remote.api.DashboardApiService
import br.com.aluforce.erp.data.remote.api.FinanceiroApiService
import br.com.aluforce.erp.data.remote.api.NFeApiService
import br.com.aluforce.erp.data.remote.api.PCPApiService
import br.com.aluforce.erp.data.remote.api.RHApiService
import br.com.aluforce.erp.data.remote.api.VendasApiService
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import retrofit2.Retrofit
import javax.inject.Singleton

/**
 * Hilt module providing Retrofit API service interfaces.
 * Each service maps to a module/domain of the ALUFORCE ERP.
 */
@Module
@InstallIn(SingletonComponent::class)
object ApiModule {

    @Provides
    @Singleton
    fun provideAuthApiService(retrofit: Retrofit): AuthApiService {
        return retrofit.create(AuthApiService::class.java)
    }

    @Provides
    @Singleton
    fun provideDashboardApiService(retrofit: Retrofit): DashboardApiService {
        return retrofit.create(DashboardApiService::class.java)
    }

    @Provides
    @Singleton
    fun provideVendasApiService(retrofit: Retrofit): VendasApiService {
        return retrofit.create(VendasApiService::class.java)
    }

    @Provides
    @Singleton
    fun provideClientesApiService(retrofit: Retrofit): ClientesApiService {
        return retrofit.create(ClientesApiService::class.java)
    }

    @Provides
    @Singleton
    fun provideComprasApiService(retrofit: Retrofit): ComprasApiService {
        return retrofit.create(ComprasApiService::class.java)
    }

    @Provides
    @Singleton
    fun providePCPApiService(retrofit: Retrofit): PCPApiService {
        return retrofit.create(PCPApiService::class.java)
    }

    @Provides
    @Singleton
    fun provideFinanceiroApiService(retrofit: Retrofit): FinanceiroApiService {
        return retrofit.create(FinanceiroApiService::class.java)
    }

    @Provides
    @Singleton
    fun provideRHApiService(retrofit: Retrofit): RHApiService {
        return retrofit.create(RHApiService::class.java)
    }

    @Provides
    @Singleton
    fun provideNFeApiService(retrofit: Retrofit): NFeApiService {
        return retrofit.create(NFeApiService::class.java)
    }
}
