# Brother Scanner API

A FastAPI REST API to scan documents with a Brother printer via `scanimage`,
auto-collecting pages in a loop, then generating a PDF/A with `img2pdf` and `ocrmypdf`,
and saving to a target directory like the bash script.

## Prerequisites

```bash
# Debian/Ubuntu
sudo apt install sane-utils ocrmypdf img2pdf

# Find your scanner device name and update scanner.py
scanimage -L
# e.g. device `brother5:net1;dev0' is a Brother ...
```

## Setup

### Local Development

```bash
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Docker/Podman Container

Build the container:

```bash
docker build -t brother-scanner-api .
# or with podman
podman build -t brother-scanner-api .
```

#### Option 1: Using docker-compose (recommended for easy management)

Create a `docker-compose.yml` file (already included in the repository) and run:

```bash
# Install podman-compose if not available: pip install podman-compose
docker-compose up -d
# or with podman-compose
podman-compose up -d
```

This automatically handles USB device passthrough and volume mounting.

#### Option 2: Manual docker/podman run commands

```bash
# Find your scanner's USB bus/device (e.g., /dev/bus/usb/006/009)
lsusb | grep Brother
# Example: Bus 006 Device 009: ID 04f9:0468 Brother Industries, Ltd

# Option 1: Auto-detect mode with specific USB device (recommended for security)
docker run -d --name scanner-api -p 8000:8000 \
  --device /dev/bus/usb/006/009 \
  -v ~/Dokumente/Scans:/app/scans \
  brother-scanner-api

# Option 2: Pass entire USB bus (convenient, grants access to all USB devices)
docker run -d --name scanner-api -p 8000:8000 \
  --device /dev/bus/usb \
  -v ~/Dokumente/Scans:/app/scans \
  brother-scanner-api

# or with podman
podman run -d --name scanner-api -p 8000:8000 \
  --device /dev/bus/usb \
  -v ~/Dokumente/Scans:/app/scans \
  brother-scanner-api

# Override scanner device (if auto-detection doesn't work)
docker run -d --name scanner-api -p 8000:8000 \
  --device /dev/bus/usb \
  -v ~/Dokumente/Scans:/app/scans \
  -e SCANNER_NAME="Brother DS-640 USB" \
  -e SCANNER_RESOLUTION="300" \
  brother-scanner-api

# Alternative: Run with privileged access (less secure but grants all device access)
docker run -d --name scanner-api -p 8000:8000 \
  -v ~/Dokumente/Scans:/app/scans \
  --privileged brother-scanner-api
```

**Note**: 
- USB passthrough is required for the scanner to work inside the container. Use `--device /dev/bus/usb` to pass the entire USB bus (convenient) or `--device /dev/bus/usb/BUS/DEVICE` for specific device access (more secure).
- The container **automatically detects the Brother scanner** when the first scan is requested using `scanimage -L`.
- If auto-detection fails, you can manually set `SCANNER_DEVICE` or `SCANNER_NAME` environment variables.
- The container saves PDFs to `/app/scans` inside the container. Mount your desired host directory to this path.
- Optional environment variables: `SCANNER_DEVICE`, `SCANNER_NAME`, `SCANNER_RESOLUTION`, `SCANNER_TARGET_DIR`.

## Workflow

```
POST /scan/start
       │
       └─► background scan loop starts
              ├── scans a page every 2 seconds
              └── auto-finishes after 20s idle
                                   ↕
             POST /scan/{id}/finish    ← stop immediately + generate PDF
             POST /scan/{id}/cancel    ← stop immediately + discard everything
       │
       ↓
GET  /scan/{id}/status   ← poll until state == "finished"
GET  /scan/{id}/download ← download the PDF
DELETE /scan/{id}        ← clean up
```

## Session States

| State        | Meaning                                               |
|--------------|-------------------------------------------------------|
| `scanning`   | Scan loop is running, pages being collected           |
| `processing` | `ocrmypdf` is generating the PDF                      |
| `finished`   | PDF ready for download                                |
| `cancelled`  | Session was cancelled, all temp files deleted         |
| `error`      | Something went wrong — check `error` field in status  |

## Example

```bash
# 1. Start scanning (webhook trigger)
SESSION=$(curl -s -X POST http://localhost:8000/scan/start | jq -r .session_id)

# 2. Let pages scan automatically...

# 3a. Finish immediately when done
curl -X POST http://localhost:8000/scan/$SESSION/finish

# 3b. OR cancel everything
curl -X POST http://localhost:8000/scan/$SESSION/cancel

# 4. Poll until finished
curl http://localhost:8000/scan/$SESSION/status

# 5. Download
curl -OJ http://localhost:8000/scan/$SESSION/download

# 6. Clean up
curl -X DELETE http://localhost:8000/scan/$SESSION
```

## Swagger UI

Open http://localhost:8000/docs