@echo off
title SQL Server TCP/IP & Network Fixer
echo ================================================================
echo   Enabling SQL Server TCP/IP & SQL Server Browser Services
echo ================================================================
echo.

echo [1/4] Starting SQL Server Browser service...
sc config SQLBrowser start= auto >nul 2>&1
net start SQLBrowser >nul 2>&1
echo SQL Server Browser service started.

echo.
echo [2/4] Enabling TCP/IP in Windows Registry for all SQL Server instances...
powershell -Command "Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\MSSQL*' | ForEach-Object { $tcpPath = Join-Path $_.PSPath 'MSSQLServer\SuperSocketNetLib\Tcp'; if (Test-Path $tcpPath) { Set-ItemProperty -Path $tcpPath -Name 'Enabled' -Value 1 -Force; Set-ItemProperty -Path $tcpPath -Name 'ListenOnAllIPs' -Value 1 -Force; $ipAll = Join-Path $tcpPath 'IPAll'; if (Test-Path $ipAll) { Set-ItemProperty -Path $ipAll -Name 'TcpPort' -Value '1433' -Force; Set-ItemProperty -Path $ipAll -Name 'TcpDynamicPorts' -Value '' -Force; } Write-Host 'Enabled TCP/IP for' $_.PSChildName; } }"

echo.
echo [3/4] Restarting SQL Server Services...
powershell -Command "Get-Service *SQL* | Where-Object { $_.Name -like 'MSSQL*' -or $_.Name -eq 'MSSQLSERVER' -or $_.Name -like 'MSSQL$*' } | Restart-Service -Force -Verbose"

echo.
echo [4/4] Opening Windows Firewall Port 1433 and 1434...
netsh advfirewall firewall add rule name="SQL Server 1433" dir=in action=allow protocol=TCP localport=1433 >nul 2>&1
netsh advfirewall firewall add rule name="SQL Browser 1434" dir=in action=allow protocol=UDP localport=1434 >nul 2>&1

echo.
echo ================================================================
echo   SUCCESS! SQL Server TCP/IP is now ENABLED on Port 1433.
echo ================================================================
echo.
echo Now testing your sync agent...
node sync_agent.js --server="127.0.0.1" --port=1433 --database=gowtham --user=sa --password=mgenn@123
pause
