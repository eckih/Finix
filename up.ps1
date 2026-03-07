# Startet zuerst LibreTranslate (aus libretranslate/lt-local), falls noch nicht laufend.
# Anschließend: docker compose mit allen übergebenen Argumenten (z. B. -f docker-compose.dev.yml up).
# Verwendung: .\up.ps1 up   oder   .\up.ps1 -f docker-compose.dev.yml up

Set-Location $PSScriptRoot

$running = docker ps --format "{{.Names}}" | Select-String -Pattern "^libretranslate$" -Quiet
if (-not $running) {
    Write-Host "Starte LibreTranslate (libretranslate/lt-local) …"
    docker compose -f libretranslate/lt-local/docker-compose.yml up -d
}

# Basis-Compose immer mit angeben, damit backend/frontend (build/image) definiert sind
docker compose -f docker-compose.yml @args
