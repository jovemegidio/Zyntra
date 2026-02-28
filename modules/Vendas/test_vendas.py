import unittest
from vendas import calcular_total, aplicar_desconto, registrar_venda

class TestVendas(unittest.TestCase):

    def test_calcular_total(self):
        """Testa o cálculo do total."""
        self.assertEqual(calcular_total(10.5, 4), 42.0)

    def test_aplicar_desconto(self):
        """Testa a aplicação de um desconto válido."""
        self.assertAlmostEqual(aplicar_desconto(150, 10), 135.0)

    def test_aplicar_desconto_invalido(self):
        """Testa se um erro é lançado para descontos inválidos."""
        with self.assertRaises(ValueError):
            aplicar_desconto(100, -5)  # Desconto negativo
        with self.assertRaises(ValueError):
            aplicar_desconto(100, 101) # Desconto acima de 100%

    def test_registrar_venda_sem_desconto(self):
        """Testa o registro de uma venda sem desconto."""
        venda = registrar_venda("Caneta", 10, 1.50)
        self.assertEqual(venda["total"], 15.00)
        
    def test_registrar_venda_com_desconto(self):
        """Testa o registro de uma venda com desconto."""
        venda = registrar_venda("Caderno", 5, 20.00, desconto_percentual=15)
        # Total bruto = 100.00, com 15% de desconto = 85.00
        self.assertEqual(venda["total"], 85.00)

if __name__ == '__main__':
    unittest.main()