# Use Python slim image as base
FROM python:3.14-slim

# Set working directory
WORKDIR /app

# Install system dependencies for scanning and PDF processing
RUN apt-get update && apt-get install -y \
    sane-utils \
    ocrmypdf \
    img2pdf \
    wget \
    && rm -rf /var/lib/apt/lists/*

RUN wget https://download.brother.com/welcome/dlf104033/brscan5-1.5.1-0.amd64.deb --progress=dot:giga -O /tmp/brscan5.deb && \
    dpkg -i --force-all /tmp/brscan5.deb

# Set environment variables for scanner configuration
ENV SCANNER_DEVICE=""
ENV SCANNER_NAME=""
ENV SCANNER_RESOLUTION=300
ENV SCANNER_TARGET_DIR=/app/scans

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY ./app .

# Create the default scan output directory
RUN mkdir -p /app/scans

# Expose port 8000 for the API
EXPOSE 8000

# Run the FastAPI application with uvicorn
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
