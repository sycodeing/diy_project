$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $Python)) {
  $SharedPython = "D:\Coding\DiyProject\x-lead-studio\.venv\Scripts\python.exe"
  if (Test-Path -LiteralPath $SharedPython) {
    $Python = $SharedPython
  } else {
    throw "Create the virtual environment first, then install requirements.txt."
  }
}
Set-Location -LiteralPath $ProjectRoot
& $Python -m uvicorn lead_studio.app:app --host 127.0.0.1 --port 8020
