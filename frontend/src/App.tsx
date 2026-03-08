import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Group, Stack, Text, Title } from '@mantine/core'

type ScanState = 'idle' | 'scanning' | 'processing' | 'finished' | 'cancelled' | 'error'

type SessionStatusResponse = {
  session_id: string
  state: ScanState
  pages_scanned: number
  error?: string | null
}

type StartScanResponse = {
  session_id: string
  message: string
}

type CancelScanResponse = {
  session_id: string
  message: string
}

const POLL_INTERVAL_MS = 1500

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

async function cancelScan(sessionId: string): Promise<CancelScanResponse> {
  const res = await fetch(`${API_BASE_URL}/scan/${sessionId}/cancel`, {
    method: 'POST',
  })
  if (!res.ok) {
    throw new Error(`Failed to cancel scan: ${res.statusText}`)
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

  const isActive = scanState === 'scanning' || scanState === 'processing'

  const buttonLabel = useMemo(() => {
    switch (scanState) {
      case 'idle':
        return 'Start scan'
      case 'scanning':
        return pagesScanned > 0 ? `Scanning… (${pagesScanned} pages)` : 'Scanning…'
      case 'processing':
        return 'Processing PDF…'
      case 'finished':
        return pagesScanned > 0 ? `Finished (${pagesScanned} pages)` : 'Finished'
      case 'cancelled':
        return 'Cancelled'
      case 'error':
        return 'Error'
      default:
        return 'Start scan'
    }
  }, [scanState, pagesScanned])

  const primaryColor: string = useMemo(() => {
    switch (scanState) {
      case 'idle':
        return 'blue'
      case 'scanning':
        return 'green'
      case 'processing':
        return 'teal'
      case 'finished':
        return 'grape'
      case 'cancelled':
        return 'gray'
      case 'error':
        return 'red'
      default:
        return 'blue'
    }
  }, [scanState])

  const handleStart = useCallback(async () => {
    try {
      setIsBusy(true)
      setError(null)
      const res = await startScan()
      setSessionId(res.session_id)
      setScanState('scanning')
      setPagesScanned(0)
    } catch (e: any) {
      setError(e.message ?? 'Failed to start scan.')
      setScanState('error')
    } finally {
      setIsBusy(false)
    }
  }, [])

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
        setPagesScanned(status.pages_scanned)
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
  }, [sessionId, isActive])

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
      }}
    >
      <Stack align="center" gap="lg">
        <Title order={2} c="white">
          Brother Auto Scan
        </Title>

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

        <Group justify="center" gap="md">
          {(scanState === 'scanning' || scanState === 'processing') && (
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

        <Stack gap={4} align="center">
          <Text c="gray.1" size="sm">
            Current state: {scanState}
            {pagesScanned > 0 && ` • Pages scanned: ${pagesScanned}`}
          </Text>
          {sessionId && (
            <Text c="gray.4" size="xs">
              Session: {sessionId}
            </Text>
          )}
        </Stack>

        {error && (
          <Alert color="red" variant="light" maw={420}>
            {error}
          </Alert>
        )}
      </Stack>
    </Box>
  )
}

export default App
