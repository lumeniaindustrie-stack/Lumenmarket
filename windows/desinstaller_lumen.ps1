# =====================================================================
#  Lumen : retirer le démarrage automatique
# =====================================================================
$lien = Join-Path ([Environment]::GetFolderPath("Startup")) "Lumen agents.lnk"
if (Test-Path $lien) { Remove-Item $lien; Write-Host "Raccourci de démarrage retiré" }
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match "lumen_demarrage" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Write-Host "Gardien arrêté. n8n et Ollama, s'ils tournent, restent allumés jusqu'au prochain redémarrage."
# Remettre la veille après 30 min sur secteur et l'action par défaut à la fermeture de l'écran
powercfg /change standby-timeout-ac 30
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 1
powercfg /setactive SCHEME_CURRENT
Write-Host "Mise en veille rétablie (30 min sur secteur, veille à la fermeture de l'écran)."
Read-Host "Appuie sur Entrée pour fermer"
