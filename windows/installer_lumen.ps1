# =====================================================================
#  Lumen : installation du démarrage automatique (à lancer une seule fois)
#  Clic droit sur ce fichier > "Exécuter avec PowerShell"
# =====================================================================
$ErrorActionPreference = "Stop"
try {
  $source = Join-Path $PSScriptRoot "lumen_demarrage.ps1"
  if (-not (Test-Path $source)) { throw "Le fichier lumen_demarrage.ps1 est introuvable à côté de l'installateur. Décompresse d'abord le zip (clic droit > Extraire tout), puis relance depuis le dossier extrait." }
  $dossier = Join-Path $env:USERPROFILE ".lumen"
  New-Item -ItemType Directory -Force -Path $dossier | Out-Null
  Copy-Item -Path (Join-Path $PSScriptRoot "lumen_demarrage.ps1") -Destination $dossier -Force
  $script = Join-Path $dossier "lumen_demarrage.ps1"
  Unblock-File -Path $script -ErrorAction SilentlyContinue
  $arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""

  # 1. Raccourci dans le dossier Démarrage de Windows
  $demarrage = [Environment]::GetFolderPath("Startup")
  $shell = New-Object -ComObject WScript.Shell
  $lien = $shell.CreateShortcut((Join-Path $demarrage "Lumen agents.lnk"))
  $lien.TargetPath = "powershell.exe"
  $lien.Arguments = $arguments
  $lien.WindowStyle = 7
  $lien.Description = "Garde Ollama et n8n allumés pour les agents Lumen"
  $lien.Save()
  Write-Host "OK  Démarrage automatique installé" -ForegroundColor Green

  # 2. Le PC ne se met plus en veille quand il est branché (sur batterie : rien ne change)
  powercfg /change standby-timeout-ac 0
  powercfg /change hibernate-timeout-ac 0
  # Écran rabattu sur secteur : le PC reste allumé
  powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
  powercfg /setactive SCHEME_CURRENT
  Write-Host "OK  Pas de mise en veille sur secteur, même écran rabattu" -ForegroundColor Green

  # 3. On lance le gardien tout de suite
  Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -WindowStyle Hidden
  Write-Host "OK  Gardien lancé. Journal : $dossier\demarrage.log" -ForegroundColor Green
  Write-Host ""
  Write-Host "Tu peux fermer cette fenêtre. Au prochain démarrage du PC, tout se relancera seul."
} catch {
  Write-Host ""
  Write-Host "ERREUR : $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Fais une capture de cette fenêtre et envoie-la moi."
}
Read-Host "Appuie sur Entrée pour fermer"
