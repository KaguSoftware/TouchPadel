# Touch Padel Operator - one-line installer for Windows.
#
# Usage (Windows PowerShell, no admin needed):
#   irm https://<this-site>/install-operator.ps1 | iex
#
# Why it exists: a browser download of the unsigned installer is tagged "from the
# internet" (Mark of the Web), so SmartScreen warns on every release. A file fetched
# with Invoke-WebRequest carries no such tag, so there is no download prompt. Trust
# comes from the sha512 in the release feed (latest.yml) instead: the installer is
# checked against it and deleted if it does not match.
#
# It installs for the current user only (/S /currentuser): never asks for admin.
# Testing: TP_INSTALL_DRY_RUN=1 downloads and verifies but neither installs nor
# launches; with TP_INSTALL_TAMPER_TEST=1 as well it corrupts the download first to
# prove the integrity check refuses it.
#
# ASCII only on purpose: Windows PowerShell 5.1 decodes `irm` output oddly otherwise.
# No `exit` anywhere: under `| iex` it would close the user's window.

function Install-TouchPadelOperator {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'

  $repo = 'https://github.com/KaguSoftware/touchpadel-releases/releases'
  $dryRun = ($env:TP_INSTALL_DRY_RUN -eq '1')
  $tamper = ($dryRun -and $env:TP_INSTALL_TAMPER_TEST -eq '1')
  $workDir = $null

  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    # 1. Windows 10 or newer.
    if ([Environment]::OSVersion.Version.Major -lt 10) {
      Write-Host 'Touch Padel Operator needs Windows 10 or newer.' -ForegroundColor Red
      return
    }

    # 2. "Choose where to get apps" (Settings). Store-only blocks any installer.
    $aic = $null
    try {
      $aic = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer' -Name 'AicEnabled' -ErrorAction Stop).AicEnabled
    } catch { $aic = $null }
    $policyOn = $null
    $policyMode = $null
    try {
      $pol = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender\SmartScreen' -ErrorAction Stop
      $policyOn = $pol.ConfigureAppInstallControlEnabled
      $policyMode = $pol.ConfigureAppInstallControl
    } catch { }
    if ($policyOn -eq 1 -and $policyMode -eq 'StoreOnly') {
      Write-Host 'This PC only allows apps from the Microsoft Store, and an administrator or IT policy sets that.' -ForegroundColor Red
      Write-Host 'Ask whoever manages this PC to allow apps from anywhere, then run this command again.' -ForegroundColor Red
      return
    }
    if ($aic -eq 'StoreOnly') {
      Write-Host 'Windows is set to install apps from the Microsoft Store only, which blocks this installer.' -ForegroundColor Red
      Write-Host 'Change it, then run this command again:' -ForegroundColor Red
      Write-Host '  Windows 10: Settings > Apps > Apps & features > "Choose where to get apps" > Anywhere'
      Write-Host '  Windows 11: Settings > Apps > Advanced app settings > "Choose where to get apps" > Anywhere'
      return
    }
    if ($aic -eq 'Recommendations' -or $aic -eq 'PreferStore' -or $policyMode -eq 'Recommendations' -or $policyMode -eq 'PreferStore') {
      Write-Host 'Heads-up: Windows may ask once about installing an app from outside the Store. Click "Install anyway".' -ForegroundColor Yellow
    }

    # 2b. An all-users copy (HKLM, Program Files) is not replaced by a per-user install:
    # the two would sit side by side and the old one would never update.
    foreach ($root in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
      foreach ($k in (Get-ChildItem -Path $root -ErrorAction SilentlyContinue)) {
        $dn = (Get-ItemProperty -Path $k.PSPath -ErrorAction SilentlyContinue).DisplayName
        if ($dn -like 'Touch Padel Operator*') {
          Write-Host 'An all-users copy of Touch Padel Operator is already installed on this PC.' -ForegroundColor Red
          Write-Host 'Uninstall it first: Settings > Apps, pick Touch Padel Operator, Uninstall (this needs an administrator).' -ForegroundColor Red
          Write-Host 'Your till data is kept (queue.db and station.json in %APPDATA%). Then run this command again.' -ForegroundColor Red
          return
        }
      }
    }

    # 3. The release feed: version, installer name and its sha512 (base64).
    Write-Host 'Checking the latest version...'
    $feed = (Invoke-WebRequest -UseBasicParsing -Uri "$repo/latest/download/latest.yml").Content
    if ($feed -is [byte[]]) { $feed = [Text.Encoding]::UTF8.GetString($feed) }
    $m = [regex]::Match($feed, '(?m)^version:\s*[''"]?(\d+\.\d+\.\d+[^''"\s]*)')
    if (-not $m.Success) { throw 'Could not read the version from the release feed.' }
    $version = $m.Groups[1].Value
    $f = [regex]::Match($feed, '(?ms)-\s*url:\s*[''"]?(Touch-Padel-Operator-Setup\.exe)[''"]?\s*\r?\n\s*sha512:\s*[''"]?([A-Za-z0-9+/=]+)[''"]?(?:\s*\r?\n\s*size:\s*(\d+))?')
    if (-not $f.Success) { throw 'Could not find the Windows installer in the release feed.' }
    $fileName = $f.Groups[1].Value
    $expected = $f.Groups[2].Value
    $mb = ''
    if ($f.Groups[3].Success) { $mb = ' (' + [math]::Round([double]$f.Groups[3].Value / 1MB) + ' MB)' }

    # 4. Download from the VERSIONED url, so the feed and the file cannot straddle a release.
    $workDir = Join-Path $env:TEMP ('touchpadel-operator-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $workDir | Out-Null
    $exe = Join-Path $workDir $fileName
    Write-Host "Downloading Touch Padel Operator $version$mb..."
    Invoke-WebRequest -UseBasicParsing -Uri "$repo/download/v$version/$fileName" -OutFile $exe

    if ($tamper) {
      Write-Host 'TAMPER TEST: appending one byte to the download.' -ForegroundColor Yellow
      $fs = [IO.File]::Open($exe, [IO.FileMode]::Append)
      $fs.WriteByte(0)
      $fs.Close()
    }

    # 5. Integrity: sha512 of the file (hex -> bytes -> base64) against the feed.
    Write-Host 'Checking the download...'
    $hex = (Get-FileHash -Algorithm SHA512 -Path $exe).Hash
    $bytes = New-Object byte[] ($hex.Length / 2)
    for ($i = 0; $i -lt $bytes.Length; $i++) { $bytes[$i] = [Convert]::ToByte($hex.Substring($i * 2, 2), 16) }
    $actual = [Convert]::ToBase64String($bytes)
    if ($actual -ne $expected) {
      Remove-Item -LiteralPath $exe -Force -ErrorAction SilentlyContinue
      Write-Host 'The download does not match the release feed (sha512 mismatch), so it was deleted and nothing was installed.' -ForegroundColor Red
      Write-Host 'Try again in a few minutes. If it keeps failing, tell the Touch Padel team.' -ForegroundColor Red
      return
    }
    Write-Host 'Download verified.'

    if (Get-Process -Name 'Touch Padel Operator' -ErrorAction SilentlyContinue) {
      Write-Host 'The operator app is running: it will close and reopen during the install.' -ForegroundColor Yellow
    }

    if ($dryRun) {
      Write-Host "DRY RUN: would run: `"$exe`" /S /currentuser"
      Write-Host 'DRY RUN: would then launch Touch Padel Operator.'
      Write-Host "DRY RUN OK: Touch Padel Operator $version downloaded and verified."
      return
    }

    # 6. Silent install for the current user (no admin, no UAC).
    Write-Host 'Installing...'
    $p = Start-Process -FilePath $exe -ArgumentList '/S', '/currentuser' -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "The installer stopped with exit code $($p.ExitCode)." }

    # 7. Find the installed app: electron-builder writes the uninstall key (named by the
    # app GUID) and HKCU\Software\<same GUID>\InstallLocation. Enumerate by DisplayName.
    $appExe = $null
    $uninstall = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
    foreach ($k in (Get-ChildItem -Path $uninstall -ErrorAction SilentlyContinue)) {
      $dn = (Get-ItemProperty -Path $k.PSPath -ErrorAction SilentlyContinue).DisplayName
      if ($dn -like 'Touch Padel Operator*') {
        $loc = (Get-ItemProperty -Path ('HKCU:\Software\' + $k.PSChildName) -ErrorAction SilentlyContinue).InstallLocation
        if ($loc) {
          $cand = Join-Path $loc 'Touch Padel Operator.exe'
          if (Test-Path -LiteralPath $cand) { $appExe = $cand; break }
        }
      }
    }
    if (-not $appExe) {
      $cand = Join-Path $env:LOCALAPPDATA 'Programs\Touch Padel Operator\Touch Padel Operator.exe'
      if (Test-Path -LiteralPath $cand) { $appExe = $cand }
    }

    if ($appExe) {
      Write-Host "Done. Touch Padel Operator $version is installed. Opening it now..." -ForegroundColor Green
      Start-Process -FilePath $appExe
    } else {
      Write-Host "Done. Touch Padel Operator $version is installed. Open it from the Start menu." -ForegroundColor Green
    }
  } catch {
    Write-Host ('Install failed: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'Check the internet connection and run the command again. If it keeps failing, tell the Touch Padel team.' -ForegroundColor Red
  } finally {
    if ($workDir -and (Test-Path -LiteralPath $workDir)) {
      Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

Install-TouchPadelOperator
