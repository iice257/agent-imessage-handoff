# iMessage Handoff relay - guided self-host deploy for Windows.
# Run from the relay folder:  powershell -ExecutionPolicy Bypass -File .\deploy-me.ps1
# Requires: a Cloudflare account (free) and a Sendblue account with your number.

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

Step "1/7 Cloudflare login (browser opens; approve the request)"
npx wrangler login
npx wrangler whoami

Step "2/7 Create the D1 database"
$dbJson = npx wrangler d1 create imessage-handoff 2>&1 | Out-String
$dbId = [regex]::Match($dbJson, "database_id\s*=\s*\"([0-9a-f-]+)\"").Groups[1].Value
if (-not $dbId) {
  # Fall back to JSON output shape if the regex misses.
  $dbId = [regex]::Match(($dbJson -replace "\s", " "), "database_id[\"':= ]+([0-9a-f-]{36})").Groups[1].Value
}
if (-not $dbId) { throw "Could not read database_id from wrangler output:`n$dbJson" }
Write-Host "D1 database_id: $dbId"

Step "3/7 Point wrangler.jsonc at your new database"
$configPath = Join-Path $PSScriptRoot "wrangler.jsonc"
$config = Get-Content $configPath -Raw
$config = $config -replace '"database_id": "[0-9a-f-]+"', ('"database_id": "' + $dbId + '"')
Set-Content $configPath $config -Encoding UTF8
Write-Host "wrangler.jsonc updated."

Step "4/7 Your Sendblue number (E.164, e.g. +15551234567)"
$number = Read-Host "SENDBLUE_FROM_NUMBER"
if ($number -notmatch '^\+\d{8,15}$') { throw "Number must look like +15551234567" }
$config = Get-Content $configPath -Raw
$config = $config -replace '"SENDBLUE_FROM_NUMBER": "\+?\d+"', ('"SENDBLUE_FROM_NUMBER": "' + $number + '"')
Set-Content $configPath $config -Encoding UTF8
Write-Host "SENDBLUE_FROM_NUMBER updated."

Step "5/7 Apply D1 migrations (this fixes the pairing_code_expires_at bug on the hosted relay)"
npm run db:migrate:remote

Step "6/7 Sendblue secrets (input hidden)"
npx wrangler secret put SENDBLUE_API_KEY
npx wrangler secret put SENDBLUE_SECRET_KEY
$webhookSecret = [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
$webhookSecret | npx wrangler secret put SENDBLUE_WEBHOOK_SECRET
Set-Content (Join-Path $PSScriptRoot ".webhook-secret.local.txt") $webhookSecret -Encoding UTF8
Write-Host "Webhook secret saved locally to .webhook-secret.local.txt (gitignored name pattern - do not commit)."

Step "7/7 Deploy"
npx wrangler deploy
$url = [regex]::Match((npx wrangler deployments list 2>&1 | Out-String), "https://imessage-handoff\.[a-z0-9-]+\.workers\.dev").Value
if (-not $url) { $url = "https://imessage-handoff.<your-subdomain>.workers.dev" }

Write-Host ""
Write-Host "Deployed: $url" -ForegroundColor Green
Write-Host @"

Next steps:
1. In the Sendblue dashboard, set the inbound webhook URL to:
     $url/webhooks/sendblue
   and set the webhook signing secret to the value saved in .webhook-secret.local.txt

2. Point the opencode skill at your relay:
     node "$env:USERPROFILE\.config\opencode\skill\imessage-handoff\scripts\handoff-cli.js" config set apiBaseUrl $url

3. Restart opencode, then say:  start handoff
   Text the pairing code it gives you to your Sendblue number within 15 minutes.
"@ -ForegroundColor Yellow
