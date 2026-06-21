<#
.SYNOPSIS
  Lanza la API y la app de escritorio de AutoCode en una sola consola.

.DESCRIPTION
  Ejecuta 'pnpm dev' en apps/api y apps/desktop en paralelo, todo escupiendo
  en esta misma consola para poder depurar. Ctrl+C para ambos.

.NOTES
  Si PowerShell se queja por la politica de ejecucion:
    Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
    .\scripts\dev.ps1
#>

$ErrorActionPreference = 'Stop'

$root       = Split-Path -Parent $PSScriptRoot
$apiDir     = Join-Path $root 'apps\api'
$desktopDir = Join-Path $root 'apps\desktop'

if (-not (Test-Path $apiDir) -or -not (Test-Path $desktopDir)) {
  Write-Host "No encuentro apps\api o apps\desktop bajo $root" -ForegroundColor Red
  exit 1
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Host "pnpm no esta en PATH. Ejecuta antes:" -ForegroundColor Red
  Write-Host "  corepack enable; corepack prepare pnpm@9 --activate" -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "==== AutoCode dev ====" -ForegroundColor Cyan
Write-Host "  API     : $apiDir"
Write-Host "            -> http://127.0.0.1:4317"
Write-Host "  Desktop : $desktopDir"
Write-Host "            -> Vite (5173) + Electron"
Write-Host "  Ctrl+C  : para ambos"
Write-Host "======================" -ForegroundColor Cyan
Write-Host ""

$procs = @()

try {
  # cmd /c "pnpm dev"  -> evita el problema de Start-Process con shims .ps1
  $api = Start-Process -FilePath cmd.exe -ArgumentList '/c', 'pnpm dev' `
    -WorkingDirectory $apiDir -NoNewWindow -PassThru
  $procs += $api
  Write-Host "[api]     pid $($api.Id)" -ForegroundColor DarkCyan

  Start-Sleep -Seconds 2

  $desk = Start-Process -FilePath cmd.exe -ArgumentList '/c', 'pnpm dev' `
    -WorkingDirectory $desktopDir -NoNewWindow -PassThru
  $procs += $desk
  Write-Host "[desktop] pid $($desk.Id)" -ForegroundColor DarkGreen

  # Espera viva: si cualquiera muere, paramos el resto
  while ($true) {
    Start-Sleep -Milliseconds 500
    $dead = $procs | Where-Object { $_.HasExited }
    if ($dead) {
      Write-Host ""
      foreach ($d in $dead) {
        $name = if ($d.Id -eq $api.Id) { 'api' } else { 'desktop' }
        Write-Host "[$name] pid $($d.Id) termino con codigo $($d.ExitCode)" -ForegroundColor Yellow
      }
      break
    }
  }
}
finally {
  Write-Host ""
  Write-Host "Parando procesos..." -ForegroundColor Yellow
  foreach ($p in $procs) {
    try {
      if ($p -and -not $p.HasExited) {
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
      }
    } catch {}
  }
  # Mata residuales: hijos de pnpm/cmd que se hayan quedado huerfanos
  Get-Process node, electron, qdrant -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Write-Host "Listo." -ForegroundColor Yellow
}
