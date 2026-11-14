<#
.SYNOPSIS
  PrivMeet stack launcher for Windows, for people who did not install the desktop app.

.DESCRIPTION
  The PowerShell twin of scripts/privmeet.sh. Everything it runs is plain `docker compose`;
  read the file before you run it.

    .\scripts\privmeet.ps1 up              start the stack, add the GPU override when
                                           nvidia-smi works, then open http://127.0.0.1:8000
    .\scripts\privmeet.ps1 down            stop the stack; the data volumes are kept
    .\scripts\privmeet.ps1 logs [service]  follow the logs
    .\scripts\privmeet.ps1 update          pull newer images, then restart what is running
    .\scripts\privmeet.ps1 status          show the containers and whether the app answers

  If scripts are blocked, run it once with:
    powershell -ExecutionPolicy Bypass -File .\scripts\privmeet.ps1 up
#>
param(
  [Parameter(Position = 0)][string]$Command = "",
  [Parameter(Position = 1, ValueFromRemainingArguments = $true)][string[]]$Rest = @()
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$Url = "http://127.0.0.1:8000"

function Die([string]$Message) {
  Write-Host "privmeet: $Message" -ForegroundColor Red
  exit 1
}

function Have([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Show-Usage([int]$Code = 0) {
  Write-Host @"
usage: .\scripts\privmeet.ps1 <command> [service]

  up                start the stack, add the GPU override when nvidia-smi
                    works, then open $Url
  down              stop the stack; the data volumes are kept
  logs [service]    follow the logs
  update            pull newer images, then restart what is running
  status            show the containers and whether the app answers
"@
  exit $Code
}

# Use the GPU override only when the file is there and an NVIDIA GPU answers.
function Test-Gpu {
  if (-not (Test-Path "compose.gpu.yml") -or -not (Have "nvidia-smi")) { return $false }
  & nvidia-smi -L *> $null
  return ($LASTEXITCODE -eq 0)
}

function Invoke-Compose([string[]]$Arguments) {
  $files = @()
  if (Test-Gpu) { $files = @("-f", "compose.yml", "-f", "compose.gpu.yml") }
  & docker compose @files @Arguments
  if ($LASTEXITCODE -ne 0) { Die "docker compose $($Arguments -join ' ') failed (exit $LASTEXITCODE)." }
}

function Assert-Docker {
  if (-not (Have "docker")) { Die "Docker is not installed: https://docs.docker.com/desktop/setup/install/windows-install/" }
  & docker info *> $null
  if ($LASTEXITCODE -ne 0) { Die "Docker is not running. Start Docker Desktop and try again." }
}

# The stack refuses to start without SECRET_KEY, so make one on the first run instead of
# failing with a compose interpolation error.
function Initialize-Env {
  if (Test-Path ".env") { return }
  if (-not (Test-Path ".env.example")) { Die "no .env.example here; run this from the PrivMeet checkout" }
  $bytes = New-Object byte[] 48
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $key = [Convert]::ToBase64String($bytes)
  # LF endings and no BOM: compose would keep a stray \r or BOM in the values.
  $text = (Get-Content ".env.example" -Raw) -replace "`r`n", "`n" -replace "(?m)^SECRET_KEY=.*$", "SECRET_KEY=$key"
  [System.IO.File]::WriteAllText((Join-Path $Root ".env"), $text, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "Created .env with a new SECRET_KEY. Change POSTGRES_PASSWORD there if you like."
}

function Test-Server {
  try {
    $null = Invoke-WebRequest -Uri "$Url/api/system/" -UseBasicParsing -TimeoutSec 3
    return $true
  } catch {
    return $false
  }
}

function Wait-Server {
  Write-Host -NoNewline "Waiting for the server"
  for ($i = 0; $i -lt 60; $i++) {
    if (Test-Server) {
      Write-Host "`nPrivMeet is up: $Url"
      Start-Process $Url
      return
    }
    Write-Host -NoNewline "."
    Start-Sleep -Seconds 2
  }
  Write-Host ""
  Die "no answer after 2 minutes. Try: .\scripts\privmeet.ps1 logs web"
}

switch ($Command) {
  "up" {
    Assert-Docker
    Initialize-Env
    if (Test-Gpu) { Write-Host "NVIDIA GPU found, using compose.gpu.yml." }
    Invoke-Compose @("up", "-d")
    Wait-Server
  }
  "down" {
    Assert-Docker
    Initialize-Env
    Invoke-Compose @("down")
  }
  "logs" {
    Assert-Docker
    Initialize-Env
    Invoke-Compose (@("logs", "-f", "--tail=100") + $Rest)
  }
  "update" {
    Assert-Docker
    Initialize-Env
    Invoke-Compose @("pull")
    # Recreate only the containers whose image changed; a stopped stack stays stopped.
    $running = & docker compose ps -q
    if ($running) {
      Invoke-Compose @("up", "-d")
      Write-Host "Updated and restarted."
    } else {
      Write-Host "Images updated. Start with: .\scripts\privmeet.ps1 up"
    }
  }
  "status" {
    Assert-Docker
    Initialize-Env
    Invoke-Compose @("ps")
    if (Test-Server) { Write-Host "PrivMeet answers at $Url" } else { Write-Host "PrivMeet does not answer at $Url" }
  }
  { $_ -in @("help", "-h", "--help") } { Show-Usage 0 }
  default { Show-Usage 1 }
}
