param(
  [string]$Python = "python",
  [switch]$SkipNpmInstall,
  [switch]$SkipPythonInstall
)

$ErrorActionPreference = "Stop"

Write-Host "== Embex local setup =="
Write-Host "Workspace: $PWD"

if (-not (Test-Path "package.json")) {
  throw "package.json not found. Run this script from the Embex project root."
}

if (-not $SkipPythonInstall) {
  Write-Host ""
  Write-Host "== Python dependencies =="
  & $Python --version
  & $Python -m pip install -r requirements.txt
  & $Python -m platformio --version
}

if (-not $SkipNpmInstall) {
  Write-Host ""
  Write-Host "== Node dependencies =="
  node --version
  npm --version
  npm install
}

if (-not (Test-Path ".env") -and (Test-Path ".env.example")) {
  Copy-Item ".env.example" ".env"
  Write-Host ""
  Write-Host "Created .env from .env.example. Edit .env or use the Model page to configure your model API key."
}

Write-Host ""
Write-Host "== Verify =="
npm run build

Write-Host ""
Write-Host "Setup completed."
Write-Host "Start Embex with: npm run dev"
Write-Host "Open: http://127.0.0.1:5173/"
