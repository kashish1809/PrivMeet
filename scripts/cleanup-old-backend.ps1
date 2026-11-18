# Remove the Python backend a checkout from before the Rust server still has on disk.
#
#   powershell -ExecutionPolicy Bypass -File scripts\cleanup-old-backend.ps1 [-DryRun]
#
# `backend/` was deleted from git, but git never removes files it does not track, so every
# checkout that once ran the old backend still carries its virtualenv, caches and models:
# about 9 GB. This moves what the Rust server can still use into native\server\data and
# deletes the rest. It does nothing when there is no backend folder.
#
# Nothing here is tracked by git, so nothing it touches can be recovered with git.
param([switch]$DryRun)
$ErrorActionPreference = "Stop"

$root = (git rev-parse --show-toplevel) 2>$null
if (-not $root) { Write-Error "not a git checkout"; exit 1 }
$root = $root -replace "/", "\"
$old = Join-Path $root "backend"
$new = Join-Path $root "native\server\data"
if (-not (Test-Path $old)) { exit 0 }

function Say($m) { Write-Host "privmeet: $m" }
function Size($p) {
  $b = (Get-ChildItem $p -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  if (-not $b) { return "0 B" }
  "{0:N1} GB" -f ($b / 1GB)
}

Say "found an old Python backend at backend\ ($(Size $old)). Tidying it up."

# Keep what the Rust server still reads: the recordings, the speaker models and the database,
# which `privmeet-server import-django` turns into meetings.
function Keep($from, $to) {
  if (-not (Test-Path $from)) { return }
  if (Test-Path $to) { Say "keeping your own $(Split-Path $to -Leaf); leaving $from alone"; return }
  if ($DryRun) { Write-Host "  would move: $from -> $to"; return }
  New-Item -ItemType Directory -Force (Split-Path $to -Parent) | Out-Null
  Move-Item $from $to
  Say "kept $(Split-Path $from -Leaf) -> $($to.Substring($root.Length + 1))"
}

Keep (Join-Path $old "data\media\uploads")  (Join-Path $new "media\uploads")
Keep (Join-Path $old "data\models\diarize") (Join-Path $new "models\diarize")
Keep (Join-Path $old "data\db.sqlite3")     (Join-Path $new "django-db.sqlite3")
Keep (Join-Path $old "data\settings.json")  (Join-Path $new "django-settings.json")

# The rest is the Python install itself: the virtualenv, the caches, the source and the
# faster-whisper model cache, which whisper.cpp cannot read.
Say "removing backend\ ($(Size $old) left)"
if ($DryRun) { Write-Host "  would remove: $old" } else { Remove-Item $old -Recurse -Force }

if ((Test-Path (Join-Path $new "django-db.sqlite3")) -and -not (Test-Path (Join-Path $new "privmeet.sqlite3"))) {
  Write-Host ""
  Write-Host "Your old meetings are kept. To bring them into the Rust server:"
  Write-Host ""
  Write-Host "  cd native\server; cargo build --release"
  Write-Host "  .\target\release\privmeet-server.exe import-django data\django-db.sqlite3"
  Write-Host ""
  Write-Host "The recordings are already in place, so the import only copies the rows."
}

Say "done."
