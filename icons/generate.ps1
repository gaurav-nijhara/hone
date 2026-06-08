Add-Type -AssemblyName System.Drawing

function New-RoundedPath {
    param($Rect, [int]$R)
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $x = $Rect.X; $y = $Rect.Y; $w = $Rect.Width; $h = $Rect.Height
    $p.AddArc($x,          $y,          $R*2, $R*2, 180, 90)
    $p.AddArc($x+$w-$R*2,  $y,          $R*2, $R*2, 270, 90)
    $p.AddArc($x+$w-$R*2,  $y+$h-$R*2, $R*2, $R*2,   0, 90)
    $p.AddArc($x,          $y+$h-$R*2, $R*2, $R*2,  90, 90)
    $p.CloseFigure()
    return $p
}

function New-HoneIcon {
    param([int]$Size, [string]$Out)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    # ── Rounded background ────────────────────────────────────────────────
    $bgRect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
    $bgR    = [int]($Size * 0.20)
    $bgPath = New-RoundedPath -Rect $bgRect -R $bgR

    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Point(0, 0)),
        (New-Object System.Drawing.Point($Size, $Size)),
        [System.Drawing.Color]::FromArgb(255, 26, 28, 56),
        [System.Drawing.Color]::FromArgb(255, 14, 14, 28)
    )
    $g.FillPath($bgBrush, $bgPath)

    # ── H proportions ─────────────────────────────────────────────────────
    $pad   = [int]($Size * 0.215)
    $stemW = [int]($Size * 0.155)
    $stemH = $Size - 2 * $pad
    $cbH   = [int]($Size * 0.155)
    $cbY   = [int]($Size * 0.42)

    $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)

    # Left stem
    $g.FillRectangle($white, $pad, $pad, $stemW, $stemH)
    # Right stem
    $g.FillRectangle($white, ($Size - $pad - $stemW), $pad, $stemW, $stemH)
    # Crossbar
    $g.FillRectangle($white, $pad, $cbY, ($Size - 2*$pad), $cbH)

    # ── Indigo accent stripe (skip at 16 px — too fine to see) ───────────
    if ($Size -ge 32) {
        $accentH = [int]($cbH * 0.30)
        $accentY = $cbY + $cbH - $accentH

        $accentBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
            (New-Object System.Drawing.Point($pad, $accentY)),
            (New-Object System.Drawing.Point(($Size - $pad), $accentY)),
            [System.Drawing.Color]::FromArgb(0,   99, 102, 241),
            [System.Drawing.Color]::FromArgb(0,   99, 102, 241)
        )
        $blend = New-Object System.Drawing.Drawing2D.ColorBlend
        $blend.Colors = @(
            [System.Drawing.Color]::FromArgb(  0,  99, 102, 241),
            [System.Drawing.Color]::FromArgb(210,  99, 102, 241),
            [System.Drawing.Color]::FromArgb(240, 139, 142, 255),
            [System.Drawing.Color]::FromArgb(210,  99, 102, 241),
            [System.Drawing.Color]::FromArgb(  0,  99, 102, 241)
        )
        $blend.Positions = @(0.0, 0.2, 0.5, 0.8, 1.0)
        $accentBrush.InterpolationColors = $blend

        $g.FillRectangle($accentBrush, $pad, $accentY, ($Size - 2*$pad), $accentH)
    }

    $g.Dispose()
    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "  $Out  ($Size x $Size)"
}

Write-Host "Generating Hone icons..."
New-HoneIcon -Size 16  -Out "$PSScriptRoot\icon16.png"
New-HoneIcon -Size 48  -Out "$PSScriptRoot\icon48.png"
New-HoneIcon -Size 128 -Out "$PSScriptRoot\icon128.png"
Write-Host "Done."
