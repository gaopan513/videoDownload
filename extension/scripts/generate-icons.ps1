$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$extensionRoot = Split-Path -Parent $PSScriptRoot
$masterPath = Join-Path $extensionRoot 'branding/spiderweb-master.png'
$iconsDirectory = Join-Path $extensionRoot 'src/icons'
$sourceImage = [System.Drawing.Image]::FromFile($masterPath)

try {
    foreach ($size in @(16, 32, 48, 128)) {
        $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $imageAttributes = [System.Drawing.Imaging.ImageAttributes]::new()
        try {
            $graphics.Clear([System.Drawing.Color]::Transparent)
            $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
            $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $imageAttributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
            $destination = [System.Drawing.Rectangle]::new(0, 0, $size, $size)
            $graphics.DrawImage($sourceImage, $destination, 0, 0, $sourceImage.Width, $sourceImage.Height, [System.Drawing.GraphicsUnit]::Pixel, $imageAttributes)
            $outputPath = Join-Path $iconsDirectory "spiderweb$size.png"
            $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
            Write-Output $outputPath
        } finally {
            $imageAttributes.Dispose()
            $graphics.Dispose()
            $bitmap.Dispose()
        }
    }
} finally {
    $sourceImage.Dispose()
}
