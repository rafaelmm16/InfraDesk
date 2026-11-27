<#
.SYNOPSIS
    InfraDesk Active Directory & WinRM Fleet Collector (Idlewatch v2 Enterprise)

.DESCRIPTION
    Consulta Unidades Organizacionais (OUs) do Active Directory, coleta inventário de hardware
    e métricas de uso/ociosidade via CIM/WinRM e sincroniza diretamente com a API REST do InfraDesk.

.PARAMETER ApiUrl
    URL base do servidor InfraDesk (ex: http://localhost:3333)

.PARAMETER AgentKey
    Chave de autenticação X-Agent-Key configurada no backend

.PARAMETER SearchBaseOU
    Distinguished Name da OU no Active Directory (ex: "OU=Workstations,DC=corp,DC=local")

.EXAMPLE
    .\Collect-ADEndpoints.ps1 -ApiUrl "http://localhost:3333" -SearchBaseOU "OU=Financeiro,DC=corp,DC=local" -Department "Financeiro"
#>

param(
    [Parameter(Mandatory = $false)]
    [string]$ApiUrl = "http://localhost:3333",

    [Parameter(Mandatory = $false)]
    [string]$AgentKey = "idk_live_agent_9f8e7d6c5b4a",

    [Parameter(Mandatory = $true)]
    [string]$SearchBaseOU,

    [Parameter(Mandatory = $false)]
    [string]$Department = "Operações Corporativas",

    [Parameter(Mandatory = $false)]
    [string]$DomainName = $env:USERDNSDOMAIN
)

$ErrorActionPreference = "Stop"

if (-not (Get-Module -ListAvailable -Name ActiveDirectory)) {
    Write-Error "Módulo RSAT ActiveDirectory não encontrado neste host."
    exit 1
}

Import-Module ActiveDirectory

Write-Host "[InfraDesk AD Sync] Consultando computadores em: $SearchBaseOU ..." -ForegroundColor Cyan
$adComputers = Get-ADComputer -SearchBase $SearchBaseOU -Filter 'Enabled -eq $true' -Properties IPv4Address, OperatingSystem, OperatingSystemVersion, DistinguishedName

$headers = @{
    "Content-Type" = "application/json"
    "X-Agent-Key"  = $AgentKey
}

foreach ($comp in $adComputers) {
    $hostname = $comp.Name.ToUpper()
    if (-not (Test-Connection -ComputerName $hostname -Count 1 -Quiet)) {
        Write-Warning "[$hostname] Host inacessível na rede. Ignorando coleta WinRM."
        continue
    }

    try {
        $metrics = Invoke-Command -ComputerName $hostname -ScriptBlock {
            $cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
            $cpuName = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name
            $os = Get-CimInstance Win32_OperatingSystem
            $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
            $cs = Get-CimInstance Win32_ComputerSystem

            $ramTotalGb = [math]::Round($os.TotalVisibleMemorySize / 1MB, 0)
            $ramUsedPct = [math]::Round((($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / $os.TotalVisibleMemorySize) * 100, 1)
            $diskTotalGb = [math]::Round($disk.Size / 1GB, 0)
            $diskUsedPct = [math]::Round((($disk.Size - $disk.FreeSpace) / $disk.Size) * 100, 1)
            $uptimeHours = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 1)
            $procs = Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 4 -ExpandProperty ProcessName

            return @{
                cpuModel     = $cpuName
                cpuPercent   = [double]$cpu
                ramTotalGb   = [int]$ramTotalGb
                ramPercent   = [double]$ramUsedPct
                diskTotalGb  = [int]$diskTotalGb
                diskPercent  = [double]$diskUsedPct
                uptimeHours  = [double]$uptimeHours
                loggedUser   = if ($cs.UserName) { $cs.UserName } else { "Nenhum" }
                topProcesses = @($procs)
            }
        }

        $payload = @{
            hostname     = $hostname
            domain       = if ($DomainName) { $DomainName.ToLower() } else { "corp.local" }
            adOu         = $SearchBaseOU
            department   = $Department
            ipAddress    = if ($comp.IPv4Address) { $comp.IPv4Address } else { "0.0.0.0" }
            osName       = if ($comp.OperatingSystem) { $comp.OperatingSystem } else { "Windows Pro" }
            osVersion    = if ($comp.OperatingSystemVersion) { $comp.OperatingSystemVersion } else { "22H2" }
            cpuModel     = $metrics.cpuModel
            ramTotalGb   = $metrics.ramTotalGb
            diskTotalGb  = $metrics.diskTotalGb
            cpuPercent   = $metrics.cpuPercent
            ramPercent   = $metrics.ramPercent
            diskPercent  = $metrics.diskPercent
            idleMinutes  = 0
            uptimeHours  = $metrics.uptimeHours
            loggedUser   = $metrics.loggedUser
            topProcesses = $metrics.topProcesses
            agentVersion = "2.1.0-ps"
        } | ConvertTo-Json -Depth 4

        Invoke-RestMethod -Uri "$($ApiUrl.TrimEnd('/'))/api/telemetry/ingest" -Method Post -Headers $headers -Body $payload | Out-Null
        Write-Host "[$hostname] Sincronizado com sucesso (CPU: $($metrics.cpuPercent)% | RAM: $($metrics.ramPercent)%)" -ForegroundColor Green
    }
    catch {
        Write-Warning "[$hostname] Erro na coleta WinRM: $($_.Exception.Message)"
    }
}
