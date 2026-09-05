$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = Join-Path $projectRoot "apps\workspace"
$fixedServerPath = Join-Path $projectRoot "bin\mediago-server-fixed.exe"
$standardServerPath = Join-Path $projectRoot "bin\mediago-server.exe"
$serverPath = if (Test-Path -LiteralPath $fixedServerPath) { $fixedServerPath } else { $standardServerPath }
$serverConfig = Join-Path $projectRoot "services\server\configs\server.yaml"
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodePath = if ($null -ne $nodeCommand) { $nodeCommand.Source } else { "" }
$vitePath = Join-Path $workspaceRoot "node_modules\vite\bin\vite.js"
$electronPath = Join-Path $workspaceRoot "node_modules\electron\dist\electron.exe"
$electronMain = Join-Path $workspaceRoot "electron\dist\main.js"
$agentBinDir = Join-Path $projectRoot "packages\vendor\dist"
$agentManifest = Join-Path $agentBinDir "codex\agent.json"
$agentExecutable = Join-Path $agentBinDir "codex\codex-acp.exe"
$apiOrigin = "http://127.0.0.1:8080"
$rendererOrigin = "http://127.0.0.1:31420"

function Test-CreateTGenEndpoint([string]$Uri) {
	try {
		Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 1 | Out-Null
		return $true
	} catch {
		return $false
	}
}

function Wait-CreateTGenEndpoint([string]$Uri, [int]$Attempts) {
	for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
		if (Test-CreateTGenEndpoint $Uri) {
			return $true
		}
		Start-Sleep -Milliseconds 500
	}
	return $false
}

function Show-CreateTGenError([string]$Message) {
	Add-Type -AssemblyName PresentationFramework
	[System.Windows.MessageBox]::Show(
		$Message,
		"Create T Gen startup failed",
		[System.Windows.MessageBoxButton]::OK,
		[System.Windows.MessageBoxImage]::Error
	) | Out-Null
}

try {
	foreach ($requiredPath in @($serverPath, $serverConfig, $nodePath, $vitePath, $electronPath, $electronMain, $agentManifest, $agentExecutable)) {
		if (-not (Test-Path -LiteralPath $requiredPath)) {
			throw "Missing startup file: $requiredPath"
		}
	}

	# Do not silently reuse an older backend left running by a previous build.
	# Only stop the listener after verifying that it is one of this project's servers.
	if (Test-CreateTGenEndpoint "$apiOrigin/api/v1/health") {
		$listener = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
		if ($null -ne $listener) {
			$listenerProcess = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
			$listenerPath = if ($null -ne $listenerProcess) { $listenerProcess.Path } else { "" }
			$knownServerPaths = @($fixedServerPath, $standardServerPath) | ForEach-Object { [System.IO.Path]::GetFullPath($_) }
			if ($listenerPath -and $knownServerPaths -contains [System.IO.Path]::GetFullPath($listenerPath)) {
				Stop-Process -Id $listener.OwningProcess -Force
				for ($attempt = 0; $attempt -lt 20; $attempt++) {
					if (-not (Test-CreateTGenEndpoint "$apiOrigin/api/v1/health")) { break }
					Start-Sleep -Milliseconds 250
				}
			}
		}
	}

	if (-not (Test-CreateTGenEndpoint "$apiOrigin/api/v1/health")) {
		$previousAgentID = $env:MEDIAGO_AGENT_ID
		$previousAgentBinDir = $env:MEDIAGO_AGENT_BIN_DIR
		$env:MEDIAGO_AGENT_ID = "codex"
		$env:MEDIAGO_AGENT_BIN_DIR = $agentBinDir
		$serverStart = @{
			FilePath = $serverPath
			ArgumentList = @("--config", $serverConfig)
			WorkingDirectory = $projectRoot
			WindowStyle = "Hidden"
		}
		try {
			Start-Process @serverStart | Out-Null
		} finally {
			$env:MEDIAGO_AGENT_ID = $previousAgentID
			$env:MEDIAGO_AGENT_BIN_DIR = $previousAgentBinDir
		}
		if (-not (Wait-CreateTGenEndpoint "$apiOrigin/api/v1/health" 40)) {
			throw "The backend could not start on port 8080."
		}
	}

	if (-not (Test-CreateTGenEndpoint $rendererOrigin)) {
		$previousProxyTarget = $env:VITE_API_PROXY_TARGET
		$previousServerPort = $env:VITE_MEDIAGO_SERVER_PORT
		try {
			$env:VITE_API_PROXY_TARGET = $apiOrigin
			$env:VITE_MEDIAGO_SERVER_PORT = "8080"
			$viteStart = @{
				FilePath = $nodePath
				ArgumentList = @($vitePath, "--host", "127.0.0.1", "--port", "31420", "--strictPort")
				WorkingDirectory = $workspaceRoot
				WindowStyle = "Hidden"
			}
			Start-Process @viteStart | Out-Null
		} finally {
			$env:VITE_API_PROXY_TARGET = $previousProxyTarget
			$env:VITE_MEDIAGO_SERVER_PORT = $previousServerPort
		}
		if (-not (Wait-CreateTGenEndpoint $rendererOrigin 40)) {
			throw "The UI service could not start on port 31420."
		}
	}

	$previousRendererURL = $env:ELECTRON_RENDERER_URL
	$previousElectronPort = $env:MEDIAGO_SERVER_PORT
	try {
		$env:ELECTRON_RENDERER_URL = $rendererOrigin
		$env:MEDIAGO_SERVER_PORT = "8080"
		$electronStart = @{
			FilePath = $electronPath
			ArgumentList = @($electronMain)
			WorkingDirectory = $workspaceRoot
			WindowStyle = "Normal"
		}
		Start-Process @electronStart | Out-Null
	} finally {
		$env:ELECTRON_RENDERER_URL = $previousRendererURL
		$env:MEDIAGO_SERVER_PORT = $previousElectronPort
	}
} catch {
	Show-CreateTGenError $_.Exception.Message
	exit 1
}
