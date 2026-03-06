import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

const API = '/api'
const GITHUB_REPO = 'eckih/Finix'

// Versionsvergleich: "1.0.0" / "v1.0.1" → [1,0,0]; gibt true zurück wenn latest > current
function parseVersion(s) {
  if (!s || typeof s !== 'string') return [0, 0, 0]
  const v = s.replace(/^v/i, '').trim()
  return v.split('.').map((n) => parseInt(n, 10) || 0).concat(0, 0).slice(0, 3)
}
function isNewerVersion(latest, current) {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true
    if (a[i] < b[i]) return false
  }
  return false
}

// API-Einheiten (z. B. aus DB) → Übersetzungsschlüssel für units.*
const UNIT_TO_I18N_KEY = {
  'Mrd. USD': 'mrdUsd',
  'Mrd. EUR': 'mrdEur',
  'Mrd. CAD': 'mrdCad',
  'Mrd. CHF': 'mrdChf',
  'Mrd. MXN': 'mrdMxn',
}

// FRED-Quellen: Legenden-Einträge verlinken
const FRED_LEGEND_LINKS = {
  'WDTGAL (TGA Wed)': 'https://fred.stlouisfed.org/series/WDTGAL',
  'RRPONTSYD (Overnight RRP)': 'https://fred.stlouisfed.org/series/RRPONTSYD',
  'WRESBAL (Reserve Balances)': 'https://fred.stlouisfed.org/series/WRESBAL',
  'SOFR': 'https://fred.stlouisfed.org/series/SOFR',
  'EFFR': 'https://fred.stlouisfed.org/series/EFFR',
  'WALCL': 'https://fred.stlouisfed.org/series/WALCL',
}

function LegendWithLinks({ payload }) {
  const { t } = useTranslation()
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem 1.25rem', justifyContent: 'center', marginTop: '0.5rem' }}>
      {payload?.map((entry, i) => {
        const url = FRED_LEGEND_LINKS[entry.value]
        const content = (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 12, backgroundColor: entry.color, borderRadius: 2 }} />
            {entry.value}
          </span>
        )
        return (
          <span key={i} style={{ fontSize: 12 }}>
            {url ? (
              <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }} title={t('legend.sourceFred', { label: entry.value })}>
                {content}
              </a>
            ) : (
              content
            )}
          </span>
        )
      })}
    </div>
  )
}

export default function App() {
  const { t, i18n } = useTranslation()
  const [countries, setCountries] = useState([])
  const [selectedCountry, setSelectedCountry] = useState('us')
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [fetchingHistory, setFetchingHistory] = useState(false)
  const [error, setError] = useState(null)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [latestVersion, setLatestVersion] = useState(null)
  const [latestReleaseUrl, setLatestReleaseUrl] = useState(null)
  const [view, setView] = useState('finanzen')
  const [stats, setStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [marketsHistory, setMarketsHistory] = useState([])
  const [kurseLoading, setKurseLoading] = useState(false)
  const [kurseFetchingHistory, setKurseFetchingHistory] = useState(false)
  const locale = i18n.language && i18n.language.startsWith('en') ? 'en-US' : 'de-DE'
  const formatDate = (dateStr, loc = locale) => {
    if (!dateStr || typeof dateStr !== 'string') return dateStr ?? '–'
    const d = new Date(dateStr + (dateStr.length === 10 ? 'T12:00:00Z' : ''))
    if (Number.isNaN(d.getTime())) return dateStr
    return d.toLocaleDateString(loc, { day: '2-digit', month: '2-digit', year: 'numeric' })
  }
  const formatUnit = (unit) => {
    if (!unit || typeof unit !== 'string') return ''
    const u = unit.trim()
    const key = UNIT_TO_I18N_KEY[u]
    if (key) return t(`units.${key}`)
    // Fallback: "Mrd. XXX" → "Billion XXX" (EN) bzw. unverändert (DE)
    if (u.startsWith('Mrd.')) {
      return `${t('units.billion')} ${u.replace(/^Mrd\.\s*/, '').trim()}`.trim()
    }
    return unit
  }

  const loadCountries = useCallback(async () => {
    try {
      const lang = i18n.language && i18n.language.startsWith('en') ? 'en' : 'de'
      const res = await fetch(`${API}/countries?lang=${lang}`)
      if (!res.ok) throw new Error(t('messages.errorCountries'))
      const data = await res.json()
      setCountries(data.countries || [])
      if (data.countries?.length && !selectedCountry) setSelectedCountry(data.countries[0].id)
    } catch (e) {
      setError(e.message)
    }
  }, [t, i18n.language])

  const loadHistory = useCallback(async (country) => {
    if (!country) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API}/history?country=${encodeURIComponent(country)}&limit=100`)
      if (!res.ok) throw new Error(t('messages.errorHistory'))
      const data = await res.json()
      setHistory(data.data || [])
    } catch (e) {
      setError(e.message)
      setHistory([])
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadCountries()
  }, [loadCountries])

  useEffect(() => {
    loadHistory(selectedCountry)
  }, [selectedCountry, loadHistory])

  const loadMarketsHistory = useCallback(async () => {
    setKurseLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API}/history?country=markets&limit=3000&min_date=2020-01-01`)
      if (!res.ok) throw new Error(t('messages.errorHistory'))
      const data = await res.json()
      setMarketsHistory(data.data || [])
    } catch (e) {
      setError(e.message)
      setMarketsHistory([])
    } finally {
      setKurseLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (view === 'kurse') loadMarketsHistory()
  }, [view, loadMarketsHistory])

  const loadStats = useCallback(async () => {
    setStatsLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API}/stats`)
      if (!res.ok) throw new Error('Statistik konnte nicht geladen werden')
      const data = await res.json()
      setStats(data)
    } catch (e) {
      setError(e.message)
      setStats(null)
    } finally {
      setStatsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (view === 'statistik') loadStats()
  }, [view, loadStats])

  // Update-Check: aktuelle Version vs. letztes GitHub-Release
  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        const res = await fetch(`${API}/version`)
        if (!res.ok) return
        const { version: current } = await res.json()
        const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
          headers: { Accept: 'application/vnd.github.v3+json' },
        })
        if (!ghRes.ok || cancelled) return
        const release = await ghRes.json()
        const tag = release.tag_name || ''
        const url = release.html_url || `https://github.com/${GITHUB_REPO}/releases`
        if (tag && isNewerVersion(tag, current)) {
          if (!cancelled) {
            setLatestVersion(tag.replace(/^v/i, ''))
            setLatestReleaseUrl(url)
            setUpdateAvailable(true)
          }
        }
      } catch {
        // Netzwerk oder CORS – Update-Button einfach nicht anzeigen
      }
    }
    check()
    return () => { cancelled = true }
  }, [])

  const handleFetch = async () => {
    setFetching(true)
    setError(null)
    try {
      const res = await fetch(`${API}/fetch/${selectedCountry}`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || res.statusText)
      }
      await loadHistory(selectedCountry)
    } catch (e) {
      setError(e.message)
    } finally {
      setFetching(false)
    }
  }

  const [lastHistoryByLabel, setLastHistoryByLabel] = useState(null)
  const [historyProgressLog, setHistoryProgressLog] = useState([])

  async function readHistoryStream(res, onLine) {
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const obj = JSON.parse(trimmed)
          onLine(obj)
        } catch (_) { /* ignore malformed */ }
      }
    }
    if (buf.trim()) {
      try {
        onLine(JSON.parse(buf.trim()))
      } catch (_) {}
    }
  }

  const handleFetchUsHistory = async () => {
    setFetchingHistory(true)
    setError(null)
    setLastHistoryByLabel(null)
    setHistoryProgressLog([])
    try {
      const res = await fetch(`${API}/fetch/us/history/stream?limit=500&start_date=2020-01-01`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || res.statusText)
      }
      await readHistoryStream(res, (obj) => {
        setHistoryProgressLog((prev) => [...prev, obj])
        if (obj.type === 'error') setError(obj.message)
        if (obj.type === 'done') {
          if (obj.by_label) setLastHistoryByLabel(obj.by_label)
          setError(null)
        }
      })
      await loadHistory('us')
      if (view === 'kurse') await loadMarketsHistory()
    } catch (e) {
      setError(e.message)
    } finally {
      setFetchingHistory(false)
    }
  }

  const handleKurseLoadHistory = async () => {
    setKurseFetchingHistory(true)
    setError(null)
    setHistoryProgressLog([])
    try {
      const res = await fetch(`${API}/fetch/us/history/stream?limit=500&start_date=2020-01-01`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || res.statusText)
      }
      await readHistoryStream(res, (obj) => {
        setHistoryProgressLog((prev) => [...prev, obj])
        if (obj.type === 'error') setError(obj.message)
        if (obj.type === 'done') setError(null)
      })
      await loadMarketsHistory()
    } catch (e) {
      setError(e.message)
    } finally {
      setKurseFetchingHistory(false)
    }
  }

  const isUS = selectedCountry === 'us'
  const labelTGA = t('labels.tga')
  const labelWDTGAL = t('labels.wdtgal')
  const labelRRP = t('labels.rrp')
  const labelWRESBAL = t('labels.wresbal')
  const labelSOFR = t('labels.sofr')
  const labelEFFR = t('labels.effr')
  const labelSP500 = t('labels.sp500')
  const labelBTC = t('labels.btc')

  const chartData = (() => {
    if (isUS && history.some((r) => r.label)) {
      const byLabel = (lbl) => history.filter((r) => r.label === lbl).map((r) => ({ date: r.date, value: Number(r.value) }))
      const tga = byLabel(labelTGA)
      const wdtgal = byLabel(labelWDTGAL)
      const rrp = byLabel(labelRRP)
      const wresbal = byLabel(labelWRESBAL)
      const sofr = byLabel(labelSOFR)
      const effr = byLabel(labelEFFR)
      let allDates = [...new Set([
        ...tga.map((x) => x.date), ...wdtgal.map((x) => x.date), ...rrp.map((x) => x.date),
        ...wresbal.map((x) => x.date), ...sofr.map((x) => x.date), ...effr.map((x) => x.date),
      ])].sort()
      const cutoffStr = '2020-01-01'
      allDates = allDates.filter((d) => d >= cutoffStr)
      return allDates.map((date) => {
        const t = tga.find((x) => x.date === date)
        const w = wdtgal.find((x) => x.date === date)
        const r = rrp.find((x) => x.date === date)
        const wb = wresbal.find((x) => x.date === date)
        const sf = sofr.find((x) => x.date === date)
        const ef = effr.find((x) => x.date === date)
        return {
          date,
          tga: t != null ? t.value : null,
          wdtgal: w != null ? w.value : null,
          rrp: r != null ? r.value : null,
          wresbal: wb != null ? wb.value : null,
          sofr: sf != null ? sf.value : null,
          effr: ef != null ? ef.value : null,
        }
      })
    }
    return history
      .slice()
      .reverse()
      .map((r) => ({
        date: r.date,
        value: Number(r.value),
        name: `${r.date} – ${Number(r.value).toLocaleString(locale, { maximumFractionDigits: 1 })} ${formatUnit(r.unit) || r.unit || ''}`,
      }))
  })()

  const hasMultiSeries = isUS && chartData.length > 0 && chartData.some((d) => d.tga != null || d.wdtgal != null || d.rrp != null || d.wresbal != null || d.sofr != null || d.effr != null)
  const yAxisUnit = isUS ? formatUnit('Mrd. USD') : formatUnit(history[0]?.unit) || history[0]?.unit || ''

  const [visibleSeries, setVisibleSeries] = useState({ tga: true, wdtgal: true, rrp: true, wresbal: true, sofr: true, effr: true })
  const [visibleKurseSeries, setVisibleKurseSeries] = useState({ sp500: true, btc: true })
  const toggleSeries = (key) => setVisibleSeries((s) => ({ ...s, [key]: !s[key] }))
  const toggleKurseSeries = (key) => setVisibleKurseSeries((s) => ({ ...s, [key]: !s[key] }))

  const kurseChartData = (() => {
    const byLabel = (lbl) => marketsHistory.filter((r) => r.label === lbl).map((r) => ({ date: r.date, value: Number(r.value) }))
    const sp500 = byLabel(labelSP500)
    const btc = byLabel(labelBTC)
    const allDates = [...new Set([...sp500.map((x) => x.date), ...btc.map((x) => x.date)])].filter((d) => d >= '2020-01-01').sort()
    return allDates.map((date) => {
      const s = sp500.find((x) => x.date === date)
      const b = btc.find((x) => x.date === date)
      return {
        date,
        sp500: s != null ? s.value : null,
        btc: b != null ? b.value : null,
      }
    })
  })()
  const hasKurseData = kurseChartData.length > 0 && kurseChartData.some((d) => d.sp500 != null || d.btc != null)

  const nKurse = kurseChartData.length
  const [kurseRangeStart, setKurseRangeStart] = useState(0)
  const [kurseRangeEnd, setKurseRangeEnd] = useState(0)
  useEffect(() => {
    if (nKurse > 0) {
      setKurseRangeStart(0)
      setKurseRangeEnd(nKurse - 1)
    }
  }, [nKurse])
  const kurseStartI = nKurse > 0 ? Math.max(0, Math.min(kurseRangeStart, nKurse - 1)) : 0
  const kurseEndI = nKurse > 0 ? Math.max(0, Math.min(kurseRangeEnd, nKurse - 1)) : 0
  const kurseLo = Math.min(kurseStartI, kurseEndI)
  const kurseHi = Math.max(kurseStartI, kurseEndI)
  const slicedKurseChartData = nKurse > 0 ? kurseChartData.slice(kurseLo, kurseHi + 1) : []

  const n = chartData.length
  const [rangeStart, setRangeStart] = useState(0)
  const [rangeEnd, setRangeEnd] = useState(0)
  useEffect(() => {
    if (n > 0) {
      setRangeStart(0)
      setRangeEnd(n - 1)
    }
  }, [n])
  const startI = n > 0 ? Math.max(0, Math.min(rangeStart, n - 1)) : 0
  const endI = n > 0 ? Math.max(0, Math.min(rangeEnd, n - 1)) : 0
  const lo = Math.min(startI, endI)
  const hi = Math.max(startI, endI)
  const slicedChartData = n > 0 ? chartData.slice(lo, hi + 1) : []

  return (
    <div className="app">
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.75rem' }}>{t('app.title')}</h1>
        <p style={{ margin: '0.25rem 0 0', color: '#555' }}>
          {t('app.subtitle')}
        </p>
        <nav style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setView('finanzen')}
            style={{
              padding: '0.35rem 0.75rem',
              border: view === 'finanzen' ? '2px solid #2563eb' : '1px solid #ccc',
              borderRadius: 6,
              background: view === 'finanzen' ? '#eff6ff' : '#fff',
              cursor: 'pointer',
              fontSize: '0.95rem',
            }}
          >
            {t('menu.finanzen')}
          </button>
          <button
            type="button"
            onClick={() => setView('kurse')}
            style={{
              padding: '0.35rem 0.75rem',
              border: view === 'kurse' ? '2px solid #2563eb' : '1px solid #ccc',
              borderRadius: 6,
              background: view === 'kurse' ? '#eff6ff' : '#fff',
              cursor: 'pointer',
              fontSize: '0.95rem',
            }}
          >
            {t('menu.kurse')}
          </button>
          <button
            type="button"
            onClick={() => setView('statistik')}
            style={{
              padding: '0.35rem 0.75rem',
              border: view === 'statistik' ? '2px solid #2563eb' : '1px solid #ccc',
              borderRadius: 6,
              background: view === 'statistik' ? '#eff6ff' : '#fff',
              cursor: 'pointer',
              fontSize: '0.95rem',
            }}
          >
            {t('menu.statistik')}
          </button>
        </nav>
        <div style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
          <button
            type="button"
            onClick={() => i18n.changeLanguage('de')}
            style={{
              marginRight: 8,
              padding: '0.2rem 0.5rem',
              border: i18n.language === 'de' ? '2px solid #2563eb' : '1px solid #ccc',
              borderRadius: 4,
              background: i18n.language === 'de' ? '#eff6ff' : '#fff',
              cursor: 'pointer',
            }}
          >
            DE
          </button>
          <button
            type="button"
            onClick={() => i18n.changeLanguage('en')}
            style={{
              padding: '0.2rem 0.5rem',
              border: i18n.language === 'en' ? '2px solid #2563eb' : '1px solid #ccc',
              borderRadius: 4,
              background: i18n.language === 'en' ? '#eff6ff' : '#fff',
              cursor: 'pointer',
            }}
          >
            EN
          </button>
        </div>
      </header>

      {error && view === 'kurse' && (
        <div role="alert" style={{ padding: '0.75rem', background: '#fef2f2', color: '#b91c1c', borderRadius: '6px', marginBottom: '1rem' }}>
          {error}
        </div>
      )}
      {view === 'kurse' ? (
        <>
          <section className="controls" style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
            <button
              onClick={handleKurseLoadHistory}
              disabled={kurseFetchingHistory}
              style={{
                padding: '0.5rem 1rem',
                fontSize: '1rem',
                background: kurseFetchingHistory ? '#aaa' : '#059669',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: kurseFetchingHistory ? 'not-allowed' : 'pointer',
              }}
            >
              {kurseFetchingHistory ? t('kurse.loadHistoryBusy') : t('kurse.loadHistory')}
            </button>
          </section>
          {(historyProgressLog.length > 0 || kurseFetchingHistory) && (
            <section aria-live="polite" style={{ marginBottom: '1.5rem', padding: '0.75rem 1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', color: '#334155' }}>{t('historyProgress.title')}</h3>
              <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.9rem', color: '#475569', maxHeight: 160, overflowY: 'auto' }}>
                {kurseFetchingHistory && historyProgressLog.length === 0 && <li key="wait">{t('historyProgress.waiting')}</li>}
                {historyProgressLog.map((entry, i) => (
                  <li key={i} style={{ color: entry.type === 'error' ? '#b91c1c' : entry.type === 'done' ? '#15803d' : undefined, marginBottom: '0.25rem' }}>
                    {entry.message}
                    {entry.type === 'done' && entry.saved != null && ` (${entry.saved})`}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {kurseLoading ? (
            <p>{t('messages.loading')}</p>
          ) : (
            <section className="chart" style={{ background: '#fff', padding: '1rem', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '1.5rem' }}>
              <h2 style={{ margin: '0 0 1rem', fontSize: '1.1rem' }}>{t('kurse.title')}</h2>
              {hasKurseData && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
                  <span style={{ color: '#555', marginRight: '0.25rem' }}>{t('chart.show')}:</span>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="checkbox" checked={visibleKurseSeries.sp500} onChange={() => toggleKurseSeries('sp500')} />
                    <span style={{ width: 10, height: 10, backgroundColor: '#2563eb' }} />
                    <span>{labelSP500}</span>
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="checkbox" checked={visibleKurseSeries.btc} onChange={() => toggleKurseSeries('btc')} />
                    <span style={{ width: 10, height: 10, backgroundColor: '#f59e0b' }} />
                    <span>{labelBTC}</span>
                  </label>
                </div>
              )}
              {kurseChartData.length > 0 && hasKurseData ? (
                <>
                  <ResponsiveContainer width="100%" height={360}>
                    <LineChart data={slicedKurseChartData.length > 0 ? slicedKurseChartData : kurseChartData} margin={{ top: 5, right: 50, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="date" tick={{ fontSize: 12 }} tickFormatter={(v) => formatDate(v)} />
                      <YAxis
                        yAxisId="left"
                        tick={{ fontSize: 12 }}
                        tickFormatter={(v) => v.toLocaleString(locale, { maximumFractionDigits: 0 })}
                        label={{ value: 'S&P 500', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: 12 } }}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 12 }}
                        tickFormatter={(v) => v.toLocaleString(locale, { maximumFractionDigits: 0 })}
                        label={{ value: 'BTC (USD)', angle: 90, position: 'insideRight', style: { textAnchor: 'middle', fontSize: 12 } }}
                      />
                      <Tooltip
                        formatter={(value) => [value != null ? Number(value).toLocaleString(locale, { maximumFractionDigits: 2 }) : '–', t('chart.tooltipValue')]}
                        labelFormatter={(label) => `${t('chart.tooltipDate')}: ${formatDate(label)}`}
                      />
                      {visibleKurseSeries.sp500 && <Line type="monotone" dataKey="sp500" name={labelSP500} stroke="#2563eb" strokeWidth={2} dot={false} connectNulls yAxisId="left" />}
                      {visibleKurseSeries.btc && <Line type="monotone" dataKey="btc" name={labelBTC} stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls yAxisId="right" />}
                    </LineChart>
                  </ResponsiveContainer>
                  {nKurse > 1 && (
                    <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid #eee' }}>
                      <div style={{ fontSize: '0.85rem', color: '#555', marginBottom: '0.5rem' }}>{t('chart.period')}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '160px' }}>
                          <span>{t('chart.from')}:</span>
                          <input
                            type="range"
                            min={0}
                            max={nKurse - 1}
                            value={kurseLo}
                            onChange={(e) => {
                              const v = Number(e.target.value)
                              setKurseRangeStart(v)
                              if (v > kurseEndI) setKurseRangeEnd(v)
                            }}
                            style={{ flex: 1, minWidth: 80 }}
                          />
                          <span style={{ fontVariantNumeric: 'tabular-nums', width: 95 }}>{formatDate(kurseChartData[kurseLo]?.date)}</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '160px' }}>
                          <span>{t('chart.to')}:</span>
                          <input
                            type="range"
                            min={0}
                            max={nKurse - 1}
                            value={kurseHi}
                            onChange={(e) => {
                              const v = Number(e.target.value)
                              setKurseRangeEnd(v)
                              if (v < kurseStartI) setKurseRangeStart(v)
                            }}
                            style={{ flex: 1, minWidth: 80 }}
                          />
                          <span style={{ fontVariantNumeric: 'tabular-nums', width: 95 }}>{formatDate(kurseChartData[kurseHi]?.date)}</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => { setKurseRangeStart(0); setKurseRangeEnd(nKurse - 1) }}
                          style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 4, cursor: 'pointer' }}
                        >
                          {t('chart.fullRange')}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p style={{ color: '#666' }}>{t('kurse.noData')}</p>
              )}
            </section>
          )}
        </>
      ) : view === 'statistik' ? (
        <>
      {error && (
        <div role="alert" style={{ padding: '0.75rem', background: '#fef2f2', color: '#b91c1c', borderRadius: '6px', marginBottom: '1rem' }}>
          {error}
        </div>
      )}
      <section style={{ background: '#fff', padding: '1rem', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: '0 0 1rem', fontSize: '1.1rem' }}>{t('statistik.title')}</h2>
        {statsLoading ? (
          <p>{t('messages.loading')}</p>
        ) : stats ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: 4 }}>{t('statistik.totalRecords')}</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{Number(stats.total_records).toLocaleString(locale)}</div>
              </div>
              <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: 4 }}>{t('statistik.dbSize')}</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>
                  {(stats.file_size_bytes / (1024 * 1024)).toLocaleString(locale, { maximumFractionDigits: 2 })} MB
                </div>
              </div>
              {stats.date_min && (
                <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: 4 }}>{t('statistik.dateRange')}</div>
                  <div style={{ fontSize: '1rem', fontWeight: 500 }}>{stats.date_min} – {stats.date_max}</div>
                </div>
              )}
              {stats.last_fetched_at && (
                <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: 4 }}>{t('statistik.lastUpdate')}</div>
                  <div style={{ fontSize: '0.95rem' }}>{stats.last_fetched_at}</div>
                </div>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
              <div>
                <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>{t('statistik.byCountry')}</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                      <th style={{ textAlign: 'left', padding: '0.5rem' }}>{t('statistik.country')}</th>
                      <th style={{ textAlign: 'right', padding: '0.5rem' }}>{t('statistik.count')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(stats.by_country || []).map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.5rem' }}>{row.country}</td>
                        <td style={{ textAlign: 'right', padding: '0.5rem' }}>{Number(row.count).toLocaleString(locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>{t('statistik.byLabel')}</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                      <th style={{ textAlign: 'left', padding: '0.5rem' }}>{t('statistik.label')}</th>
                      <th style={{ textAlign: 'right', padding: '0.5rem' }}>{t('statistik.count')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(stats.by_label || []).slice(0, 15).map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.5rem' }}>{row.label}</td>
                        <td style={{ textAlign: 'right', padding: '0.5rem' }}>{Number(row.count).toLocaleString(locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>{t('statistik.byUnit')}</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                      <th style={{ textAlign: 'left', padding: '0.5rem' }}>{t('statistik.unit')}</th>
                      <th style={{ textAlign: 'right', padding: '0.5rem' }}>{t('statistik.count')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(stats.by_unit || []).map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.5rem' }}>{row.unit}</td>
                        <td style={{ textAlign: 'right', padding: '0.5rem' }}>{Number(row.count).toLocaleString(locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}
      </section>
        </>
      ) : (
        <>
      {error && (
        <div role="alert" style={{ padding: '0.75rem', background: '#fef2f2', color: '#b91c1c', borderRadius: '6px', marginBottom: '1rem' }}>
          {error}
        </div>
      )}
      {lastHistoryByLabel && Object.keys(lastHistoryByLabel).length > 0 && (
        <div style={{ padding: '0.75rem', background: '#f0fdf4', color: '#166534', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.9rem' }}>
          {t('messages.historyLoaded')} {Object.entries(lastHistoryByLabel).map(([lbl, n]) => `${lbl}: ${n}`).join(', ')}
        </div>
      )}
      <section className="controls" style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <label>
          {t('controls.country')}:{' '}
          <select
            value={selectedCountry}
            onChange={(e) => setSelectedCountry(e.target.value)}
            style={{ padding: '0.4rem 0.75rem', fontSize: '1rem', minWidth: '180px' }}
          >
            {countries.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={handleFetch}
          disabled={fetching}
          style={{
            padding: '0.5rem 1rem',
            fontSize: '1rem',
            background: fetching ? '#aaa' : '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: fetching ? 'not-allowed' : 'pointer',
          }}
        >
          {fetching ? t('controls.fetching') : t('controls.fetch')}
        </button>
        {selectedCountry === 'us' && (
          <button
            onClick={handleFetchUsHistory}
            disabled={fetchingHistory}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '1rem',
              background: fetchingHistory ? '#aaa' : '#059669',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: fetchingHistory ? 'not-allowed' : 'pointer',
            }}
            title={t('controls.loadHistoryTitle')}
          >
            {fetchingHistory ? t('controls.loadHistoryBusy') : t('controls.loadHistory')}
          </button>
        )}
        {updateAvailable && latestReleaseUrl && (
          <button
            type="button"
            onClick={() => {
              window.open(latestReleaseUrl, '_blank', 'noopener,noreferrer')
              alert(t('controls.updateInstructions'))
            }}
            title={t('controls.updateAvailable', { version: latestVersion || '' })}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '1rem',
              background: '#7c3aed',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            {t('controls.update')} {latestVersion ? `(${latestVersion})` : ''}
          </button>
        )}
      </section>
      {(historyProgressLog.length > 0 || fetchingHistory) && view === 'finanzen' && (
        <section aria-live="polite" style={{ marginBottom: '1.5rem', padding: '0.75rem 1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', color: '#334155' }}>{t('historyProgress.title')}</h3>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.9rem', color: '#475569', maxHeight: 160, overflowY: 'auto' }}>
            {fetchingHistory && historyProgressLog.length === 0 && <li key="wait">{t('historyProgress.waiting')}</li>}
            {historyProgressLog.map((entry, i) => (
              <li key={i} style={{ color: entry.type === 'error' ? '#b91c1c' : entry.type === 'done' ? '#15803d' : undefined, marginBottom: '0.25rem' }}>
                {entry.message}
                {entry.type === 'done' && entry.saved != null && ` (${entry.saved})`}
              </li>
            ))}
          </ul>
        </section>
      )}

      {loading ? (
        <p>{t('messages.loading')}</p>
      ) : (
        <>
          <section className="chart" style={{ background: '#fff', padding: '1rem', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '1.5rem' }}>
            <h2 style={{ margin: '0 0 1rem', fontSize: '1.1rem' }}>{t('chart.history')} ({selectedCountry.toUpperCase()})</h2>
            {hasMultiSeries && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
                <span style={{ color: '#555', marginRight: '0.25rem' }}>{t('chart.show')}:</span>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={visibleSeries.tga} onChange={() => toggleSeries('tga')} />
                  <span style={{ width: 10, height: 10, backgroundColor: '#2563eb' }} />
                  <span>{labelTGA}</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={visibleSeries.wdtgal} onChange={() => toggleSeries('wdtgal')} />
                  <span style={{ width: 10, height: 10, backgroundColor: '#059669' }} />
                  <span>{labelWDTGAL}</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={visibleSeries.rrp} onChange={() => toggleSeries('rrp')} />
                  <span style={{ width: 10, height: 10, backgroundColor: '#dc2626' }} />
                  <span>{labelRRP}</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={visibleSeries.wresbal} onChange={() => toggleSeries('wresbal')} />
                  <span style={{ width: 10, height: 10, backgroundColor: '#7c3aed' }} />
                  <span>{labelWRESBAL}</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={visibleSeries.sofr} onChange={() => toggleSeries('sofr')} />
                  <span style={{ width: 10, height: 10, backgroundColor: '#ea580c' }} />
                  <span>{labelSOFR}</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={visibleSeries.effr} onChange={() => toggleSeries('effr')} />
                  <span style={{ width: 10, height: 10, backgroundColor: '#0d9488' }} />
                  <span>{labelEFFR}</span>
                </label>
              </div>
            )}
            {chartData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={slicedChartData.length > 0 ? slicedChartData : chartData} margin={{ top: 5, right: 50, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} tickFormatter={(v) => formatDate(v)} />
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: 12 }}
                      tickFormatter={(v) => v.toLocaleString(locale, { maximumFractionDigits: 0 })}
                      label={yAxisUnit ? { value: yAxisUnit, angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: 12 } } : undefined}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 12 }}
                      tickFormatter={(v) => `${Number(v).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 2 })} %`}
                      label={{ value: '%', angle: 90, position: 'insideRight', style: { textAnchor: 'middle', fontSize: 12 } }}
                    />
                    <Tooltip
                      formatter={(value) => [value != null ? Number(value).toLocaleString(locale, { maximumFractionDigits: 2 }) : '–', t('chart.tooltipValue')]}
                      labelFormatter={(label) => `${t('chart.tooltipDate')}: ${formatDate(label)}`}
                    />
                    <Legend content={<LegendWithLinks />} />
                    {hasMultiSeries ? (
                      <>
                        {visibleSeries.tga && <Line type="monotone" dataKey="tga" name={labelTGA} stroke="#2563eb" strokeWidth={2} dot={false} connectNulls yAxisId="left" />}
                        {visibleSeries.wdtgal && <Line type="monotone" dataKey="wdtgal" name={labelWDTGAL} stroke="#059669" strokeWidth={2} dot={false} connectNulls yAxisId="left" />}
                        {visibleSeries.rrp && <Line type="monotone" dataKey="rrp" name={labelRRP} stroke="#dc2626" strokeWidth={2} dot={false} connectNulls yAxisId="left" />}
                        {visibleSeries.wresbal && <Line type="monotone" dataKey="wresbal" name={labelWRESBAL} stroke="#7c3aed" strokeWidth={2} dot={false} connectNulls yAxisId="left" />}
                        {visibleSeries.sofr && <Line type="monotone" dataKey="sofr" name={labelSOFR} stroke="#ea580c" strokeWidth={2} dot={false} connectNulls yAxisId="right" />}
                        {visibleSeries.effr && <Line type="monotone" dataKey="effr" name={labelEFFR} stroke="#0d9488" strokeWidth={2} dot={false} connectNulls yAxisId="right" />}
                      </>
                    ) : (
                      <Line type="monotone" dataKey="value" name={t('chart.tooltipValue')} stroke="#2563eb" strokeWidth={2} dot={false} />
                    )}
                  </LineChart>
                </ResponsiveContainer>
                {n > 1 && (
                  <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid #eee' }}>
                    <div style={{ fontSize: '0.85rem', color: '#555', marginBottom: '0.5rem' }}>{t('chart.period')}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1rem' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '160px' }}>
                        <span>{t('chart.from')}:</span>
                        <input
                          type="range"
                          min={0}
                          max={n - 1}
                          value={lo}
                          onChange={(e) => {
                            const v = Number(e.target.value)
                            setRangeStart(v)
                            if (v > endI) setRangeEnd(v)
                          }}
                          style={{ flex: 1, minWidth: 80 }}
                        />
                        <span style={{ fontVariantNumeric: 'tabular-nums', width: 95 }}>{formatDate(chartData[lo]?.date)}</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '160px' }}>
                        <span>{t('chart.to')}:</span>
                        <input
                          type="range"
                          min={0}
                          max={n - 1}
                          value={hi}
                          onChange={(e) => {
                            const v = Number(e.target.value)
                            setRangeEnd(v)
                            if (v < startI) setRangeStart(v)
                          }}
                          style={{ flex: 1, minWidth: 80 }}
                        />
                        <span style={{ fontVariantNumeric: 'tabular-nums', width: 95 }}>{formatDate(chartData[hi]?.date)}</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => { setRangeStart(0); setRangeEnd(n - 1) }}
                        style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 4, cursor: 'pointer' }}
                      >
                        {t('chart.fullRange')}
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p style={{ color: '#666' }}>{t('chart.noData')}</p>
            )}
          </section>

          <section className="table" style={{ background: '#fff', padding: '1rem', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <h2 style={{ margin: '0 0 1rem', fontSize: '1.1rem' }}>{t('table.lastEntries')}</h2>
            {history.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #eee', textAlign: 'left' }}>
                    <th style={{ padding: '0.5rem' }}>{t('table.date')}</th>
                    {isUS && <th style={{ padding: '0.5rem' }}>{t('table.indicator')}</th>}
                    <th style={{ padding: '0.5rem' }}>{t('table.value')}</th>
                    <th style={{ padding: '0.5rem' }}>{t('table.unit')}</th>
                    <th style={{ padding: '0.5rem' }}>{t('table.fetchedAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.slice(0, 30).map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '0.5rem' }}>{formatDate(r.date)}</td>
                      {isUS && <td style={{ padding: '0.5rem', color: '#555' }}>{r.label || '–'}</td>}
                      <td style={{ padding: '0.5rem' }}>{Number(r.value).toLocaleString(locale, { maximumFractionDigits: 2 })}</td>
                      <td style={{ padding: '0.5rem' }}>{formatUnit(r.unit) || r.unit}</td>
                      <td style={{ padding: '0.5rem', color: '#666' }}>{r.fetched_at ? new Date(r.fetched_at).toLocaleString(locale) : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ color: '#666' }}>{t('table.noEntries')}</p>
            )}
          </section>
        </>
      )}
        </>
      )}
    </div>
  )
}
