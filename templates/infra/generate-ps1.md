# Template: generate.ps1 — Script de empaquetado Docker

**tags:** powershell, docker, build, deploy
**transversal:** true

```powershell
# generate.ps1 — Construye la imagen Docker y la exporta
param(
  [string]$AppName = "miapp",
  [string]$Version = "1.0.0",
  [switch]$Push,
  [string]$Registry = ""
)

$tag = if ($Registry) { "$Registry/${AppName}:$Version" } else { "${AppName}:$Version" }

Write-Host "Construyendo imagen: $tag" -ForegroundColor Cyan

# Build
docker build -t $tag .
if ($LASTEXITCODE -ne 0) { Write-Error "Build fallido"; exit 1 }

# Exportar como .tar para despliegue sin registry
$tarFile = "${AppName}-${Version}.tar"
docker save -o $tarFile $tag
Write-Host "Imagen exportada: $tarFile" -ForegroundColor Green

if ($Push -and $Registry) {
  docker push $tag
  Write-Host "Imagen publicada en: $tag" -ForegroundColor Green
}

Write-Host ""
Write-Host "Para desplegar en el servidor:" -ForegroundColor Yellow
Write-Host "  docker load -i $tarFile"
Write-Host "  docker-compose up -d"
```
