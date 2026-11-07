# =====================================================================
#  Lumen : garde Ollama et n8n allumés sur ce PC
#  Lancé automatiquement à l'ouverture de session (raccourci dans Démarrage).
#  Vérifie chaque minute et relance ce qui s'est arrêté.
# =====================================================================
$dossier = Join-Path $env:USERPROFILE ".lumen"
New-Item -ItemType Directory -Force -Path $dossier | Out-Null
$journal = Join-Path $dossier "demarrage.log"

function Ecrire($message) {
  Add-Content -Path $journal -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $message) -Encoding UTF8
}
function Ecoute($port) {
  try { $c = New-Object Net.Sockets.TcpClient; $c.Connect("127.0.0.1", $port); $c.Close(); return $true } catch { return $false }
}
function N8nLance() {
  $p = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "n8n" }
  return [bool]$p
}

# Un seul gardien à la fois
$verrou = New-Object System.Threading.Mutex($false, "Global\LumenGardien")
if (-not $verrou.WaitOne(0)) { exit }

Ecrire "Gardien démarré"
Start-Sleep -Seconds 15

while ($true) {
  if (-not (Ecoute 11434)) {
    Ecrire "Ollama ne répond pas : démarrage"
    try { Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden } catch { Ecrire "Impossible de lancer Ollama : $_" }
    Start-Sleep -Seconds 20
  }
  if (-not (Ecoute 5678) -and -not (N8nLance)) {
    Ecrire "n8n arrêté : démarrage"
    $log = Join-Path $dossier "n8n.log"
    try { Start-Process -FilePath "cmd.exe" -ArgumentList "/c n8n start >> `"$log`" 2>&1" -WindowStyle Hidden } catch { Ecrire "Impossible de lancer n8n : $_" }
    Start-Sleep -Seconds 120   # laisse le temps à n8n de démarrer
  }
  Start-Sleep -Seconds 60
}
