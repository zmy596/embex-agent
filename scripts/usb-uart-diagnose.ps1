param(
  [switch]$Summary
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$markers = @(
  "CH343",
  "CH340",
  "CH341",
  "CP210",
  "Silicon Labs",
  "USB Serial",
  "USB-SERIAL",
  "UART",
  "Espressif",
  "WCH"
)

function Convert-Device($device) {
  $text = @(
    $device.FriendlyName,
    $device.InstanceId,
    $device.Manufacturer,
    $device.Class,
    $device.Status
  ) -join " "
  $isBluetooth = $text -match "BTHENUM|Bluetooth|蓝牙"
  $isCandidate = -not $isBluetooth
  if ($isCandidate) {
    $isCandidate = $false
    foreach ($marker in $markers) {
      if ($text -match [regex]::Escape($marker)) {
        $isCandidate = $true
        break
      }
    }
  }
  [PSCustomObject]@{
    friendly_name = $device.FriendlyName
    instance_id = $device.InstanceId
    class = $device.Class
    status = $device.Status
    manufacturer = $device.Manufacturer
    is_bluetooth = $isBluetooth
    is_usb_uart_candidate = $isCandidate
  }
}

$devices = @()
foreach ($class in @("Ports", "USB")) {
  try {
    $devices += Get-PnpDevice -Class $class -ErrorAction Stop | ForEach-Object { Convert-Device $_ }
  } catch {
    $devices += @()
  }
}

$devices = $devices | Sort-Object friendly_name, instance_id -Unique
$candidates = @($devices | Where-Object { $_.is_usb_uart_candidate })
$problemDevices = @($devices | Where-Object {
  $_.status -and
  $_.status -notin @("OK", "Unknown") -and
  -not $_.is_usb_uart_candidate
})

$result = [PSCustomObject]@{
  success = $true
  usb_uart_ready = $candidates.Count -gt 0
  candidate_count = $candidates.Count
  candidates = $candidates
  problem_devices = $problemDevices
  devices = $devices
  next_step = if ($candidates.Count -gt 0) {
    "USB-UART candidate found in Windows PnP. If pyserial does not list it, reconnect the board or reinstall the WCH/CP210x driver, then use the matching COM port in Web or hardware:run."
  } elseif ($problemDevices.Count -gt 0) {
    "A USB/Ports device is present but not OK. Install or repair CH343/CH340/CP210x driver, then reconnect the board."
  } else {
    "No USB-UART candidate found. Check USB data cable, board power, driver installation, and Device Manager."
  }
}

if ($Summary) {
  [PSCustomObject]@{
    success = $result.success
    usb_uart_ready = $result.usb_uart_ready
    candidate_count = $result.candidate_count
    candidates = $result.candidates
    problem_devices = $result.problem_devices
    next_step = $result.next_step
  } | ConvertTo-Json -Depth 6
} else {
  $result | ConvertTo-Json -Depth 6
}
