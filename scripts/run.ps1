param(
  [ValidateSet('dev', 'build', 'start', 'typecheck', 'lint', 'test', 'format', 'format:check', 'install')]
  [string]$Task = 'start'
)
$ErrorActionPreference = 'Stop'
$appDirectory = Split-Path -Parent $PSScriptRoot
$bundledRuntime = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node'
$nodePath = Join-Path $bundledRuntime 'bin\node.exe'
$pnpmScript = Join-Path $bundledRuntime 'node_modules\pnpm\bin\pnpm.cjs'
$originalSearchPath = $env:PATH
Push-Location -LiteralPath $appDirectory
try {
  if ((Test-Path -LiteralPath $nodePath) -and (Test-Path -LiteralPath $pnpmScript)) {
    $env:PATH = "$(Join-Path $bundledRuntime 'bin');$originalSearchPath"
    if ($Task -eq 'install') { & $nodePath $pnpmScript install --frozen-lockfile }
    else { & $nodePath $pnpmScript run $Task }
  } else {
    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { throw 'Node.jsとpnpmが必要です。READMEの手順を確認してください。' }
    if ($Task -eq 'install') { pnpm install --frozen-lockfile }
    else { pnpm run $Task }
  }
  if ($LASTEXITCODE -ne 0) { throw "コマンドが終了しました（終了コード: $LASTEXITCODE）。" }
} finally { $env:PATH = $originalSearchPath; Pop-Location }
