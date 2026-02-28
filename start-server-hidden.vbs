' =============================================
' ALUFORCE V2.0 - Inicializador Silencioso
' Executa o servidor em modo oculto (sem janela CMD)
' =============================================

Dim WshShell, objFSO
Set WshShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

' Caminho do servidor
serverDir = "C:\Users\egidio\Music\Sistema - ALUFORCE - V.2"
batFile = serverDir & "\start-server.bat"

' Verifica se o arquivo existe
If objFSO.FileExists(batFile) Then
    ' Executa em modo oculto (0 = hidden, False = não espera terminar)
    WshShell.Run Chr(34) & batFile & Chr(34), 0, False
End If

Set WshShell = Nothing
Set objFSO = Nothing
