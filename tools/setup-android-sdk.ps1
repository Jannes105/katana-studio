# Installs the Android command-line tools for local builds (PLAN 9.2 D17).
# Downloads from dl.google.com, checks the SHA-1 from Google's repository list, extracts to
# %LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest and sets ANDROID_HOME and PATH for the current user.
# SDK licenses are NOT accepted here: run "sdkmanager --licenses" yourself afterwards.
$ErrorActionPreference = 'Stop'
$url = 'https://dl.google.com/android/repository/commandlinetools-win-16111833_latest.zip'  # cmdline-tools;23.0
$sha1 = '57d04f2d75eb8e8fffc5000a987e5de4b5a63e9d'
$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$target = Join-Path $sdk 'cmdline-tools\latest'

if (Test-Path (Join-Path $target 'bin\sdkmanager.bat')) {
  Write-Host "Already installed: $target"
} else {
  $dl = Join-Path $env:TEMP ('android-clt-' + [guid]::NewGuid())
  New-Item -ItemType Directory $dl | Out-Null
  $zip = Join-Path $dl 'clt.zip'
  Write-Host 'Downloading (about 155 MB) ...'
  & curl.exe -fL --progress-bar -o $zip $url
  if ($LASTEXITCODE -ne 0) { throw "download failed ($LASTEXITCODE)" }
  $h = (Get-FileHash $zip -Algorithm SHA1).Hash.ToLower()
  if ($h -ne $sha1) { throw "checksum mismatch: $h" }
  Write-Host 'Checksum OK, extracting ...'
  Expand-Archive $zip (Join-Path $dl 'x')
  New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
  if (Test-Path $target) { Remove-Item -Recurse -Force $target }
  Move-Item (Join-Path $dl 'x\cmdline-tools') $target
  Remove-Item -Recurse -Force $dl
}

[Environment]::SetEnvironmentVariable('ANDROID_HOME', $sdk, 'User')
$p = [Environment]::GetEnvironmentVariable('Path', 'User')
$add = @((Join-Path $target 'bin'), (Join-Path $sdk 'platform-tools')) | Where-Object { $p -notlike "*$_*" }
if ($add) { [Environment]::SetEnvironmentVariable('Path', ((@($p.TrimEnd(';')) + $add) -join ';'), 'User') }

Write-Host "ANDROID_HOME = $sdk"
Write-Host ('JAVA_HOME    = ' + [Environment]::GetEnvironmentVariable('JAVA_HOME', 'Machine'))
Write-Host ('sdkmanager   = ' + (Test-Path (Join-Path $target 'bin\sdkmanager.bat')))
Write-Host 'Done. Open a new terminal so the variables apply.'
