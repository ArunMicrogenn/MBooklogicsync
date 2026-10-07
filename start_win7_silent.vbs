' ====================================================================================================
' BookLogic Sync Silent Launcher for Windows 7 / Windows 8 / Windows 10
' Runs node sync_agent.js completely in the background without any visible command prompt window.
' ====================================================================================================
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

' Get current script directory
CurrentDir = FSO.GetParentFolderName(WScript.ScriptFullName)

' Command to execute in hidden mode (0 = hide window, false = do not wait)
Cmd = "cmd.exe /c cd /d """ & CurrentDir & """ && node sync_agent.js"

WshShell.Run Cmd, 0, False
