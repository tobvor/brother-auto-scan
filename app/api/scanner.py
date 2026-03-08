import os
import subprocess
import shutil
import tempfile
import time
import threading
from enum import Enum


# How often (seconds) to attempt scanning the next page.
# Can be configured via SCAN_INTERVAL_SECONDS environment variable, defaults to 2s.
SCAN_INTERVAL_SECONDS = int(os.getenv("SCAN_INTERVAL_SECONDS", "2"))

# Automatically finish after this many seconds without a successful new page.
# Can be configured via AUTO_FINISH_TIMEOUT_SECONDS environment variable, defaults to 20s.
AUTO_FINISH_TIMEOUT_SECONDS = int(os.getenv("AUTO_FINISH_TIMEOUT_SECONDS", "20"))

# Scanner parameters from bash script
SCANNER_NAME = os.getenv('SCANNER_NAME', 'Brother DS-640 USB')
RESOLUTION = int(os.getenv('SCANNER_RESOLUTION', '300'))  # DPI
TARGET_DIR = os.path.expanduser(os.getenv('SCANNER_TARGET_DIR', '/app/scans'))  # Paperless-Importverzeichnis


class SessionState(str, Enum):
    SCANNING = "scanning"
    PAUSED = "paused"
    PROCESSING = "processing"
    FINISHED = "finished"
    CANCELLED = "cancelled"
    ERROR = "error"


class ScanSession:
    def __init__(
        self,
        session_id: str,
        scan_interval_seconds: int = SCAN_INTERVAL_SECONDS,
        auto_finish_timeout_seconds: int = AUTO_FINISH_TIMEOUT_SECONDS,
    ):
        self.session_id = session_id
        self.state = SessionState.SCANNING
        self.pages_scanned = 0
        self.error: str | None = None

        # Per-session timing configuration
        self.scan_interval_seconds = scan_interval_seconds
        self.auto_finish_timeout_seconds = auto_finish_timeout_seconds

        # Threading events for external control
        self._finish_event = threading.Event()
        self._cancel_event = threading.Event()
        self._pause_event = threading.Event()

        # Create isolated working directory for this session
        self.work_dir = tempfile.mkdtemp(prefix=f"scan_{session_id}_")
        self.images_dir = os.path.join(self.work_dir, "input_images")
        os.makedirs(self.images_dir, exist_ok=True)

        # Use PNG format like the bash script
        self.output_pdf_path = os.path.join(self.work_dir, f"{session_id}.pdf")
        self.final_pdf_path = os.path.join(TARGET_DIR, f"{session_id}.pdf")

    # -------------------------------------------------------------------------
    # External control signals
    # -------------------------------------------------------------------------

    def request_finish(self) -> None:
        """Signal the scan loop to stop and generate the PDF."""
        self._finish_event.set()

    def request_cancel(self) -> None:
        """Signal the scan loop to stop and discard all work."""
        self._cancel_event.set()

    # -------------------------------------------------------------------------
    # Main scan loop (runs in background task)
    # -------------------------------------------------------------------------

    def run_scan_loop(self) -> None:
        """
        Continuously scan pages every self.scan_interval_seconds.
        Stops when:
          - finish is requested  → generates PDF
          - cancel is requested  → cleans up and exits
          - no new page is scanned within AUTO_FINISH_TIMEOUT_SECONDS → auto-finish
        """
        last_successful_scan_time = time.monotonic()

        while True:
            # --- Check cancel first (highest priority) ---
            if self._cancel_event.is_set():
                self.state = SessionState.CANCELLED
                self.cleanup()
                return

            # --- Check explicit finish request ---
            if self._finish_event.is_set():
                self._run_ocrmypdf()
                return

            # --- Handle pause/resume ---
            if self._pause_event.is_set():
                # Enter paused state and wait until resumed, cancelled, or finished
                if self.state != SessionState.PAUSED:
                    self.state = SessionState.PAUSED

                while self._pause_event.is_set():
                    # Allow cancel while paused
                    if self._cancel_event.is_set():
                        self.state = SessionState.CANCELLED
                        self.cleanup()
                        return

                    # Allow finish while paused
                    if self._finish_event.is_set():
                        self._run_ocrmypdf()
                        return

                    time.sleep(0.2)

                # On resume, start a fresh idle timeout window from now
                last_successful_scan_time = time.monotonic()

                # Resume scanning state if we were paused
                if self.state == SessionState.PAUSED:
                    self.state = SessionState.SCANNING

                # Continue main loop after resume
                continue

            # --- Auto-finish on idle timeout ---
            idle_seconds = time.monotonic() - last_successful_scan_time
            if idle_seconds >= self.auto_finish_timeout_seconds:
                if self.pages_scanned > 0:
                    self._run_ocrmypdf()
                else:
                    # Nothing was ever scanned — just cancel cleanly
                    self.state = SessionState.CANCELLED
                    self.cleanup()
                return

            # --- Attempt to scan a page ---
            scanned = self._scan_single_page()
            if scanned:
                last_successful_scan_time = time.monotonic()

            # --- Wait before next attempt, but respect control signals ---
            cancelled = self._cancel_event.wait(timeout=self.scan_interval_seconds)
            if cancelled:
                self.state = SessionState.CANCELLED
                self.cleanup()
                return

    # -------------------------------------------------------------------------
    # External pause/resume controls
    # -------------------------------------------------------------------------

    def request_pause(self) -> None:
        """Pause the scan loop without finishing PDF generation."""
        self._pause_event.set()
        if self.state == SessionState.SCANNING:
            self.state = SessionState.PAUSED

    def request_resume(self) -> None:
        """Resume the scan loop after a pause."""
        self._pause_event.clear()
        if self.state == SessionState.PAUSED:
            self.state = SessionState.SCANNING

    # -------------------------------------------------------------------------
    # Scanner device detection
    # -------------------------------------------------------------------------

    def _detect_scanner(self) -> str | None:
        """
        Auto-detect available scanner using scanimage -L.
        If SCANNER_NAME is set, find the device by name.
        Otherwise, return the first available Brother scanner.
        Returns the device string if found, None otherwise.
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
                            
                            if scanner_name:
                                # If we have a specific scanner name, match it
                                if scanner_name.lower() in line.lower():
                                    return device
                            else:
                                # No specific name, return first Brother scanner
                                if 'brother' in line.lower():
                                    return device
        except Exception:
            pass
        return None

    # -------------------------------------------------------------------------
    # scanimage
    # -------------------------------------------------------------------------

    def _scan_single_page(self) -> bool:
        """
        Scan one page via scanimage.
        Returns True if a page was scanned successfully, False otherwise.
        """
        page_number = self.pages_scanned + 1
        page_filename = os.path.join(
            self.images_dir, f"page_{page_number:03d}.png"
        )

        # Use device from environment, with fallback auto-detection
        scan_device = os.getenv('SCANNER_DEVICE')
        if not scan_device:
            # Fallback: try to auto-detect using name or first Brother scanner
            scan_device = self._detect_scanner()
            if not scan_device:
                return False

        try:
            # Run scanimage, redirect output to file
            with open(page_filename, 'wb') as f:
                result = subprocess.run(
                    ["scanimage", f"--device-name={scan_device}", "--resolution", str(RESOLUTION), "--format=png"],
                    stdout=f,
                    stderr=subprocess.DEVNULL,
                    timeout=15,  # single-page scan timeout
                )
        except subprocess.TimeoutExpired:
            # No paper / scanner busy — treat as no page available
            if os.path.exists(page_filename):
                os.remove(page_filename)
            return False

        if result.returncode != 0:
            # scanimage returns non-zero when no document is in the feeder —
            # this is normal; just means no page was ready yet.
            if os.path.exists(page_filename):
                os.remove(page_filename)
            return False

        # Check if the file has actual content (scanimage can succeed but output nothing)
        if os.path.getsize(page_filename) == 0:
            os.remove(page_filename)
            return False

        # Page scanned successfully
        self.pages_scanned += 1
        return True

    # -------------------------------------------------------------------------
    # ocrmypdf
    # -------------------------------------------------------------------------

    def _run_ocrmypdf(self) -> None:
        """Generate a PDF/A from all scanned page images using img2pdf and ocrmypdf pipeline."""
        self.state = SessionState.PROCESSING

        # Find all PNG files
        png_files = sorted([os.path.join(self.images_dir, f) for f in os.listdir(self.images_dir) if f.endswith('.png')])

        if not png_files:
            self.state = SessionState.ERROR
            self.error = "No PNG files found to process."
            return

        # Create temporary PDF file for img2pdf output
        temp_pdf_path = os.path.join(self.work_dir, "temp.pdf")

        # Use img2pdf to create PDF file, then ocrmypdf to process it
        cmd_img2pdf = ["img2pdf", "--output", temp_pdf_path] + png_files
        cmd_ocrmypdf = [
            "ocrmypdf",
            temp_pdf_path,  # read from file instead of stdin
            "--tesseract-timeout", "0",
            "--skip-text",
            "--deskew",
            "--clean",
            "--optimize", "1",
            "--output-type", "pdfa",
            self.output_pdf_path
        ]

        try:
            # Run img2pdf to create the PDF file
            img2pdf_result = subprocess.run(
                cmd_img2pdf,
                capture_output=True,
                text=True,
                timeout=60,  # 1-minute timeout for img2pdf
            )
            
            if img2pdf_result.returncode != 0:
                self.state = SessionState.ERROR
                self.error = (
                    f"img2pdf failed with return code {img2pdf_result.returncode}: "
                    f"{img2pdf_result.stderr.strip()}"
                )
                return
            
            # Now run ocrmypdf on the PDF file
            result = subprocess.run(
                cmd_ocrmypdf,
                capture_output=True,
                text=True,
                timeout=300,  # 5-minute timeout for ocrmypdf
            )

            if result.returncode != 0:
                self.state = SessionState.ERROR
                self.error = (
                    f"ocrmypdf failed with return code {result.returncode}: "
                    f"{result.stderr.strip()}"
                )
            else:
                # Move to target directory like the bash script
                os.makedirs(TARGET_DIR, exist_ok=True)
                shutil.move(self.output_pdf_path, self.final_pdf_path)
                self.output_pdf_path = self.final_pdf_path  # Update path for download
                self.state = SessionState.FINISHED
        except subprocess.TimeoutExpired:
            self.state = SessionState.ERROR
            self.error = "PDF generation timed out."
        except Exception as e:
            self.state = SessionState.ERROR
            self.error = str(e)
        finally:
            # Clean up temporary PDF file
            if os.path.exists(temp_pdf_path):
                os.remove(temp_pdf_path)

    # -------------------------------------------------------------------------
    # Cleanup
    # -------------------------------------------------------------------------

    def cleanup(self) -> None:
        """Remove the working directory and all its contents."""
        if os.path.exists(self.work_dir):
            shutil.rmtree(self.work_dir)