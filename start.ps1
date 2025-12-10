# BreezeRun Start Script for Windows (PowerShell)
# This script sets up the environment and starts the services
# Run with: powershell -ExecutionPolicy Bypass -File start.ps1

param(
    [switch]$SkipDocker,
    [switch]$NoStart
)

$ErrorActionPreference = "Stop"

# Configuration
$PYTHON_VERSION = "3.12"
$NODE_VERSION = "20"

function Write-Header {
    Write-Host ""
    Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Blue
    Write-Host "║                    BreezeRun Setup                         ║" -ForegroundColor Blue
    Write-Host "║         Run your code like a breeze                        ║" -ForegroundColor Blue
    Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Blue
    Write-Host ""
}

function Write-Step {
    param([string]$Message)
    Write-Host "[STEP] " -ForegroundColor Green -NoNewline
    Write-Host $Message
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[WARNING] " -ForegroundColor Yellow -NoNewline
    Write-Host $Message
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] " -ForegroundColor Red -NoNewline
    Write-Host $Message
}

function Write-Success {
    param([string]$Message)
    Write-Host "[SUCCESS] " -ForegroundColor Green -NoNewline
    Write-Host $Message
}

function Test-Command {
    param([string]$Command)
    $null = Get-Command $Command -ErrorAction SilentlyContinue
    return $?
}

function Install-Chocolatey {
    if (-not (Test-Command "choco")) {
        Write-Step "Installing Chocolatey..."
        Set-ExecutionPolicy Bypass -Scope Process -Force
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
        Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    }
}

function Install-Python {
    Write-Step "Checking Python installation..."

    if (Test-Command "python") {
        $pythonVersion = python --version 2>&1
        if ($pythonVersion -match "3\.(11|12|13)") {
            Write-Success "Python is installed: $pythonVersion"
            return
        }
    }

    Write-Step "Installing Python $PYTHON_VERSION..."
    choco install python --version=$PYTHON_VERSION -y

    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}

function Install-NodeJS {
    Write-Step "Checking Node.js installation..."

    if (Test-Command "node") {
        $nodeVersion = node --version
        $majorVersion = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
        if ($majorVersion -ge 18) {
            Write-Success "Node.js is installed: $nodeVersion"
            return
        }
    }

    Write-Step "Installing Node.js $NODE_VERSION..."
    choco install nodejs-lts -y

    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}

function Install-Docker {
    Write-Step "Checking Docker installation..."

    if (Test-Command "docker") {
        Write-Success "Docker is installed"
        return
    }

    Write-Step "Installing Docker Desktop..."
    choco install docker-desktop -y

    Write-Warning "Please start Docker Desktop manually after installation"
    Write-Warning "You may need to restart your computer for Docker to work properly"
}

function Install-Poetry {
    Write-Step "Checking Poetry installation..."

    if (Test-Command "poetry") {
        Write-Success "Poetry is installed"
        return
    }

    Write-Step "Installing Poetry..."
    (Invoke-WebRequest -Uri https://install.python-poetry.org -UseBasicParsing).Content | python -

    # Add Poetry to PATH
    $poetryPath = "$env:APPDATA\Python\Scripts"
    if (Test-Path $poetryPath) {
        $env:Path += ";$poetryPath"
    }

    $poetryPath2 = "$env:LOCALAPPDATA\Programs\Python\Python313\Scripts"
    if (Test-Path $poetryPath2) {
        $env:Path += ";$poetryPath2"
    }
}

function Install-Git {
    Write-Step "Checking Git installation..."

    if (Test-Command "git") {
        Write-Success "Git is installed"
        return
    }

    Write-Step "Installing Git..."
    choco install git -y

    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}

function Setup-Backend {
    Write-Step "Setting up backend..."

    Push-Location backend

    try {
        # Install dependencies
        poetry install --with dev

        # Create .env if it doesn't exist
        if (-not (Test-Path ".env")) {
            Write-Step "Creating .env file..."

            # Generate encryption key
            $encryptionKey = python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

            if (Test-Path ".env.example") {
                Copy-Item ".env.example" ".env"
                $content = Get-Content ".env" -Raw
                if ($content -match "MASTER_ENCRYPTION_KEY=") {
                    $content = $content -replace "MASTER_ENCRYPTION_KEY=.*", "MASTER_ENCRYPTION_KEY=$encryptionKey"
                } else {
                    $content += "`nMASTER_ENCRYPTION_KEY=$encryptionKey"
                }
                Set-Content ".env" $content
            } else {
                @"
# BreezeRun Backend Configuration
DATABASE_URL=sqlite+aiosqlite:///./data/breezerun.db
HOST=127.0.0.1
PORT=8000
CORS_ORIGINS=http://localhost:3000,http://localhost:5173,http://localhost:5174
DOCKER_CONTAINER_POOL_SIZE=5
MASTER_ENCRYPTION_KEY=$encryptionKey
"@ | Set-Content ".env"
            }

            Write-Success ".env file created with encryption key"
        }

        # Create data directory
        if (-not (Test-Path "data")) {
            New-Item -ItemType Directory -Path "data" | Out-Null
        }
    }
    finally {
        Pop-Location
    }
}

function Setup-Frontend {
    Write-Step "Setting up frontend..."

    Push-Location frontend

    try {
        # Install dependencies
        npm install
    }
    finally {
        Pop-Location
    }
}

function Build-DockerImages {
    if ((Test-Command "docker") -and (docker info 2>&1 | Out-Null; $?)) {
        Write-Step "Building Docker sandbox images..."

        Push-Location "backend\app\core\sandbox\environments"

        try {
            # Build only the default Python image for quick setup
            if (Test-Path "python3.13.Dockerfile") {
                docker build -t breezerun-env-python3.13:latest -f python3.13.Dockerfile .
                if (-not $?) {
                    Write-Warning "Failed to build Python 3.13 image"
                }
            }
        }
        finally {
            Pop-Location
        }

        Write-Success "Docker images built"
    } else {
        Write-Warning "Docker is not running. Skipping Docker image build."
        Write-Warning "Start Docker Desktop and run: cd backend\app\core\sandbox\environments; .\build_images.ps1"
    }
}

function Test-Installation {
    Write-Step "Verifying installation..."

    $errors = 0

    if (-not (Test-Command "python")) {
        Write-Error "Python is not installed"
        $errors++
    }

    if (-not (Test-Command "node")) {
        Write-Error "Node.js is not installed"
        $errors++
    }

    if (-not (Test-Command "poetry")) {
        Write-Error "Poetry is not installed"
        $errors++
    }

    if (-not (Test-Command "docker")) {
        Write-Warning "Docker is not installed (optional but recommended)"
    }

    if ($errors -gt 0) {
        Write-Error "Installation verification failed with $errors errors"
        exit 1
    }

    Write-Success "All required dependencies are installed!"
}

function Write-Usage {
    Write-Host ""
    Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host "                    Setup Complete!                          " -ForegroundColor Green
    Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host ""
    Write-Host "To start BreezeRun:"
    Write-Host ""
    Write-Host "  1. Start the backend:"
    Write-Host "     cd backend"
    Write-Host "     poetry run python -m app.main"
    Write-Host ""
    Write-Host "  2. Start the frontend (in a new terminal):"
    Write-Host "     cd frontend"
    Write-Host "     npm run dev"
    Write-Host ""
    Write-Host "  3. Open http://localhost:5173 in your browser"
    Write-Host ""
    Write-Host "Optional: Build all Docker sandbox images:"
    Write-Host "     cd backend\app\core\sandbox\environments"
    Write-Host "     .\build_images.ps1"
    Write-Host ""
}

# Main
function Main {
    Write-Header

    # Get script directory
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    if ($scriptDir) {
        Set-Location $scriptDir
    }

    # Check for admin privileges (recommended for Chocolatey)
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Warning "Running without administrator privileges. Some installations may fail."
        Write-Warning "Consider running PowerShell as Administrator for best results."
    }

    Install-Chocolatey
    Install-Git
    Install-Python
    Install-NodeJS
    Install-Poetry

    if (-not $SkipDocker) {
        Install-Docker
    }

    Setup-Backend
    Setup-Frontend

    if (-not $SkipDocker) {
        Build-DockerImages
    }

    Test-Installation

    if ($NoStart) {
        Write-Usage
    } else {
        Start-Services
    }
}

function Start-Services {
    Write-Step "Starting BreezeRun services..."

    # Add Poetry to PATH
    $poetryPath = "$env:APPDATA\Python\Scripts"
    if (Test-Path $poetryPath) {
        $env:Path += ";$poetryPath"
    }

    # Get script directory
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    if (-not $scriptDir) {
        $scriptDir = Get-Location
    }

    # Start backend in a new window
    Write-Step "Starting backend server..."
    $backendJob = Start-Process -FilePath "powershell" -ArgumentList "-NoExit", "-Command", "cd '$scriptDir\backend'; poetry run python -m app.main" -PassThru

    # Wait for backend to be ready
    Write-Step "Waiting for backend to start..."
    $backendReady = $false
    for ($i = 1; $i -le 30; $i++) {
        Start-Sleep -Seconds 1
        try {
            $response = Invoke-WebRequest -Uri http://localhost:8000/ -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                Write-Success "Backend is running at http://localhost:8000"
                $backendReady = $true
                break
            }
        } catch {
            # Still waiting...
        }
    }

    # Start frontend in a new window
    Write-Step "Starting frontend server..."
    $frontendJob = Start-Process -FilePath "powershell" -ArgumentList "-NoExit", "-Command", "cd '$scriptDir\frontend'; npm run dev" -PassThru

    # Wait for frontend to be ready
    Write-Step "Waiting for frontend to start..."
    $frontendReady = $false
    for ($i = 1; $i -le 30; $i++) {
        Start-Sleep -Seconds 1
        try {
            $response = Invoke-WebRequest -Uri http://localhost:5173/ -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                Write-Success "Frontend is running at http://localhost:5173"
                $frontendReady = $true
                break
            }
        } catch {
            # Still waiting...
        }
    }

    Write-Host ""
    Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host "                BreezeRun is running!                        " -ForegroundColor Green
    Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Backend:  http://localhost:8000"
    Write-Host "  Frontend: http://localhost:5173"
    Write-Host ""
    Write-Host "  Close the terminal windows to stop the services"
    Write-Host ""

    # Open browser
    Start-Process "http://localhost:5173"
}

Main
