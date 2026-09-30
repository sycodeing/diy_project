$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $Python)) {
  throw "Create the virtual environment first with the existing mockup-renderer Python, then install requirements.txt."
}
Set-Location -LiteralPath $ProjectRoot
& $Python -m uvicorn lead_studio.app:app --host 127.0.0.1 --port 8020
