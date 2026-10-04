$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'design\icon-source.jpg'
$outDir = Join-Path $root 'src\icons'
$img = [System.Drawing.Bitmap]::FromFile($source)

function Test-Dark($c) { return ($c.R + $c.G + $c.B) -lt 200 }
$midY = [int]($img.Height / 2); $midX = [int]($img.Width / 2)
$left = 0;  while (-not (Test-Dark $img.GetPixel($left, $midY))) { $left++ }
$right = $img.Width - 1;  while (-not (Test-Dark $img.GetPixel($right, $midY))) { $right-- }
$top = 0;   while (-not (Test-Dark $img.GetPixel($midX, $top))) { $top++ }
$bottom = $img.Height - 1; while (-not (Test-Dark $img.GetPixel($midX, $bottom))) { $bottom-- }
$inset = 4
$crop = New-Object System.Drawing.Rectangle ($left + $inset), ($top + $inset), ($right - $left - 2 * $inset), ($bottom - $top - 2 * $inset)
Write-Host "Artwork: $($crop.Width)x$($crop.Height) at $($crop.X),$($crop.Y)"

function New-RoundedPath([float]$x, [float]$y, [float]$size, [float]$radius) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $size - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $size - $d, $y + $size - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $size - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

foreach ($size in 16, 32, 48, 128) {
  $padding = if ($size -eq 128) { 8 } else { 0 }
  $art = $size - 2 * $padding
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $path = New-RoundedPath $padding $padding $art ([Math]::Max(2, $art * 0.12))
  $g.SetClip($path)
  $dest = New-Object System.Drawing.Rectangle $padding, $padding, $art, $art
  $g.DrawImage($img, $dest, $crop, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  $file = Join-Path $outDir "icon$size.png"
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host ("icon{0}.png  {1} bytes" -f $size, (Get-Item $file).Length)
}
$img.Dispose()
