# PrivMeet stack launcher for Windows. Same commands as scripts/privmeet.sh.
# Everything it runs is plain `docker compose`; read the file before you run it.
#   .\scripts\privmeet.ps1 up | down | logs [service] | update | status

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$Url = "http://127.0.0.1:8000"

function Die($Message) {
    Write-Host "privmeet: $Message" -ForegroundColor Red
    exit 1
}

function Test-Gpu {
    # compose.gpu.yml arrives with T1.5; until then this is CPU only.
    if (-not (Test-Path compose.gpu.yml)) { return $false }
    if (-not (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) { return $false }
    & nvidia-smi -L *> $null
    return $LASTEXITCODE -eq 0
}

# "-p privmeet" pins the project name, so the stack is the same one compose.yml
# names and the Linux launcher starts, whatever the checkout is called.
$Compose = @("compose", "-p", "privmeet")
if (Test-Gpu) {
    $Compose += @("-f", "compose.yml", "-f", "compose.gpu.yml")
    Write-Host "NVIDIA GPU found, using compose.gpu.yml."
}

function Initialize-Env {
    if (Test-Path .env) { return }
    if (-not (Test-Path .env.example)) { Die "no .env.example here; run this from the PrivMeet checkout" }
    Copy-Item .env.example .env
    $bytes = New-Object byte[] 48
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $key = [Convert]::ToBase64String($bytes)
    $lines = Get-Content .env | ForEach-Object { $_ -replace '^SECRET_KEY=.*', "SECRET_KEY=$key" }
    # Compose reads .env as it is: write LF, not the CRLF a Windows copy would give it.
    [IO.File]::WriteAllText((Resolve-Path .env), (($lines -join "`n") + "`n"),
        (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "Created .env with a new SECRET_KEY. Change POSTGRES_PASSWORD there if you like."
}

function Assert-Docker {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Die "docker is not installed: https://docs.docker.com/desktop/install/windows-install/"
    }
    & docker info *> $null
    if ($LASTEXITCODE -ne 0) { Die "Docker Desktop is not running. Start it and try again." }
}

function Wait-Server {
    Write-Host -NoNewline "Waiting for the server"
    foreach ($i in 1..60) {
        try {
            Invoke-WebRequest "$Url/api/system/" -UseBasicParsing -TimeoutSec 3 *> $null
            Write-Host "`nPrivMeet is up: $Url"
            Start-Process $Url
            return
        } catch {
            Write-Host -NoNewline "."
            Start-Sleep -Seconds 2
        }
    }
    Write-Host ""
    Die "no answer after 2 minutes. Try: .\scripts\privmeet.ps1 logs web"
}

function Show-Status {
    & docker @Compose ps
    try {
        $system = Invoke-RestMethod "$Url/api/system/" -TimeoutSec 3
        Write-Host "`nServer: tier $($system.tier), device $($system.device), whisper $($system.whisper_model), model $($system.llm_model)"
    } catch {
        Write-Host "`nServer: not answering at $Url"
    }
}

function Show-Usage {
    Write-Host @"
usage: .\scripts\privmeet.ps1 <command> [service]

  up                start the stack, add the GPU override when nvidia-smi
                    works, then open $Url
  down              stop the stack; the data volumes are kept
  logs [service]    follow the logs
  update            pull the images named in .env, then restart the stack
  status            show the containers and the server's tier
"@
}

$Command = if ($args.Count -gt 0) { $args[0] } else { "help" }
$Rest = if ($args.Count -gt 1) { $args[1..($args.Count - 1)] } else { @() }

switch ($Command) {
    "up" {
        Initialize-Env
        Assert-Docker
        & docker @Compose up -d
        if ($LASTEXITCODE -ne 0) { Die "docker compose up failed" }
        Wait-Server
    }
    "down" {
        Initialize-Env
        Assert-Docker
        & docker @Compose down
    }
    "logs" {
        Initialize-Env
        Assert-Docker
        & docker @Compose logs -f --tail 100 @Rest
    }
    "update" {
        Initialize-Env
        Assert-Docker
        & docker @Compose pull
        if ($LASTEXITCODE -ne 0) { Die "docker compose pull failed" }
        & docker @Compose up -d
        Wait-Server
    }
    "status" {
        Initialize-Env
        Assert-Docker
        Show-Status
    }
    { $_ -in "help", "-h", "--help" } { Show-Usage }
    default {
        Show-Usage
        exit 1
    }
}
