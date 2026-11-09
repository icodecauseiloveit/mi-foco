' Inicia Mi Foco sin ventana de consola (para el arranque automatico de Windows).
' Requiere haber ejecutado iniciar.bat al menos una vez.
Set fso = CreateObject("Scripting.FileSystemObject")
carpeta = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = carpeta
sh.Run """" & carpeta & "\.venv\Scripts\pythonw.exe"" app.py --sin-navegador", 0, False
