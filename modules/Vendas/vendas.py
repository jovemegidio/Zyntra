def calcular_total(preco_unitario: float, quantidade: int) -> float:
    """Calcula o valor total de um item da venda.
    
    Args:
        preco_unitario: Preço unitário do produto (deve ser >= 0)
        quantidade: Quantidade do produto (deve ser > 0)
        
    Returns:
        Valor total calculado
        
    Raises:
        ValueError: Se os parâmetros forem inválidos
    """
    if preco_unitario < 0:
        raise ValueError("O preço unitário não pode ser negativo.")
    if quantidade <= 0:
        raise ValueError("A quantidade deve ser maior que zero.")
    
    return round(preco_unitario * quantidade, 2)

def aplicar_desconto(total: float, percentual_desconto: float) -> float:
    """Aplica um desconto percentual a um valor total.
    
    Args:
        total: Valor total antes do desconto (deve ser >= 0)
        percentual_desconto: Percentual de desconto (0-100)
        
    Returns:
        Valor com desconto aplicado
        
    Raises:
        ValueError: Se os parâmetros forem inválidos
    """
    if total < 0:
        raise ValueError("O valor total não pode ser negativo.")
    if not 0 <= percentual_desconto <= 100:
        raise ValueError("O percentual de desconto deve estar entre 0 e 100.")
    
    desconto = total * (percentual_desconto / 100)
    return round(total - desconto, 2)

def calcular_imposto(valor: float, percentual_imposto: float) -> float:
    """Calcula o valor do imposto sobre um valor base.
    
    Args:
        valor: Valor base para cálculo do imposto
        percentual_imposto: Percentual do imposto (0-100)
        
    Returns:
        Valor do imposto calculado
        
    Raises:
        ValueError: Se os parâmetros forem inválidos
    """
    if valor < 0:
        raise ValueError("O valor não pode ser negativo.")
    if not 0 <= percentual_imposto <= 100:
        raise ValueError("O percentual de imposto deve estar entre 0 e 100.")
    
    return round(valor * (percentual_imposto / 100), 2)

def registrar_venda(produto: str, quantidade: int, preco_unitario: float, desconto_percentual: float = 0, imposto_percentual: float = 0) -> dict:
    """Registra uma nova venda, calculando o total e aplicando descontos e impostos.
    
    Args:
        produto: Nome do produto
        quantidade: Quantidade vendida
        preco_unitario: Preço unitário do produto
        desconto_percentual: Percentual de desconto (padrão: 0)
        imposto_percentual: Percentual de imposto (padrão: 0)
        
    Returns:
        Dicionário com informações da venda
        
    Raises:
        ValueError: Se os parâmetros forem inválidos
    """
    if not produto or not produto.strip():
        raise ValueError("O nome do produto não pode ser vazio.")
    
    total_bruto = calcular_total(preco_unitario, quantidade)
    
    total_liquido = total_bruto
    if desconto_percentual > 0:
        total_liquido = aplicar_desconto(total_bruto, desconto_percentual)
    
    imposto = 0
    if imposto_percentual > 0:
        imposto = calcular_imposto(total_liquido, imposto_percentual)
    
    total_final = round(total_liquido + imposto, 2)
    
    venda = {
        "produto": produto.strip(),
        "quantidade": quantidade,
        "preco_unitario": round(preco_unitario, 2),
        "total_bruto": total_bruto,
        "desconto_percentual": desconto_percentual,
        "total_liquido": total_liquido,
        "imposto_percentual": imposto_percentual,
        "imposto": imposto,
        "total": total_final
    }
    return venda