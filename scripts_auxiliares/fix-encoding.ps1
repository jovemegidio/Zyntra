# Script para corrigir encoding de arquivos HTML
$ErrorActionPreference = 'Continue'

$files = @(
    "modules\Vendas\public\index.html",
    "modules\Vendas\public\clientes.html"
)

$replacements = @{
    # Acentuacao comum
    'Or�amento' = 'Orcamento'
    'Orcamento' = 'Orcamento'  
    '�rea' = 'Area'
    'Se��o' = 'Secao'
    'c�digo' = 'codigo'
    'C�digo' = 'Codigo'
    'sugest�es' = 'sugestoes'
    'Cr�dito' = 'Credito'
    'cr�dito' = 'credito'
    'Previs�o' = 'Previsao'
    'previs�o' = 'previsao'
    'N�mero' = 'Numero'
    'n�mero' = 'numero'
    'Cen�rio' = 'Cenario'
    'cen�rio' = 'cenario'
    'Exporta��o' = 'Exportacao'
    'exporta��o' = 'exportacao'
    'Conte�do' = 'Conteudo'
    'conte�do' = 'conteudo'
    'Informa��es' = 'Informacoes'
    'informa��es' = 'informacoes'
    'Observa��es' = 'Observacoes'
    'observa��es' = 'observacoes'
    'usu�rio' = 'usuario'
    'Usu�rio' = 'Usuario'
    'Raz�o' = 'Razao'
    'raz�o' = 'razao'
    'Jur�dica' = 'Juridica'
    'jur�dica' = 'juridica'
    'p�gina' = 'pagina'
    'P�gina' = 'Pagina'
    'A��es' = 'Acoes'
    'a��es' = 'acoes'
    'Endere�o' = 'Endereco'
    'endere�o' = 'endereco'
    'Gest�o' = 'Gestao'
    'gest�o' = 'gestao'
    'Relat�rios' = 'Relatorios'
    'relat�rios' = 'relatorios'
    'Configura��es' = 'Configuracoes'
    'configura��es' = 'configuracoes'
    'Notifica��es' = 'Notificacoes'
    'notifica��es' = 'notificacoes'
    'descri��o' = 'descricao'
    'Descri��o' = 'Descricao'
    'posi��o' = 'posicao'
    'Posi��o' = 'Posicao'
    'An�lise' = 'Analise'
    'an�lise' = 'analise'
    'Inclus�o' = 'Inclusao'
    'inclus�o' = 'inclusao'
    '�ltimo' = 'Ultimo'
    '�ltimo' = 'ultimo'
    'T�tulo' = 'Titulo'
    't�tulo' = 'titulo'
    'espa�o' = 'espaco'
    'Espa�o' = 'Espaco'
    'est�' = 'esta'
    'Est�' = 'Esta'
    'Bot�o' = 'Botao'
    'bot�o' = 'botao'
    'Bot�es' = 'Botoes'
    'bot�es' = 'botoes'
    'Hist�rico' = 'Historico'
    'hist�rico' = 'historico'
    'Pagina��o' = 'Paginacao'
    'pagina��o' = 'paginacao'
    'anima��o' = 'animacao'
    'Anima��o' = 'Animacao'
    'Formul�rio' = 'Formulario'
    'formul�rio' = 'formulario'
    'Op��es' = 'Opcoes'
    'op��es' = 'opcoes'
    'Impress�o' = 'Impressao'
    'impress�o' = 'impressao'
    'CONFIRMA��O' = 'CONFIRMACAO'
    'A��o' = 'Acao'
    'a��o' = 'acao'
    'Banc�rios' = 'Bancarios'
    'banc�rios' = 'bancarios'
    'Inscri��es' = 'Inscricoes'
    'inscri��es' = 'inscricoes'
    'Caracter�sticas' = 'Caracteristicas'
    'caracter�sticas' = 'caracteristicas'
    'Amap�' = 'Amapa'
    'Cear�' = 'Ceara'
    'Esp�rito' = 'Espirito'
    'Goi�s' = 'Goias'
    'Maranh�o' = 'Maranhao'
    'Par�' = 'Para'
    'Para�ba' = 'Paraiba'
    'Paran�' = 'Parana'
    'Piau�' = 'Piaui'
    'Rond�nia' = 'Rondonia'
    'S�o' = 'Sao'
    'al�m' = 'alem'
    'funcion�rio' = 'funcionario'
    'N�' = 'N'
}

foreach ($file in $files) {
    $fullPath = Join-Path "c:\Users\Administrator\Desktop\Sistema - ALUFORCE - V.2" $file
    if (Test-Path $fullPath) {
        Write-Host "Processando: $file"
        $content = Get-Content -Path $fullPath -Raw -Encoding UTF8
        
        foreach ($key in $replacements.Keys) {
            $content = $content -replace [regex]::Escape($key), $replacements[$key]
        }
        
        Set-Content -Path $fullPath -Value $content -Encoding UTF8 -NoNewline
        Write-Host "  Corrigido!"
    } else {
        Write-Host "  Arquivo nao encontrado: $fullPath"
    }
}

Write-Host "Concluido!"
