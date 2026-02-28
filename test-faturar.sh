curl -s -w "\nHTTP: %{http_code}" -X POST http://localhost:3000/api/vendas/pedidos/2/faturar -H "Content-Type: application/json" -d '{"gerarNFe": true}'
