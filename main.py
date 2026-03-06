from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from pydantic import BaseModel
import uuid
import os
import subprocess
from scanner import ScanSession, SessionState

def detect_scanner() -> tuple[bool, str | None]:
    """
    Detect available scanner using scanimage -L.
    Returns (found, device_name) where device_name is the scanner model if found.
    """
    scanner_name = os.getenv('SCANNER_NAME')
    
    try:
        result = subprocess.run(
            ["scanimage", "-L"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            # Parse output to find scanner
            for line in result.stdout.split('\n'):
                if 'device' in line and 'is a' in line:
                    # Format: "device `brother5:bus6;dev3' is a Brother DS-640 USB scanner"
                    # Extract device name between backticks
                    device_start = line.find('`')
                    device_end = line.find("'", device_start + 1)
                    if device_start != -1 and device_end != -1:
                        device = line[device_start + 1:device_end]
                        
                        # Extract scanner model name
                        model_start = line.find('is a ') + 5
                        model = line[model_start:].strip()
                        
                        if scanner_name:
                            # If we have a specific scanner name, match it
                            if scanner_name.lower() in line.lower():
                                return True, model
                        else:
                            # No specific name, return first Brother scanner
                            if 'brother' in line.lower():
                                return True, model
    except Exception:
        pass
    return False, None

app = FastAPI(title="Brother Scanner API", version="1.0.0")

@app.on_event("startup")
def startup_event():
    """Print scanner detection status on application startup."""
    found, model = detect_scanner()
    if found:
        print(f"Scanner found: {model}")
    else:
        print("No scanner found")

# In-memory session store
sessions: dict[str, ScanSession] = {}


# --- Models ---

class StartScanResponse(BaseModel):
    session_id: str
    message: str


class SessionStatusResponse(BaseModel):
    session_id: str
    state: str
    pages_scanned: int
    error: str | None = None


class FinishScanResponse(BaseModel):
    session_id: str
    total_pages: int
    message: str
    output_file: str


class CancelScanResponse(BaseModel):
    session_id: str
    message: str


# --- Routes ---

@app.post("/scan/start", response_model=StartScanResponse, status_code=201)
def start_scan(background_tasks: BackgroundTasks):
    """
    Start a new scanning session.
    Immediately begins a scan loop:
      - Scans a page every 2 seconds
      - Automatically finishes after 20 seconds of no new pages
    Returns a session_id to use for finish/cancel/status/download.
    """
    session_id = str(uuid.uuid4())
    session = ScanSession(session_id)
    sessions[session_id] = session

    background_tasks.add_task(session.run_scan_loop)

    return StartScanResponse(
        session_id=session_id,
        message=(
            "Scan loop started. Place pages on the scanner. "
            "The session will auto-finish after 20s of no new pages. "
            "Call POST /scan/{session_id}/finish to stop and generate PDF immediately, "
            "or POST /scan/{session_id}/cancel to abort."
        ),
    )


@app.post("/scan/{session_id}/finish", response_model=FinishScanResponse)
def finish_scan(session_id: str):
    """
    Stop the scan loop immediately and start PDF generation.
    Works only while state is 'scanning'.
    """
    session = _get_session(session_id)

    if session.state == SessionState.FINISHED:
        raise HTTPException(status_code=400, detail="Session is already finished.")
    if session.state == SessionState.PROCESSING:
        raise HTTPException(status_code=409, detail="PDF generation already in progress.")
    if session.state == SessionState.CANCELLED:
        raise HTTPException(status_code=400, detail="Session has been cancelled.")
    if session.state == SessionState.ERROR:
        raise HTTPException(status_code=400, detail=f"Session errored: {session.error}")
    if session.pages_scanned == 0:
        raise HTTPException(status_code=400, detail="No pages have been scanned yet.")

    session.request_finish()

    return FinishScanResponse(
        session_id=session_id,
        total_pages=session.pages_scanned,
        message="Scan loop stopped. PDF generation started in background. Poll GET /scan/{session_id}/status.",
        output_file=session.output_pdf_path,
    )


@app.post("/scan/{session_id}/cancel", response_model=CancelScanResponse)
def cancel_scan(session_id: str):
    """
    Cancel the scan session immediately.
    Stops the scan loop and discards all scanned pages. No PDF is generated.
    """
    session = _get_session(session_id)

    if session.state in (SessionState.FINISHED, SessionState.PROCESSING):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel: session is already in state '{session.state.value}'.",
        )
    if session.state == SessionState.CANCELLED:
        raise HTTPException(status_code=400, detail="Session is already cancelled.")

    session.request_cancel()

    return CancelScanResponse(
        session_id=session_id,
        message="Session cancelled. All temporary files have been discarded.",
    )


@app.get("/scan/{session_id}/status", response_model=SessionStatusResponse)
def get_status(session_id: str):
    """
    Get the current state of a scan session.
    States: scanning | processing | finished | cancelled | error
    """
    session = _get_session(session_id)
    return SessionStatusResponse(
        session_id=session_id,
        state=session.state.value,
        pages_scanned=session.pages_scanned,
        error=session.error,
    )


@app.get("/scan/{session_id}/download")
def download_pdf(session_id: str):
    """
    Download the finished PDF once state is 'finished'.
    """
    session = _get_session(session_id)

    if session.state != SessionState.FINISHED:
        raise HTTPException(
            status_code=400,
            detail=f"PDF not ready yet. Current state: {session.state.value}",
        )
    if not os.path.exists(session.output_pdf_path):
        raise HTTPException(status_code=404, detail="PDF file not found on disk.")

    return FileResponse(
        path=session.output_pdf_path,
        media_type="application/pdf",
        filename=f"scan_{session_id}.pdf",
    )


@app.delete("/scan/{session_id}")
def delete_session(session_id: str):
    """
    Delete a session and clean up all temporary files.
    """
    session = _get_session(session_id)
    session.cleanup()
    del sessions[session_id]
    return {"message": f"Session {session_id} deleted and files cleaned up."}


# --- Helpers ---

def _get_session(session_id: str) -> ScanSession:
    session = sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")
    return session