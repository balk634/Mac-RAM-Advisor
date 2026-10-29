# Mac RAM Advisor - Automated Release Packaging Script
$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   Mac RAM Advisor - Windows Standalone Release Packager" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$rootDir = $PSScriptRoot
if (-not $rootDir) { $rootDir = (Get-Location).Path }

# 1. Compile C# System Tray Host
Write-Host ""
Write-Host "[1/4] Compiling native Windows Tray Host (MacRAMAdvisor.exe)..." -ForegroundColor Yellow
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
    throw "Microsoft .NET Framework 4.0 csc.exe compiler not found at $csc"
}

Get-Process -Name MacRAMAdvisor, backend_service -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500
& $csc /nologo /target:winexe /win32icon:"$rootDir\assets\icon.ico" /out:"$rootDir\MacRAMAdvisor.exe" "$rootDir\TrayHost.cs"
Write-Host "   -> Native C# Host compiled successfully." -ForegroundColor Green

# 2. Build PyInstaller Bundle
Write-Host ""
Write-Host "[2/4] Building standalone Python runtime bundle..." -ForegroundColor Yellow
python -m PyInstaller --noconfirm --onedir --windowed --name "backend_service" --add-data "static;static" --add-data "assets;assets" "$rootDir\backend_service.py"
Write-Host "   -> Python engine bundled into dist\backend_service." -ForegroundColor Green

# 3. Assemble Release Directory
Write-Host ""
Write-Host "[3/5] Assembling release distribution..." -ForegroundColor Yellow
$distDir = Join-Path $rootDir "dist\backend_service"
Copy-Item -Path "$rootDir\MacRAMAdvisor.exe" -Destination "$distDir\MacRAMAdvisor.exe" -Force
Copy-Item -Path "$rootDir\assets" -Destination "$distDir\assets" -Recurse -Force
Copy-Item -Path "$rootDir\static" -Destination "$distDir\static" -Recurse -Force
if (Test-Path "$distDir\_internal") {
    Copy-Item -Path "$rootDir\static" -Destination "$distDir\_internal\static" -Recurse -Force
}
Copy-Item -Path "$rootDir\Enable_AutoStart_On_Boot.bat" -Destination "$distDir\Enable_AutoStart_On_Boot.bat" -Force
Copy-Item -Path "$rootDir\Disable_AutoStart_On_Boot.bat" -Destination "$distDir\Disable_AutoStart_On_Boot.bat" -Force
Copy-Item -Path "$rootDir\Start_Mac_RAM_Advisor.bat" -Destination "$distDir\Start_Mac_RAM_Advisor.bat" -Force
Copy-Item -Path "$rootDir\README.md" -Destination "$distDir\README.md" -Force
Copy-Item -Path "$rootDir\LICENSE" -Destination "$distDir\LICENSE" -Force
if (Test-Path "$distDir\ram_advisor.db") { Remove-Item "$distDir\ram_advisor.db" -Force }
if (Test-Path "$distDir\ram_advisor.db-wal") { Remove-Item "$distDir\ram_advisor.db-wal" -Force }
if (Test-Path "$distDir\ram_advisor.db-shm") { Remove-Item "$distDir\ram_advisor.db-shm" -Force }
Write-Host "   -> Copied binaries, autostart scripts, documentation, and web assets into distribution folder." -ForegroundColor Green

# 4. Generate SHA-256 Checksums
Write-Host ""
Write-Host "[4/5] Computing cryptographic SHA-256 checksums..." -ForegroundColor Yellow
$exeHash = (Get-FileHash -Algorithm SHA256 "$distDir\MacRAMAdvisor.exe").Hash
$checksumContent = @"
Mac RAM Advisor - Cryptographic Checksums (SHA-256)
====================================================
MacRAMAdvisor.exe: $exeHash
Release Version: v1.4.0
VirusTotal Verification: https://www.virustotal.com/gui/file/$exeHash
"@
Set-Content -Path "$distDir\CHECKSUMS.txt" -Value $checksumContent -Encoding UTF8
Set-Content -Path "$rootDir\CHECKSUMS.txt" -Value $checksumContent -Encoding UTF8
Write-Host "   -> Generated CHECKSUMS.txt (SHA-256: $exeHash)" -ForegroundColor Green

# 5. Create Zip Archive
Write-Host ""
Write-Host "[5/5] Creating distribution ZIP archive..." -ForegroundColor Yellow
$zipPath = Join-Path $rootDir "MacRAMAdvisor-v1.4.0-Windows-x64.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path "$distDir\*" -DestinationPath $zipPath -Force

$zipItem = Get-Item $zipPath
$sizeMb = [math]::Round($zipItem.Length / 1MB, 2)
$zipHash = (Get-FileHash -Algorithm SHA256 $zipPath).Hash

# Append ZIP hash to root CHECKSUMS.txt
Add-Content -Path "$rootDir\CHECKSUMS.txt" -Value "MacRAMAdvisor-v1.4.0-Windows-x64.zip: $zipHash"
Add-Content -Path "$rootDir\CHECKSUMS.txt" -Value "VirusTotal ZIP URL: https://www.virustotal.com/gui/file/$zipHash"

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   Release Package Created Successfully!" -ForegroundColor Green
Write-Host "   File: $zipPath" -ForegroundColor White
Write-Host "   Size: $sizeMb MB" -ForegroundColor White
Write-Host "   EXE SHA-256: $exeHash" -ForegroundColor White
Write-Host "   ZIP SHA-256: $zipHash" -ForegroundColor White
Write-Host "   VirusTotal Link: https://www.virustotal.com/gui/file/$zipHash" -ForegroundColor Green
Write-Host "   Zero dependencies required. Runs on any Windows 10/11." -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Cyan
