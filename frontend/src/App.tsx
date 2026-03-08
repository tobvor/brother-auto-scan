import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Group, RingProgress, Stack, Text, Title } from '@mantine/core'

type ScanState = 'idle' | 'scanning' | 'paused' | 'processing' | 'finished' | 'cancelled' | 'error'

type SessionStatusResponse = {
  session_id: string
  state: ScanState
  pages_scanned: number
  error?: string | null
}

type StartScanResponse = {
  session_id: string
  message: string
  timeout_seconds: number
}

type FinishScanResponse = {
  session_id: string
  total_pages: number
  message: string
  output_file: string
}

type CancelScanResponse = {
  session_id: string
  message: string
}

type PauseScanResponse = {
  session_id: string
  message: string
}

type ResumeScanResponse = {
  session_id: string
  message: string
}

const POLL_INTERVAL_MS = 1500

const DEFAULT_TIMEOUT_SECONDS = 20

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

async function startScan(): Promise<StartScanResponse> {
  const res = await fetch(`${API_BASE_URL}/scan/start`, {
    method: 'POST',
  })
  if (!res.ok) {
    throw new Error(`Failed to start scan: ${res.statusText}`)
  }
  return res.json()
}

async function getStatus(sessionId: string): Promise<SessionStatusResponse> {
  const res = await fetch(`${API_BASE_URL}/scan/${sessionId}/status`)
  if (!res.ok) {
    throw new Error(`Failed to get status: ${res.statusText}`)
  }
  return res.json()
}

async function finishScan(sessionId: string): Promise<FinishScanResponse> {
  const res = await fetch(`${API_BASE_URL}/scan/${sessionId}/finish`, {
    method: 'POST',
  })
  if (!res.ok) {
    throw new Error(`Failed to finish scan: ${res.statusText}`)
  }
  return res.json()
}

async function cancelScan(sessionId: string): Promise<CancelScanResponse> {
  const res = await fetch(`${API_BASE_URL}/scan/${sessionId}/cancel`, {
    method: 'POST',
  })
  if (!res.ok) {
    throw new Error(`Failed to cancel scan: ${res.statusText}`)
  }
  return res.json()
}

async function pauseScan(sessionId: string): Promise<PauseScanResponse> {
  const res = await fetch(`${API_BASE_URL}/scan/${sessionId}/pause`, {
    method: 'POST',
  })
  if (!res.ok) {
    throw new Error(`Failed to pause scan: ${res.statusText}`)
  }
  return res.json()
}

async function resumeScan(sessionId: string): Promise<ResumeScanResponse> {
  const res = await fetch(`${API_BASE_URL}/scan/${sessionId}/resume`, {
    method: 'POST',
  })
  if (!res.ok) {
    throw new Error(`Failed to resume scan: ${res.statusText}`)
  }
  return res.json()
}

async function downloadPdf(sessionId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/scan/${sessionId}/download`)
  if (!res.ok) {
    throw new Error(`Failed to download PDF: ${res.statusText}`)
  }

  const blob = await res.blob()
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `scan_${sessionId}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.URL.revokeObjectURL(url)
}

function App() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [scanState, setScanState] = useState<ScanState>('idle')
  const [pagesScanned, setPagesScanned] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [timeoutSeconds, setTimeoutSeconds] = useState<number | null>(null)
  const [lastActivityAt, setLastActivityAt] = useState<number | null>(null)
  const [remainingSeconds, setRemainingSeconds] = useState<number>(DEFAULT_TIMEOUT_SECONDS)

  const isActive = scanState === 'scanning' || scanState === 'paused' || scanState === 'processing'

  const buttonLabel = useMemo(() => {
    switch (scanState) {
      case 'idle':
        return 'Start scan'
      case 'scanning':
        return 'Scanning…'
      case 'paused':
        return 'Paused'
      case 'processing':
        return 'Processing PDF…'
      case 'finished':
        return 'Finished'
      case 'cancelled':
        return 'Cancelled'
      case 'error':
        return 'Error'
      default:
        return 'Start scan'
    }
  }, [scanState])

  const primaryColor: string = useMemo(() => {
    switch (scanState) {
      case 'idle':
        return 'blue'
      case 'scanning':
        return 'blue'
      case 'paused':
        return 'yellow'
      case 'processing':
        return 'teal'
      case 'finished':
        return 'green'
      case 'cancelled':
        return 'gray'
      case 'error':
        return 'red'
      default:
        return 'blue'
    }
  }, [scanState])

  const timeoutProgress = useMemo(() => {
    if (scanState !== 'scanning' || !lastActivityAt) return 0
    const total = timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS
    const used = total - remainingSeconds
    const ratio = Math.min(1, Math.max(0, used / total))
    return ratio * 100
  }, [scanState, lastActivityAt, remainingSeconds, timeoutSeconds])

  const handleStart = useCallback(async () => {
    try {
      setIsBusy(true)
      setError(null)
      const res = await startScan()
      setSessionId(res.session_id)
      const totalTimeout = res.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS
      setTimeoutSeconds(totalTimeout)
      setScanState('scanning')
      setPagesScanned(0)
      setLastActivityAt(Date.now())
      setRemainingSeconds(totalTimeout)
    } catch (e: any) {
      setError(e.message ?? 'Failed to start scan.')
      setScanState('error')
    } finally {
      setIsBusy(false)
    }
  }, [])

  const handleFinish = useCallback(async () => {
    if (!sessionId || (scanState !== 'scanning' && scanState !== 'paused')) return
    try {
      setIsBusy(true)
      setError(null)
      await finishScan(sessionId)
    } catch (e: any) {
      setError(e.message ?? 'Failed to finish scan.')
      setScanState('error')
    } finally {
      setIsBusy(false)
    }
  }, [sessionId, scanState])

  const handlePause = useCallback(async () => {
    if (!sessionId || scanState !== 'scanning') return
    try {
      setIsBusy(true)
      setError(null)
      await pauseScan(sessionId)
      setScanState('paused')
    } catch (e: any) {
      setError(e.message ?? 'Failed to pause scan.')
      setScanState('error')
    } finally {
      setIsBusy(false)
    }
  }, [sessionId, scanState])

  const handleResume = useCallback(async () => {
    if (!sessionId || scanState !== 'paused') return
    try {
      setIsBusy(true)
      setError(null)
      await resumeScan(sessionId)
      const totalTimeout = timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS
      setScanState('scanning')
      setLastActivityAt(Date.now())
      setRemainingSeconds(totalTimeout)
    } catch (e: any) {
      setError(e.message ?? 'Failed to resume scan.')
      setScanState('error')
    } finally {
      setIsBusy(false)
    }
  }, [sessionId, scanState, timeoutSeconds])

  const handleCancel = useCallback(async () => {
    if (!sessionId) return
    try {
      setIsBusy(true)
      setError(null)
      await cancelScan(sessionId)
      setScanState('cancelled')
    } catch (e: any) {
      setError(e.message ?? 'Failed to cancel scan.')
      setScanState('error')
    } finally {
      setIsBusy(false)
    }
  }, [sessionId])

  const handleDownload = useCallback(async () => {
    if (!sessionId) return
    try {
      setIsBusy(true)
      setError(null)
      await downloadPdf(sessionId)
    } catch (e: any) {
      setError(e.message ?? 'Failed to download PDF.')
      setScanState('error')
    } finally {
      setIsBusy(false)
    }
  }, [sessionId])

  const handleReset = useCallback(() => {
    setSessionId(null)
    setScanState('idle')
    setPagesScanned(0)
    setError(null)
    setIsBusy(false)
    setTimeoutSeconds(null)
    setLastActivityAt(null)
    setRemainingSeconds(DEFAULT_TIMEOUT_SECONDS)
  }, [])

  useEffect(() => {
    if (!sessionId || !isActive) {
      return
    }

    let cancelled = false
    const interval = window.setInterval(async () => {
      if (cancelled) return
      try {
        const status = await getStatus(sessionId)
        setPagesScanned((prev) => {
          if (status.pages_scanned > 0 && status.pages_scanned !== prev) {
            const total = timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS
            setLastActivityAt(Date.now())
            setRemainingSeconds(total)
          }
          return status.pages_scanned
        })
        setScanState(status.state)
        if (status.error) {
          setError(status.error)
        }
        if (['finished', 'cancelled', 'error'].includes(status.state)) {
          window.clearInterval(interval)
        }
      } catch (e: any) {
        window.clearInterval(interval)
        setError(e.message ?? 'Failed to fetch status.')
        setScanState('error')
      }
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [sessionId, isActive, timeoutSeconds])

  useEffect(() => {
    if (scanState !== 'scanning' || !lastActivityAt) {
      if (scanState !== 'scanning') {
        const total = timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS
        setRemainingSeconds(total)
      }
      return
    }

    const interval = window.setInterval(() => {
      const total = timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS
      const elapsed = (Date.now() - lastActivityAt) / 1000
      const remaining = Math.max(0, total - elapsed)
      setRemainingSeconds(remaining)
    }, 100)

    return () => {
      window.clearInterval(interval)
    }
  }, [scanState, lastActivityAt, timeoutSeconds])

  return (
    <Box
      style={{
        minHeight: '100vh',
        background:
          'radial-gradient(circle at top left, #4dabf7 0, transparent 60%), radial-gradient(circle at bottom right, #b197fc 0, #343a40 60%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        boxSizing: 'border-box',
        position: 'relative',
      }}
    >
      <Stack align="center" gap="lg">
        <Title order={2} c="white">
          Brother Auto Scan
        </Title>

        {scanState === 'scanning' ? (
          <RingProgress
            size={220}
            thickness={10}
            sections={[{ value: timeoutProgress, color: 'teal' }]}
            rootColor="rgba(0,0,0,0.35)"
            label={
              <Button
                onClick={undefined}
                radius={999}
                size="xl"
                color={primaryColor}
                disabled
                style={{
                  width: 180,
                  height: 180,
                  borderRadius: '50%',
                  fontSize: '1.1rem',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
                }}
              >
                <Stack gap={2} align="center">
                  <Text fw={600}>{buttonLabel}</Text>
                  <Text size="xs">{Math.ceil(remainingSeconds)}s</Text>
                </Stack>
              </Button>
            }
          />
        ) : (
          <Button
            onClick={scanState === 'idle' ? handleStart : undefined}
            radius={999}
            size="xl"
            color={primaryColor}
            disabled={scanState !== 'idle' || isBusy}
            style={{
              width: 180,
              height: 180,
              borderRadius: '50%',
              fontSize: '1.1rem',
              boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
            }}
          >
            <Text fw={600}>{buttonLabel}</Text>
          </Button>
        )}

        <Stack gap={4} align="center">
          <Text c="gray.1" size="sm">
            Current state: {scanState}
          </Text>
          {pagesScanned > 0 && (
            <Text c="gray.1" size="sm">
              Pages scanned: {pagesScanned}
            </Text>
          )}
        </Stack>

        <Group justify="center" gap="md">
          {scanState === 'scanning' && (
            <>
              <Button
                color="green"
                variant="light"
                onClick={handleFinish}
                disabled={isBusy || pagesScanned === 0}
              >
                Finish now
              </Button>
              <Button
                color="yellow"
                variant="light"
                onClick={handlePause}
                disabled={isBusy}
              >
                Pause
              </Button>
              <Button
                color="red"
                variant="light"
                onClick={handleCancel}
                disabled={isBusy}
              >
                Cancel
              </Button>
            </>
          )}

          {scanState === 'paused' && (
            <>
              <Button
                color="green"
                variant="light"
                onClick={handleFinish}
                disabled={isBusy || pagesScanned === 0}
              >
                Finish now
              </Button>
              <Button
                color="green"
                variant="light"
                onClick={handleResume}
                disabled={isBusy}
              >
                Resume
              </Button>
              <Button
                color="red"
                variant="light"
                onClick={handleCancel}
                disabled={isBusy}
              >
                Cancel
              </Button>
            </>
          )}

          {scanState === 'processing' && (
            <Button
              color="red"
              variant="light"
              onClick={handleCancel}
              disabled={isBusy}
            >
              Cancel
            </Button>
          )}

          {scanState === 'finished' && (
            <>
              <Button
                color="green"
                variant="filled"
                onClick={handleDownload}
                disabled={isBusy}
              >
                Download PDF
              </Button>
              <Button variant="subtle" color="gray" onClick={handleReset} disabled={isBusy}>
                Reset
              </Button>
            </>
          )}

          {(scanState === 'cancelled' || scanState === 'error') && (
            <Button variant="subtle" color="gray" onClick={handleReset} disabled={isBusy}>
              Reset
            </Button>
          )}
        </Group>

        {error && (
          <Alert color="red" variant="light" maw={420}>
            {error}
          </Alert>
        )}
      </Stack>

      {sessionId && (
        <Box
          style={{
            position: 'absolute',
            bottom: 16,
            left: 0,
            right: 0,
            textAlign: 'center',
          }}
        >
          <Text c="gray.4" size="xs">
            Session: {sessionId}
          </Text>
        </Box>
      )}
    </Box>
  )
}

export default App
