param(
  [string]$EnvName = "yd-agent",
  [string]$EnvironmentFile = "environment.yml"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command conda -ErrorAction SilentlyContinue)) {
  throw "conda was not found on PATH. Open an Anaconda PowerShell prompt or initialize conda first."
}

if (-not (Test-Path -LiteralPath $EnvironmentFile)) {
  throw "Environment file not found: $EnvironmentFile"
}

$envList = conda env list
$envExists = $envList | Select-String -Pattern "^\s*$([regex]::Escape($EnvName))\s+"

if ($envExists) {
  Write-Host "Updating conda environment: $EnvName"
  conda env update -n $EnvName -f $EnvironmentFile --prune
} else {
  Write-Host "Creating conda environment: $EnvName"
  conda env create -n $EnvName -f $EnvironmentFile
}

$condaInfo = conda info --json | ConvertFrom-Json
$envPath = Join-Path $condaInfo.envs_dirs[0] $EnvName
$pythonPath = Join-Path $envPath "python.exe"
$npmPath = Join-Path $envPath "npm.cmd"

if (-not (Test-Path -LiteralPath $pythonPath)) {
  throw "Expected Python was not found: $pythonPath"
}
if (-not (Test-Path -LiteralPath $npmPath)) {
  throw "Expected npm was not found: $npmPath"
}

Write-Host "Installing npm dependencies inside $EnvName"
& $npmPath install

Write-Host "Checking toolchain"
& $pythonPath -m platformio --version
& $pythonPath -c "import serial; print('pyserial', serial.VERSION)"
& (Join-Path $envPath "node.exe") --version
& $npmPath --version

Write-Host "Conda environment is ready: $envPath"
