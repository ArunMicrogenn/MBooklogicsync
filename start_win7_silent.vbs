' ====================================================================================================
' BookLogic Sync Silent Launcher for Windows 7 / Windows 8 / Windows 10
' Runs node sync_agent.js completely in the background without any visible command prompt window.
' ====================================================================================================
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

' Get current script directory
CurrentDir = FSO.GetParentFolderName(WScript.ScriptFullName)

' Command to execute in hidden mode with --harmony for Node 13/14 compatibility
Cmd = "cmd.exe /c cd /d """ & CurrentDir & """ && node --harmony sync_agent.js"

WshShell.Run Cmd, 0, False
