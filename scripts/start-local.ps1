$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
$localNode = Get-ChildItem -Path "$projectRoot/.tools/node-v22.*-win-x64/node.exe" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($localNode) {
    $nodeExecutable = $localNode.FullName
    $env:Path = "$($localNode.DirectoryName);$env:Path"
} else {
    $nodeExecutable = (Get-Command node -ErrorAction Stop).Source
}
if (-not (Test-Path -LiteralPath 'node_modules/tsx/dist/cli.mjs')) { throw 'Instale as dependências do projeto antes de iniciar.' }
docker compose up -d --wait
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível iniciar o banco. Abra o Docker Desktop e tente novamente.' }
$runtimeDirectory = Join-Path $projectRoot '.runtime'
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
$services = @(
    @{ Name = 'api'; Port = 3001; Directory = 'apps/api'; Arguments = @('"' + (Join-Path $projectRoot 'node_modules/tsx/dist/cli.mjs') + '"', 'src/server.ts') },
    @{ Name = 'web'; Port = 5173; Directory = 'apps/web'; Arguments = @('"' + (Join-Path $projectRoot 'node_modules/vite/bin/vite.js') + '"', '--host', '127.0.0.1', '--port', '5173', '--strictPort') }
)
foreach ($service in $services) {
    if (Get-NetTCPConnection -LocalPort $service.Port -State Listen -ErrorAction SilentlyContinue) {
        Write-Output "Porta $($service.Port) já está em uso; nenhum processo foi substituído."
        continue
    }
    $process = Start-Process -FilePath $nodeExecutable -ArgumentList $service.Arguments -WorkingDirectory (Join-Path $projectRoot $service.Directory) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDirectory "$($service.Name).log") -RedirectStandardError (Join-Path $runtimeDirectory "$($service.Name).error.log") -PassThru
    $process.Id | Set-Content -LiteralPath (Join-Path $runtimeDirectory "$($service.Name).pid")
    Write-Output "$($service.Name) iniciado (PID $($process.Id))."
}
$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        $page = Invoke-WebRequest 'http://127.0.0.1:5173/' -UseBasicParsing -TimeoutSec 2
        $health = Invoke-RestMethod 'http://127.0.0.1:5173/api/health' -TimeoutSec 2
        if ($page.Content.Contains('<title>OmniMark</title>') -and $health.status -eq 'ok') { $ready = $true; break }
    } catch { }
    Start-Sleep -Seconds 1
}
if (-not $ready) { throw 'A aplicação não respondeu como esperado. Consulte os logs em .runtime/.' }
Write-Output 'OmniMark disponível em http://localhost:5173'
