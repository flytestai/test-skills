Option Explicit

' QDesk local service launcher for Windows Task Scheduler.
' Starts node server.js without a console window and avoids duplicate instances.

Dim fso, shell, scriptDir, serverJs, nodeExe, dataDir, logFile
Dim healthUrl, q, command

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
serverJs = fso.BuildPath(scriptDir, "server.js")
nodeExe = shell.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe")
If Not fso.FileExists(nodeExe) Then nodeExe = "node.exe"

dataDir = fso.BuildPath(scriptDir, "data")
If Not fso.FolderExists(dataDir) Then fso.CreateFolder(dataDir)
logFile = fso.BuildPath(dataDir, "qdesk-autostart.log")
healthUrl = "http://127.0.0.1:4173/api/health"

' Give the desktop and network stack a moment to settle after logon.
WScript.Sleep 5000

If ServiceReady(healthUrl) Then
  WScript.Quit 0
End If

q = Chr(34)
command = "cmd.exe /c " & q & q & nodeExe & q & " " & q & serverJs & q & _
          " > " & q & logFile & q & " 2>&1" & q

shell.CurrentDirectory = scriptDir
shell.Run command, 0, False

Function ServiceReady(url)
  On Error Resume Next
  Dim request
  ServiceReady = False
  Set request = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  request.setTimeouts 1000, 1000, 1000, 1500
  request.Open "GET", url, False
  request.Send
  If Err.Number = 0 Then
    If request.Status = 200 Then ServiceReady = True
  End If
  Err.Clear
  On Error GoTo 0
End Function
