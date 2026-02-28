import pytest
from vendas import calcular_total, aplicar_desconto, calcular_imposto, registrar_venda


class TestCalcularTotal:
    """Testes para a função calcular_total"""
    
    def test_calculo_basico(self):
        """Testa cálculo básico de total"""
        assert calcular_total(10.0, 5) == 50.0
        assert calcular_total(25.50, 3) == 76.50
        
    def test_preco_zero(self):
        """Testa cálculo com preço zero"""
        assert calcular_total(0.0, 10) == 0.0
        
    def test_quantidade_um(self):
        """Testa cálculo com quantidade 1"""
        assert calcular_total(100.0, 1) == 100.0
        
    def test_preco_negativo(self):
        """Testa que preço negativo gera erro"""
        with pytest.raises(ValueError, match="não pode ser negativo"):
            calcular_total(-10.0, 5)
            
    def test_quantidade_zero(self):
        """Testa que quantidade zero gera erro"""
        with pytest.raises(ValueError, match="maior que zero"):
            calcular_total(10.0, 0)
            
    def test_quantidade_negativa(self):
        """Testa que quantidade negativa gera erro"""
        with pytest.raises(ValueError, match="maior que zero"):
            calcular_total(10.0, -5)
            
    def test_arredondamento(self):
        """Testa arredondamento para 2 casas decimais"""
        resultado = calcular_total(10.333, 3)
        assert resultado == 31.0  # 30.999 arredondado


class TestAplicarDesconto:
    """Testes para a função aplicar_desconto"""
    
    def test_desconto_basico(self):
        """Testa aplicação básica de desconto"""
        assert aplicar_desconto(100.0, 10) == 90.0
        assert aplicar_desconto(200.0, 25) == 150.0
        
    def test_desconto_zero(self):
        """Testa desconto de 0%"""
        assert aplicar_desconto(100.0, 0) == 100.0
        
    def test_desconto_total(self):
        """Testa desconto de 100%"""
        assert aplicar_desconto(100.0, 100) == 0.0
        
    def test_desconto_invalido_negativo(self):
        """Testa que desconto negativo gera erro"""
        with pytest.raises(ValueError, match="entre 0 e 100"):
            aplicar_desconto(100.0, -10)
            
    def test_desconto_invalido_maior_100(self):
        """Testa que desconto maior que 100 gera erro"""
        with pytest.raises(ValueError, match="entre 0 e 100"):
            aplicar_desconto(100.0, 150)
            
    def test_valor_negativo(self):
        """Testa que valor negativo gera erro"""
        with pytest.raises(ValueError, match="não pode ser negativo"):
            aplicar_desconto(-100.0, 10)
            
    def test_arredondamento(self):
        """Testa arredondamento do desconto"""
        resultado = aplicar_desconto(100.0, 33.333)
        assert resultado == 66.67  # Arredondado para 2 casas


class TestCalcularImposto:
    """Testes para a função calcular_imposto"""
    
    def test_imposto_basico(self):
        """Testa cálculo básico de imposto"""
        assert calcular_imposto(100.0, 12) == 12.0
        assert calcular_imposto(200.0, 18) == 36.0
        
    def test_imposto_zero(self):
        """Testa imposto de 0%"""
        assert calcular_imposto(100.0, 0) == 0.0
        
    def test_valor_zero(self):
        """Testa imposto sobre valor zero"""
        assert calcular_imposto(0.0, 10) == 0.0
        
    def test_imposto_invalido_negativo(self):
        """Testa que imposto negativo gera erro"""
        with pytest.raises(ValueError, match="entre 0 e 100"):
            calcular_imposto(100.0, -5)
            
    def test_imposto_invalido_maior_100(self):
        """Testa que imposto maior que 100 gera erro"""
        with pytest.raises(ValueError, match="entre 0 e 100"):
            calcular_imposto(100.0, 150)
            
    def test_valor_negativo(self):
        """Testa que valor negativo gera erro"""
        with pytest.raises(ValueError, match="não pode ser negativo"):
            calcular_imposto(-100.0, 10)


class TestRegistrarVenda:
    """Testes para a função registrar_venda"""
    
    def test_venda_basica(self):
        """Testa registro de venda básica sem desconto e imposto"""
        venda = registrar_venda("Produto A", 5, 10.0)
        
        assert venda["produto"] == "Produto A"
        assert venda["quantidade"] == 5
        assert venda["preco_unitario"] == 10.0
        assert venda["total_bruto"] == 50.0
        assert venda["total_liquido"] == 50.0
        assert venda["imposto"] == 0
        assert venda["total"] == 50.0
        
    def test_venda_com_desconto(self):
        """Testa venda com desconto aplicado"""
        venda = registrar_venda("Produto B", 10, 20.0, desconto_percentual=10)
        
        assert venda["total_bruto"] == 200.0
        assert venda["desconto_percentual"] == 10
        assert venda["total_liquido"] == 180.0
        assert venda["total"] == 180.0
        
    def test_venda_com_imposto(self):
        """Testa venda com imposto aplicado"""
        venda = registrar_venda("Produto C", 10, 10.0, imposto_percentual=12)
        
        assert venda["total_bruto"] == 100.0
        assert venda["total_liquido"] == 100.0
        assert venda["imposto_percentual"] == 12
        assert venda["imposto"] == 12.0
        assert venda["total"] == 112.0
        
    def test_venda_com_desconto_e_imposto(self):
        """Testa venda com desconto e imposto"""
        venda = registrar_venda("Produto D", 10, 100.0, desconto_percentual=20, imposto_percentual=10)
        
        assert venda["total_bruto"] == 1000.0
        assert venda["total_liquido"] == 800.0  # Com desconto de 20%
        assert venda["imposto"] == 80.0  # 10% de 800
        assert venda["total"] == 880.0
        
    def test_produto_vazio(self):
        """Testa que produto vazio gera erro"""
        with pytest.raises(ValueError, match="não pode ser vazio"):
            registrar_venda("", 5, 10.0)
            
    def test_produto_apenas_espacos(self):
        """Testa que produto com apenas espaços gera erro"""
        with pytest.raises(ValueError, match="não pode ser vazio"):
            registrar_venda("   ", 5, 10.0)
            
    def test_produto_com_espacos_extras(self):
        """Testa que espaços extras são removidos"""
        venda = registrar_venda("  Produto E  ", 1, 10.0)
        assert venda["produto"] == "Produto E"
        
    def test_valores_invalidos_propagam_erro(self):
        """Testa que valores inválidos propagam erros das funções subjacentes"""
        with pytest.raises(ValueError):
            registrar_venda("Produto", 0, 10.0)
            
        with pytest.raises(ValueError):
            registrar_venda("Produto", 5, -10.0)
            
        with pytest.raises(ValueError):
            registrar_venda("Produto", 5, 10.0, desconto_percentual=150)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
