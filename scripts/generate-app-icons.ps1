param([ValidateSet('All', 'Windows', 'iOS')][string]$Target = 'All')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$masterPath = Join-Path $repositoryRoot 'extension/branding/spiderweb-master.png'
$sourceImage = [System.Drawing.Image]::FromFile($masterPath)

function Get-IconPng([int]$Size, [bool]$Opaque = $false) {
    $format = if ($Opaque) { [System.Drawing.Imaging.PixelFormat]::Format24bppRgb } else { [System.Drawing.Imaging.PixelFormat]::Format32bppArgb }
    $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, $format)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $attributes = [System.Drawing.Imaging.ImageAttributes]::new()
    $stream = [System.IO.MemoryStream]::new()
    try {
        $background = if ($Opaque) { [System.Drawing.Color]::FromArgb(6, 22, 81) } else { [System.Drawing.Color]::Transparent }
        $graphics.Clear($background)
        $graphics.CompositingMode = if ($Opaque) { [System.Drawing.Drawing2D.CompositingMode]::SourceOver } else { [System.Drawing.Drawing2D.CompositingMode]::SourceCopy }
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
        $graphics.DrawImage($sourceImage, [System.Drawing.Rectangle]::new(0, 0, $Size, $Size), 0, 0, $sourceImage.Width, $sourceImage.Height, [System.Drawing.GraphicsUnit]::Pixel, $attributes)
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        return ,$stream.ToArray()
    } finally {
        $stream.Dispose()
        $attributes.Dispose()
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

try {
    if ($Target -in @('All', 'Windows')) {
        $buildDirectory = Join-Path $repositoryRoot 'windows/build'
        $uiDirectory = Join-Path $repositoryRoot 'windows/src/ui/assets'
        New-Item -ItemType Directory -Path $buildDirectory, $uiDirectory -Force | Out-Null
        $sizes = @(16, 24, 32, 48, 64, 128, 256)
        $images = @($sizes | ForEach-Object { ,(Get-IconPng $_) })
        $stream = [System.IO.File]::Create((Join-Path $buildDirectory 'spiderweb.ico'))
        $writer = [System.IO.BinaryWriter]::new($stream)
        try {
            $writer.Write([uint16]0)
            $writer.Write([uint16]1)
            $writer.Write([uint16]$sizes.Count)
            $offset = 6 + 16 * $sizes.Count
            for ($index = 0; $index -lt $sizes.Count; $index++) {
                $dimension = if ($sizes[$index] -eq 256) { 0 } else { $sizes[$index] }
                $writer.Write([byte]$dimension)
                $writer.Write([byte]$dimension)
                $writer.Write([byte]0)
                $writer.Write([byte]0)
                $writer.Write([uint16]1)
                $writer.Write([uint16]32)
                $writer.Write([uint32]$images[$index].Length)
                $writer.Write([uint32]$offset)
                $offset += $images[$index].Length
            }
            foreach ($image in $images) { $writer.Write([byte[]]$image) }
        } finally { $writer.Dispose(); $stream.Dispose() }
        [System.IO.File]::WriteAllBytes((Join-Path $buildDirectory 'spiderweb.png'), $images[-1])
        [System.IO.File]::WriteAllBytes((Join-Path $uiDirectory 'spiderweb.png'), $images[-1])
        Write-Output 'Windows: ICO (16/24/32/48/64/128/256) and UI PNG exported.'
    }
    if ($Target -in @('All', 'iOS')) {
        $catalog = Join-Path $repositoryRoot 'ios/ios/App/Assets.xcassets/AppIcon.appiconset'
        $uiDirectory = Join-Path $repositoryRoot 'ios/src/assets'
        New-Item -ItemType Directory -Path $catalog, $uiDirectory -Force | Out-Null
        foreach ($size in @(40, 58, 60, 80, 87, 120, 180, 1024)) {
            [System.IO.File]::WriteAllBytes((Join-Path $catalog "spiderweb$size.png"), (Get-IconPng $size $true))
        }
        [System.IO.File]::WriteAllBytes((Join-Path $uiDirectory 'spiderweb.png'), (Get-IconPng 256))
        Write-Output 'iOS: opaque RGB AppIcon sizes and UI PNG exported.'
    }
} finally { $sourceImage.Dispose() }
