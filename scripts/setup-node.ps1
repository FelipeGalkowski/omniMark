$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = Split-Path $PSScriptRoot -Parent
$toolsDirectory = Join-Path $projectRoot '.tools'
New-Item -ItemType Directory -Path $toolsDirectory -Force | Out-Null
$releases = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
$release = $releases | Where-Object { $_.version -match '^v22\.' -and $_.lts } | Select-Object -First 1
if (-not $release) { throw 'Nenhuma versão Node.js 22 LTS encontrada.' }
$archiveName = "node-$($release.version)-win-x64.zip"
$baseUrl = "https://nodejs.org/dist/$($release.version)"
$archivePath = Join-Path $toolsDirectory $archiveName
Invoke-WebRequest "$baseUrl/$archiveName" -OutFile $archivePath -UseBasicParsing
$checksums = (Invoke-WebRequest "$baseUrl/SHASUMS256.txt" -UseBasicParsing).Content
$checksumLine = ($checksums -split "`n") | Where-Object { $_.Trim().EndsWith(" $archiveName") } | Select-Object -First 1
if (-not $checksumLine) { throw 'Checksum oficial não encontrado.' }
$expectedHash = ($checksumLine.Trim() -split '\s+')[0]
if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Checksum do Node.js divergente.' }
Expand-Archive -LiteralPath $archivePath -DestinationPath $toolsDirectory -Force
$nodeDirectory = Join-Path $toolsDirectory "node-$($release.version)-win-x64"
& (Join-Path $nodeDirectory 'node.exe') --version
Write-Output "Node.js local preparado em $nodeDirectory"
