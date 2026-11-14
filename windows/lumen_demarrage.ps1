# =====================================================================
#  Lumen : gardien + télécommande locale du PC
#  Lancé automatiquement à l'ouverture de session (raccourci dans Démarrage).
#   1. Garde n8n allumé (vérifie chaque minute et le relance s'il s'arrête).
#   2. Garde Ollama allumé, SAUF si tu l'as arrêté depuis le pilotage.
#   3. Écoute sur http://localhost:5680 pour la page « Contrôle » du pilotage :
#      état du PC, démarrer / arrêter Ollama, lancer un agent à la main.
#      Seul le site de pilotage peut l'utiliser (contrôle de l'origine),
#      et uniquement depuis ce PC (localhost).
# =====================================================================
$VERSION = "2"
$PORT = 5680
$dossier = Join-Path $env:USERPROFILE ".lumen"
New-Item -ItemType Directory -Force -Path $dossier | Out-Null
$journal = Join-Path $dossier "demarrage.log"
$pauseOllama = Join-Path $dossier "ollama_pause"   # présent = Ollama arrêté volontairement
$dossierExec = Join-Path $dossier "executions"
New-Item -ItemType Directory -Force -Path $dossierExec | Out-Null

# Sites autorisés à piloter ce PC
$ORIGINES = @('^https://lumenmarket\.pages\.dev$', '^https://[a-z0-9-]+\.lumenmarket\.pages\.dev$', '^https://([a-z0-9-]+\.)?lumen-marche\.fr$')

function Ecrire($message) {
  Add-Content -Path $journal -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $message) -Encoding UTF8
}
function Ecoute($port) {
  try { $c = New-Object Net.Sockets.TcpClient; $c.Connect("127.0.0.1", $port); $c.Close(); return $true } catch { return $false }
}
function N8nLance() {
  $p = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "n8n" -and $_.CommandLine -notmatch " execute " }
  return [bool]$p
}
function DemarrerOllama() {
  try { Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden; Ecrire "Ollama démarré" } catch { Ecrire "Impossible de lancer Ollama : $_" }
}
function ArreterOllama() {
  Get-Process -Name "ollama", "ollama app", "ollama_llama_server", "llama-server" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Ecrire "Ollama arrêté depuis le pilotage"
}
function DemarrerN8n() {
  $log = Join-Path $dossier "n8n.log"
  try { Start-Process -FilePath "cmd.exe" -ArgumentList "/c n8n start >> `"$log`" 2>&1" -WindowStyle Hidden; Ecrire "n8n démarré" } catch { Ecrire "Impossible de lancer n8n : $_" }
}

# ---------- Liste des workflows n8n (id | nom), lue en arrière-plan ----------
$script:workflows = @()
$script:workflowsLe = [datetime]::MinValue
$script:jobListe = $null
function LancerLectureWorkflows() {
  if ($script:jobListe -and $script:jobListe.State -eq 'Running') { return }
  $script:jobListe = Start-Job -ScriptBlock { (& cmd.exe /c "n8n list:workflow 2>nul") -join "`n" }
}
function RecupererLectureWorkflows() {
  if ($script:jobListe -and $script:jobListe.State -ne 'Running') {
    try {
      $txt = Receive-Job $script:jobListe -ErrorAction SilentlyContinue
      $liste = @()
      foreach ($l in (("" + $txt) -split "`n")) {
        if ($l -match '^\s*([A-Za-z0-9]{4,})\|(.+)$') { $liste += [pscustomobject]@{ id = $Matches[1]; nom = $Matches[2].Trim() } }
      }
      if ($liste.Count -gt 0) { $script:workflows = $liste; $script:workflowsLe = Get-Date }
    } catch { Ecrire "Lecture des workflows impossible : $_" }
    Remove-Job $script:jobListe -Force -ErrorAction SilentlyContinue
    $script:jobListe = $null
  }
}
function WorkflowsDe($code) {
  $lettre = ($code -split '-')[0]
  return @($script:workflows | Where-Object { $_.nom -match ("Agent " + [regex]::Escape($lettre) + "\s*:") })
}

# ---------- Agents lancés à la main ----------
$script:executions = @{}   # code -> @{ proc; debut; fin; log }
function EtatExecutions() {
  $r = @{}
  foreach ($code in @($script:executions.Keys)) {
    $e = $script:executions[$code]
    $fini = $e.proc.HasExited
    $x = @{ en_cours = (-not $fini); debut = $e.debut.ToString("o"); fin = $null; reussi = $null; detail = $null }
    if ($fini) {
      if (-not $e.fin) { $e.fin = (Get-Date).ToString("o") }
      $x.fin = $e.fin
      $x.reussi = ($e.proc.ExitCode -eq 0)
      if (-not $x.reussi) {
        try { $t = (Get-Content -Path $e.log -Raw -ErrorAction Stop); if ($t.Length -gt 500) { $t = $t.Substring($t.Length - 500) }; $x.detail = $t } catch {}
      }
    }
    $r[$code] = $x
  }
  return $r
}
function LancerAgent($code) {
  if ($code -notmatch '^[A-Z][0-9]?-[a-z]+$') { return @{ ok = $false; message = "Agent inconnu." } }
  if (-not (N8nLance) -and -not (Ecoute 5678)) { return @{ ok = $false; message = "n8n ne tourne pas sur ce PC." } }
  if ($script:workflows.Count -eq 0) { LancerLectureWorkflows; return @{ ok = $false; message = "Liste des agents n8n en cours de lecture, réessaie dans 30 secondes." } }
  $wf = WorkflowsDe $code
  if ($wf.Count -eq 0) { return @{ ok = $false; message = "Aucun workflow « Agent $(($code -split '-')[0]) » trouvé dans n8n." } }
  if ($wf.Count -gt 1) { return @{ ok = $false; message = "Plusieurs workflows portent ce nom dans n8n (" + (($wf | ForEach-Object { $_.nom }) -join " / ") + ") : supprime l'ancien puis réessaie." } }
  $e = $script:executions[$code]
  if ($e -and -not $e.proc.HasExited) { return @{ ok = $false; message = "Cet agent est déjà en cours." } }
  $log = Join-Path $dossierExec ($code + ".log")
  $id = $wf[0].id
  # Port du « task runner » différent de celui du n8n principal (5679), sinon les blocs Code échouent
  $p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c set N8N_RUNNERS_BROKER_PORT=5691&& n8n execute --id=$id > `"$log`" 2>&1" -WindowStyle Hidden -PassThru
  $script:executions[$code] = @{ proc = $p; debut = Get-Date; fin = $null; log = $log }
  Ecrire "Agent $code lancé à la main (workflow $id)"
  return @{ ok = $true; message = "Lancé : " + $wf[0].nom }
}

function Etat() {
  $ollamaTourne = Ecoute 11434
  $charges = @()
  if ($ollamaTourne) {
    try { $ps = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/ps" -TimeoutSec 3; $charges = @($ps.models | ForEach-Object { $_.name }) } catch {}
  }
  $agents = @{}
  foreach ($w in $script:workflows) { if ($w.nom -match 'Agent ([A-Z][0-9]?)\s*:') { $k = $Matches[1]; if ($agents.ContainsKey($k)) { $agents[$k] += 1 } else { $agents[$k] = 1 } } }
  return @{
    version = $VERSION
    ollama = @{ actif = $ollamaTourne; pause = (Test-Path $pauseOllama); modeles_charges = $charges }
    n8n = @{ actif = ((Ecoute 5678) -or (N8nLance)) }
    workflows = $agents
    workflows_lus = ($script:workflows.Count -gt 0)
    executions = (EtatExecutions)
  }
}

# ---------- Serveur local ----------
function Repondre($ctx, $code, $objet, $origine) {
  $rep = $ctx.Response
  $rep.StatusCode = $code
  if ($origine) {
    $rep.Headers["Access-Control-Allow-Origin"] = $origine
    $rep.Headers["Vary"] = "Origin"
    $rep.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    $rep.Headers["Access-Control-Allow-Headers"] = "Content-Type"
    $rep.Headers["Access-Control-Allow-Private-Network"] = "true"
  }
  $rep.ContentType = "application/json; charset=utf-8"
  $octets = [Text.Encoding]::UTF8.GetBytes($(if ($null -eq $objet) { "{}" } else { $objet | ConvertTo-Json -Depth 6 -Compress }))
  $rep.ContentLength64 = $octets.Length
  try { $rep.OutputStream.Write($octets, 0, $octets.Length) } catch {}
  $rep.Close()
}
function Traiter($ctx) {
  $req = $ctx.Request
  $origine = $req.Headers["Origin"]
  $autorisee = $false
  if ($origine) { foreach ($o in $ORIGINES) { if ($origine -match $o) { $autorisee = $true } } }
  if ($origine -and -not $autorisee) { Repondre $ctx 403 @{ ok = $false; message = "Origine refusée" } $null; return }
  if (-not $origine -and $req.HttpMethod -ne "GET") { Repondre $ctx 403 @{ ok = $false; message = "Origine absente" } $null; return }
  if ($req.HttpMethod -eq "OPTIONS") { Repondre $ctx 204 $null $origine; return }
  $chemin = $req.Url.AbsolutePath.TrimEnd('/')
  try {
    switch ("$($req.HttpMethod) $chemin") {
      "GET /etat" { if (((Get-Date) - $script:workflowsLe).TotalMinutes -gt 10) { LancerLectureWorkflows }; Repondre $ctx 200 (Etat) $origine }
      "POST /ollama/arreter" { New-Item -ItemType File -Force -Path $pauseOllama | Out-Null; ArreterOllama; Repondre $ctx 200 @{ ok = $true } $origine }
      "POST /ollama/demarrer" { Remove-Item $pauseOllama -Force -ErrorAction SilentlyContinue; if (-not (Ecoute 11434)) { DemarrerOllama }; Repondre $ctx 200 @{ ok = $true } $origine }
      "POST /agents/rafraichir" { LancerLectureWorkflows; Repondre $ctx 200 @{ ok = $true } $origine }
      "POST /agent/lancer" { Repondre $ctx 200 (LancerAgent ("" + $req.QueryString["code"])) $origine }
      default { Repondre $ctx 404 @{ ok = $false; message = "Inconnu" } $origine }
    }
  } catch {
    Ecrire "Erreur télécommande : $_"
    try { Repondre $ctx 500 @{ ok = $false; message = "$_" } $origine } catch {}
  }
}

# Un seul gardien à la fois
$verrou = New-Object System.Threading.Mutex($false, "Global\LumenGardien")
if (-not $verrou.WaitOne(0)) { exit }

Ecrire "Gardien démarré (version $VERSION)"

$serveur = $null
try {
  $serveur = New-Object System.Net.HttpListener
  $serveur.Prefixes.Add("http://localhost:$PORT/")
  $serveur.Start()
  Ecrire "Télécommande à l'écoute sur http://localhost:$PORT"
} catch { Ecrire "Télécommande impossible à démarrer : $_"; $serveur = $null }

$attente = $null
if ($serveur) { $attente = $serveur.GetContextAsync() }
$prochaineVerif = (Get-Date).AddSeconds(15)
$n8nPasAvant = Get-Date
LancerLectureWorkflows

while ($true) {
  # 1. Requêtes du pilotage (on attend au plus 1 seconde)
  if ($attente) {
    try {
      if ($attente.Wait(1000)) { $ctx = $attente.Result; $attente = $serveur.GetContextAsync(); Traiter $ctx }
    } catch { Ecrire "Télécommande : $_"; try { $attente = $serveur.GetContextAsync() } catch { $attente = $null } }
  } else { Start-Sleep -Seconds 1 }
  RecupererLectureWorkflows

  # 2. Gardien : une vérification par minute
  if ((Get-Date) -ge $prochaineVerif) {
    $prochaineVerif = (Get-Date).AddSeconds(60)
    if (-not (Test-Path $pauseOllama) -and -not (Ecoute 11434)) { Ecrire "Ollama ne répond pas : démarrage"; DemarrerOllama }
    if ((Get-Date) -ge $n8nPasAvant -and -not (Ecoute 5678) -and -not (N8nLance)) {
      Ecrire "n8n arrêté : démarrage"; DemarrerN8n
      $n8nPasAvant = (Get-Date).AddSeconds(120)   # laisse le temps à n8n de démarrer
    }
  }
}
