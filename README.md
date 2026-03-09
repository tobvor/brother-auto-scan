# Brother Scanner API

A FastAPI REST API to scan documents with a Brother printer via `scanimage`,
auto-collecting pages in a loop, then generating a PDF/A with `img2pdf` and `ocrmypdf`.

## Setup

Build the container:

```bash
docker build -t brother-auto-scan .
# or with podman
podman build -t brother-auto-scan .
```

#### Option 1: Using docker-compose (recommended for easy management)

Create a `compose.yml` file (already included in the repository) and run:

```bash
# Install podman-compose if not available: pip install podman-compose
docker compose up -d
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
docker run -d --name brother-auto-scan -p 8000:8000 \
  --device /dev/bus/usb/006/009 \
  -v ./scans:/app/scans \
  brother-auto-scan

# Option 2: Pass entire USB bus (convenient, grants access to all USB devices)
docker run -d --name brother-auto-scan -p 8000:8000 \
  --device /dev/bus/usb \
  -v ./scans:/app/scans \
  brother-auto-scan

# or with podman
podman run -d --name brother-auto-scan -p 8000:8000 \
  --device /dev/bus/usb \
  -v ./scans:/app/scans \
  brother-auto-scan

# Override scanner device (if auto-detection doesn't work)
docker run -d --name brother-auto-scan -p 8000:8000 \
  --device /dev/bus/usb \
  -v ./scans:/app/scans \
  -e SCANNER_NAME="Brother DS-640 USB" \
  -e SCANNER_RESOLUTION="300" \
  brother-auto-scan

# Alternative: Run with privileged access (less secure but grants all device access)
docker run -d --name brother-auto-scan -p 8000:8000 \
  -v ./scans:/app/scans \
  --privileged brother-auto-scan
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

## Web GUI

This project includes a minimal web GUI. The GUI is served by the same FastAPI container and talks to the existing `/scan/*` endpoints.

- When **GUI is enabled**, opening `http://localhost:8000/` shows:
  - A full-screen gradient background.
  - A single round **Start scan** button in the center.
  - When scanning/processing, the button displays the current status and page count; a **Cancel** button appears underneath.
  - When finished, you can **download the PDF** and **reset** the session.

### Running with GUI

- Docker:

```bash
docker run -d --name brother-auto-scan -p 8000:8000 \
  --device /dev/bus/usb \
  -v ./scans:/app/scans \
  -e ENABLE_GUI=true \
  brother-auto-scan
```

- docker-compose (default in this repo):

```bash
docker compose up -d
```

The service exposes both the API (`/scan/...`) and the GUI at `/`.

### Running without GUI (headless API only)

To disable the GUI and run the container in **headless mode**, set `ENABLE_GUI=false`. In this mode the API behaves as before and no frontend is mounted.

- Docker:

```bash
docker run -d --name brother-auto-scan -p 8000:8000 \
  --device /dev/bus/usb \
  -v ./scans:/app/scans \
  -e ENABLE_GUI=false \
  brother-auto-scan
```

- docker-compose override:

```bash
ENABLE_GUI=false docker compose up -d
```

In both cases, use the same API endpoints described above; only the web GUI at `/` is disabled.