$ErrorActionPreference = 'Stop'

$siteRepo = 'G:\m-lucifer.github.io'
$sourceRepo = 'G:\pretext-examples'
$targetDir = Join-Path $siteRepo 'inthemoodforlove-review'
$assetsDir = Join-Path $targetDir 'assets'
$vendorDir = Join-Path $targetDir 'vendor\pretext'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path $siteRepo)) {
  throw "Site repo not found: $siteRepo"
}

if (-not (Test-Path $sourceRepo)) {
  throw "Source repo not found: $sourceRepo"
}

New-Item -ItemType Directory -Force $targetDir | Out-Null
New-Item -ItemType Directory -Force $assetsDir | Out-Null
New-Item -ItemType Directory -Force $vendorDir | Out-Null

Copy-Item (Join-Path $sourceRepo 'examples\07-inthemoodforlove-review.html') (Join-Path $targetDir 'index.html') -Force
Copy-Item (Join-Path $sourceRepo 'examples\07-inthemoodforlove-review.js') (Join-Path $targetDir 'app.js') -Force
Copy-Item (Join-Path $sourceRepo 'examples\shared-wrap.js') (Join-Path $targetDir 'shared-wrap.js') -Force
Copy-Item (Join-Path $sourceRepo 'inthemoodforlove\*') $assetsDir -Force

$distSource = Join-Path $sourceRepo 'node_modules\@chenglou\pretext\dist'
Copy-Item (Join-Path $distSource '*.js') $vendorDir -Force

$indexPath = Join-Path $targetDir 'index.html'
$indexContent = [System.IO.File]::ReadAllText($indexPath, [System.Text.Encoding]::UTF8)
$indexContent = $indexContent.Replace('<a class="back" href="../index.html">Back to index</a>', '<a class="back" href="/">Home</a>')
$indexContent = $indexContent.Replace('<script type="module" src="./07-inthemoodforlove-review.js"></script>', '<script type="module" src="./app.js"></script>')
[System.IO.File]::WriteAllText($indexPath, $indexContent, $utf8NoBom)

$appPath = Join-Path $targetDir 'app.js'
$appContent = [System.IO.File]::ReadAllText($appPath, [System.Text.Encoding]::UTF8)
$appContent = $appContent.Replace("from '../node_modules/@chenglou/pretext/dist/layout.js'", "from './vendor/pretext/layout.js'")
$appContent = $appContent.Replace("const ASSET_ROOT = '../inthemoodforlove'", "const ASSET_ROOT = './assets'")
[System.IO.File]::WriteAllText($appPath, $appContent, $utf8NoBom)
