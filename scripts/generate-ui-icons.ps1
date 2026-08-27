Add-Type -AssemblyName System.Drawing

$root = Join-Path $PSScriptRoot '..\miniprogram\images'
$iconDir = Join-Path $root 'icons'
$tabDir = Join-Path $root 'tabbar'
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null

function New-IconCanvas([string]$name, [string]$color, [scriptblock]$draw, [string]$directory = $iconDir) {
  $size = 64
  $scale = $size / 24.0
  $bitmap = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml($color)), (1.9 * $scale)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

  function P([double]$value) { return [single]($value * $scale) }
  function Line([double]$x1,[double]$y1,[double]$x2,[double]$y2) { $graphics.DrawLine($pen,(P $x1),(P $y1),(P $x2),(P $y2)) }
  function Rect([double]$x,[double]$y,[double]$w,[double]$h) { $graphics.DrawRectangle($pen,(P $x),(P $y),(P $w),(P $h)) }
  function Ellipse([double]$x,[double]$y,[double]$w,[double]$h) { $graphics.DrawEllipse($pen,(P $x),(P $y),(P $w),(P $h)) }
  function Arc([double]$x,[double]$y,[double]$w,[double]$h,[double]$start,[double]$sweep) { $graphics.DrawArc($pen,(P $x),(P $y),(P $w),(P $h),$start,$sweep) }
  function Bezier([double]$x1,[double]$y1,[double]$x2,[double]$y2,[double]$x3,[double]$y3,[double]$x4,[double]$y4) { $graphics.DrawBezier($pen,(P $x1),(P $y1),(P $x2),(P $y2),(P $x3),(P $y3),(P $x4),(P $y4)) }
  function Poly([double[][]]$points) {
    $scaled = @($points | ForEach-Object { New-Object System.Drawing.PointF (P $_[0]), (P $_[1]) })
    $graphics.DrawLines($pen, $scaled)
  }

  & $draw
  $path = Join-Path $directory "$name.png"
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $pen.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

$navy = '#004165'
$maroon = '#772432'
$gray = '#667085'
$white = '#FFFFFF'
$danger = '#B42318'

$homeIcon = { Poly @((3,11),(12,3.5),(21,11)); Poly @((5,9.5),(5,21),(19,21),(19,9.5)); Poly @((9,21),(9,14),(15,14),(15,21)) }
$calendar = { Rect 3 5 18 16; Line 8 3 8 7; Line 16 3 16 7; Line 3 10 21 10; Line 7 14 9 14; Line 12 14 14 14; Line 17 14 19 14; Line 7 18 9 18; Line 12 18 14 18 }
$timer = { Ellipse 4 5 16 16; Line 12 9 12 13; Line 12 13 15 15; Line 9 2.5 15 2.5; Line 12 2.5 12 5; Line 18.5 5.5 20 4 }
$users = { Ellipse 8.5 4 7 7; Arc 5 12 14 10 190 160; Ellipse 2.5 7 5 5; Arc 1 13 8 7 190 140; Ellipse 16.5 7 5 5; Arc 15 13 8 7 210 140 }
$route = { Ellipse 3 3 4 4; Ellipse 17 17 4 4; Bezier 7 5 17 5 7 19 17 19; Line 17 5 20 5; Line 18.5 3.5 20 5; Line 18.5 6.5 20 5 }
$userPlus = { Ellipse 4 3 8 8; Arc 1 12 14 9 190 160; Line 18 8 18 16; Line 14 12 22 12 }
$edit = { Rect 4 4 12 16; Poly @((10,16),(10.5,12.5),(18.5,4.5),(21,7),(13,15),(10,16)); Line 8 8 13 8 }
$clipboard = { Rect 5 4 14 17; Rect 9 2.5 6 4; Poly @((8.5,14),(11,16.5),(16,11.5)) }
$template = { Rect 3 4 18 16; Line 3 9 21 9; Line 10 9 10 20; Line 14 13 18 13; Line 14 17 18 17 }
$plus = { Line 12 4 12 20; Line 4 12 20 12 }
$filter = { Poly @((3,5),(21,5),(14,12),(14,19),(10,21),(10,12),(3,5)) }
$trash = { Line 4 7 20 7; Line 9 3 15 3; Line 7 7 8 21; Line 17 7 16 21; Line 10 11 10.5 17; Line 14 11 13.5 17 }
$refresh = { Arc 4 4 16 16 35 285; Poly @((18,4),(20,9),(15,8)) }
$upload = { Line 12 16 12 4; Poly @((7,9),(12,4),(17,9)); Poly @((5,15),(5,20),(19,20),(19,15)) }
$eye = { Poly @((2.5,12),(6,8),(12,6),(18,8),(21.5,12),(18,16),(12,18),(6,16),(2.5,12)); Ellipse 9 9 6 6 }
$download = { Line 12 4 12 16; Poly @((7,11),(12,16),(17,11)); Poly @((5,19),(19,19)) }
$shield = { Poly @((12,3),(20,6),(19,15),(16,19),(12,21),(8,19),(5,15),(4,6),(12,3)); Poly @((8,12),(11,15),(16,9)) }
$save = { Rect 4 3 16 18; Rect 8 3 8 6; Rect 8 14 8 7 }
$close = { Line 5 5 19 19; Line 19 5 5 19 }

New-IconCanvas 'home' $gray $homeIcon $tabDir
New-IconCanvas 'home-active' $maroon $homeIcon $tabDir
New-IconCanvas 'parse' $gray $calendar $tabDir
New-IconCanvas 'parse-active' $maroon $calendar $tabDir

$icons = @{
  timer = $timer; users = $users; route = $route; 'user-plus' = $userPlus; edit = $edit;
  signup = $clipboard; template = $template; plus = $plus; filter = $filter; trash = $trash;
  refresh = $refresh; upload = $upload; eye = $eye; download = $download; shield = $shield;
  save = $save; close = $close
}
$icons.GetEnumerator() | ForEach-Object { New-IconCanvas $_.Key $navy $_.Value }
New-IconCanvas 'user-plus-white' $white $userPlus
New-IconCanvas 'edit-white' $white $edit
New-IconCanvas 'signup-white' $white $clipboard
New-IconCanvas 'template-maroon' $maroon $template
New-IconCanvas 'plus-white' $white $plus
New-IconCanvas 'eye-white' $white $eye
New-IconCanvas 'download-white' $white $download
New-IconCanvas 'save-white' $white $save
New-IconCanvas 'trash-danger' $danger $trash

Write-Output "Generated UI icons in $iconDir and $tabDir"
