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
  const locale = i18n.language && i18n.language.startsWith('en') ? 'en-US' : 'de-DE'
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

  const handleFetchUsHistory = async () => {
    setFetchingHistory(true)
    setError(null)
    setLastHistoryByLabel(null)
    try {
      const res = await fetch(`${API}/fetch/us/history?limit=500&start_date=2020-01-01`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || res.statusText)
      }
      const data = await res.json()
      await loadHistory('us')
      if (data.saved != null) setError(null)
      if (data.by_label) setLastHistoryByLabel(data.by_label)
    } catch (e) {
      setError(e.message)
    } finally {
      setFetchingHistory(false)
    }
  }

  const isUS = selectedCountry === 'us'
  const labelTGA = t('labels.tga')
  const labelWDTGAL = t('labels.wdtgal')
  const labelRRP = t('labels.rrp')
  const labelWRESBAL = t('labels.wresbal')

  const chartData = (() => {
    if (isUS && history.some((r) => r.label)) {
      const byLabel = (lbl) => history.filter((r) => r.label === lbl).map((r) => ({ date: r.date, value: Number(r.value) }))
      const tga = byLabel(labelTGA)
      const wdtgal = byLabel(labelWDTGAL)
      const rrp = byLabel(labelRRP)
      const wresbal = byLabel(labelWRESBAL)
      let allDates = [...new Set([...tga.map((x) => x.date), ...wdtgal.map((x) => x.date), ...rrp.map((x) => x.date), ...wresbal.map((x) => x.date)])].sort()
      const cutoffStr = '2020-01-01'
      allDates = allDates.filter((d) => d >= cutoffStr)
      return allDates.map((date) => {
        const t = tga.find((x) => x.date === date)
        const w = wdtgal.find((x) => x.date === date)
        const r = rrp.find((x) => x.date === date)
        const wb = wresbal.find((x) => x.date === date)
        return {
          date,
          tga: t != null ? t.value : null,
          wdtgal: w != null ? w.value : null,
          rrp: r != null ? r.value : null,
          wresbal: wb != null ? wb.value : null,
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

  const hasMultiSeries = isUS && chartData.length > 0 && chartData.some((d) => d.tga != null || d.wdtgal != null || d.rrp != null || d.wresbal != null)
  const yAxisUnit = isUS ? formatUnit('Mrd. USD') : formatUnit(history[0]?.unit) || history[0]?.unit || ''

  const [visibleSeries, setVisibleSeries] = useState({ tga: true, wdtgal: true, rrp: true, wresbal: true })
  const toggleSeries = (key) => setVisibleSeries((s) => ({ ...s, [key]: !s[key] }))

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
              // Kurze Anleitung anzeigen
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
              </div>
            )}
            {chartData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={slicedChartData.length > 0 ? slicedChartData : chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      tickFormatter={(v) => v.toLocaleString(locale, { maximumFractionDigits: 0 })}
                      label={yAxisUnit ? { value: yAxisUnit, angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: 12 } } : undefined}
                    />
                    <Tooltip
                      formatter={(value) => [value != null ? Number(value).toLocaleString(locale, { maximumFractionDigits: 2 }) : '–', t('chart.tooltipValue')]}
                      labelFormatter={(label) => `${t('chart.tooltipDate')}: ${label}`}
                    />
                    <Legend content={<LegendWithLinks />} />
                    {hasMultiSeries ? (
                      <>
                        {visibleSeries.tga && <Line type="monotone" dataKey="tga" name={labelTGA} stroke="#2563eb" strokeWidth={2} dot={false} connectNulls />}
                        {visibleSeries.wdtgal && <Line type="monotone" dataKey="wdtgal" name={labelWDTGAL} stroke="#059669" strokeWidth={2} dot={false} connectNulls />}
                        {visibleSeries.rrp && <Line type="monotone" dataKey="rrp" name={labelRRP} stroke="#dc2626" strokeWidth={2} dot={false} connectNulls />}
                        {visibleSeries.wresbal && <Line type="monotone" dataKey="wresbal" name={labelWRESBAL} stroke="#7c3aed" strokeWidth={2} dot={false} connectNulls />}
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
                        <span style={{ fontVariantNumeric: 'tabular-nums', width: 95 }}>{chartData[lo]?.date ?? '–'}</span>
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
                        <span style={{ fontVariantNumeric: 'tabular-nums', width: 95 }}>{chartData[hi]?.date ?? '–'}</span>
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
                      <td style={{ padding: '0.5rem' }}>{r.date}</td>
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
    </div>
  )
}
