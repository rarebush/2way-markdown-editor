#!/usr/bin/env pwsh
# Sync local commits to both origin and rarebush remotes
# Usage: .\sync-remotes.ps1 [branch]

param(
    [string]$branch = "main"
)

Write-Host "Syncing branch '$branch' to both remotes..." -ForegroundColor Cyan

# Push to origin
Write-Host "`nPushing to origin..." -ForegroundColor Yellow
git push origin $branch
if ($LASTEXITCODE -ne 0) {
    Write-Host "Push to origin failed" -ForegroundColor Red
    exit 1
}

# Get commit hashes
$localCommit = git rev-parse HEAD
$originCommit = git rev-parse "origin/$branch"

if ($originCommit -ne $localCommit) {
    Write-Host "origin/$branch is not in sync" -ForegroundColor Red
    exit 1
}
Write-Host "OK: origin/$branch is current" -ForegroundColor Green

# Switch to rarebush account and push
Write-Host "`nSwitching to rarebush..." -ForegroundColor Yellow
gh auth switch --hostname github.com --user rarebush

Write-Host "Pushing to rarebush..." -ForegroundColor Yellow
git push rarebush $branch
if ($LASTEXITCODE -ne 0) {
    Write-Host "Push to rarebush failed" -ForegroundColor Red
    gh auth switch --hostname github.com --user sallen-wiley
    exit 1
}

# Switch back
gh auth switch --hostname github.com --user sallen-wiley

# Verify sync
$rarebushCommit = git rev-parse "rarebush/$branch"
if ($rarebushCommit -eq $localCommit -and $originCommit -eq $localCommit) {
    Write-Host "`nSUCCESS: Both remotes in sync at $localCommit" -ForegroundColor Green
} else {
    Write-Host "`nWARNING: Remotes out of sync" -ForegroundColor Yellow
    Write-Host "  Local: $localCommit"
    Write-Host "  origin: $originCommit"
    Write-Host "  rarebush: $rarebushCommit"
    exit 1
}
