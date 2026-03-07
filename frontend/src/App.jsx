import { useState, useEffect, useCallback, useRef } from 'react'
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
  const [newsFeed, setNewsFeed] = useState([])
  const [newsLoading, setNewsLoading] = useState(false)
  const [newsSymbol, setNewsSymbol] = useState('')
  const [newsSource, setNewsSource] = useState('all')
  const [newsWsKey, setNewsWsKey] = useState(0)
  const [newsAiOpenIndex, setNewsAiOpenIndex] = useState(null)
  const [newsAiLoadingIndex, setNewsAiLoadingIndex] = useState(null)
  const [newsAiResponseByIndex, setNewsAiResponseByIndex] = useState({})
  const [newsAiCustomPrompt, setNewsAiCustomPrompt] = useState('')
  const [newsTranslations, setNewsTranslations] = useState({})
  const [newsAiTestLoading, setNewsAiTestLoading] = useState(false)
  const [newsAiTestResult, setNewsAiTestResult] = useState(null)
  const [newsAiTestPrompt, setNewsAiTestPrompt] = useState('')
  const [newsAiTestAskLoading, setNewsAiTestAskLoading] = useState(false)
  const [newsAiTestResponse, setNewsAiTestResponse] = useState(null)
  const [newsAiModels, setNewsAiModels] = useState([])
  const [newsAiModelsLoading, setNewsAiModelsLoading] = useState(false)
  const [newsAiSelectedModel, setNewsAiSelectedModel] = useState('')
  const [newsAiTestThinking, setNewsAiTestThinking] = useState('')
  const [newsAiTestStreamingAnswer, setNewsAiTestStreamingAnswer] = useState('')
  const [adminTables, setAdminTables] = useState([])
  const [adminSelectedTable, setAdminSelectedTable] = useState('')
  const [adminData, setAdminData] = useState({ columns: [], rows: [], total: 0 })
  const [adminLoading, setAdminLoading] = useState(false)
  const [adminError, setAdminError] = useState(null)
  const [adminEditRow, setAdminEditRow] = useState(null)
  const [adminSaving, setAdminSaving] = useState(false)
  const [adminPageSize, setAdminPageSize] = useState(50)
  const [adminOffset, setAdminOffset] = useState(0)
  const [aiPresetQuestions, setAiPresetQuestions] = useState([])
  const [aiQuestionsConfig, setAiQuestionsConfig] = useState([])
  const [aiQuestionsConfigLoading, setAiQuestionsConfigLoading] = useState(false)
  const [aiQuestionsConfigSaving, setAiQuestionsConfigSaving] = useState(false)

  useEffect(() => {
    if (newsAiOpenIndex === null) return
    const close = (e) => {
      if (!e.target.closest('[data-ai-dropdown]')) setNewsAiOpenIndex(null)
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [newsAiOpenIndex])

  const loadLmStudioModels = useCallback(async () => {
    setNewsAiModelsLoading(true)
    setNewsAiModels([])
    try {
      const res = await fetch(`${API}/ai/models`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || res.statusText)
      const list = Array.isArray(data.models) ? data.models : []
      setNewsAiModels(list)
      if (list.length > 0) setNewsAiSelectedModel(prev => prev || list[0].id)
    } catch (e) {
      setNewsAiModels([])
    } finally {
      setNewsAiModelsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (view === 'konfiguration') loadLmStudioModels()
  }, [view, loadLmStudioModels])

  const loadAiPresetQuestions = useCallback(async (lang) => {
    const l = (lang || i18n.language || 'de').startsWith('en') ? 'en' : 'de'
    try {
      const res = await fetch(`${API}/ai-questions?lang=${encodeURIComponent(l)}`)
      const data = await res.json().catch(() => ({}))
      setAiPresetQuestions(Array.isArray(data.questions) ? data.questions : [])
    } catch {
      setAiPresetQuestions([])
    }
  }, [i18n.language])

  const loadAiQuestionsConfig = useCallback(async () => {
    setAiQuestionsConfigLoading(true)
    try {
      const res = await fetch(`${API}/ai-questions`)
      const data = await res.json().catch(() => ({}))
      const list = Array.isArray(data.questions) ? data.questions : []
      setAiQuestionsConfig(list.map(q => ({ key: q.key || '', text_de: q.text_de || '', text_en: q.text_en || '', sort_order: q.sort_order ?? 0 })))
    } catch {
      setAiQuestionsConfig([])
    } finally {
      setAiQuestionsConfigLoading(false)
    }
  }, [])

  const saveAiQuestionsConfig = useCallback(async () => {
    const list = aiQuestionsConfig.filter(q => (q.text_de || q.text_en || '').trim())
    if (list.length === 0) return
    setAiQuestionsConfigSaving(true)
    try {
      const res = await fetch(`${API}/ai-questions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(list.map((q, i) => ({ key: (q.key || '').trim() || `q${i}`, text_de: (q.text_de || '').trim(), text_en: (q.text_en || '').trim(), sort_order: q.sort_order ?? i }))),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText)
      setAdminError(null)
      await loadAiQuestionsConfig()
      await loadAiPresetQuestions(i18n.language)
    } catch (e) {
      setAdminError(e.message)
    } finally {
      setAiQuestionsConfigSaving(false)
    }
  }, [aiQuestionsConfig, loadAiQuestionsConfig, loadAiPresetQuestions, i18n.language])

  useEffect(() => {
    if (view === 'news') loadAiPresetQuestions(i18n.language)
  }, [view, i18n.language, loadAiPresetQuestions])

  useEffect(() => {
    if (view === 'konfiguration') loadAiQuestionsConfig()
  }, [view, loadAiQuestionsConfig])

  const loadAdminTables = useCallback(async () => {
    try {
      const res = await fetch(`${API}/admin/tables`)
      const data = await res.json().catch(() => ({}))
      setAdminTables(data.tables || [])
      setAdminError(data.error || null)
      setAdminSelectedTable((prev) => (prev || (data.tables || [])[0] || ''))
    } catch (e) {
      setAdminTables([])
      setAdminError(e.message)
    }
  }, [])

  const loadAdminTable = useCallback(async (offset = null, limit = null) => {
    if (!adminSelectedTable) {
      setAdminData({ columns: [], rows: [], total: 0 })
      return
    }
    const off = offset ?? adminOffset
    const lim = limit ?? adminPageSize
    setAdminLoading(true)
    setAdminError(null)
    try {
      const res = await fetch(`${API}/admin/table/${encodeURIComponent(adminSelectedTable)}?limit=${lim}&offset=${off}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || data.error || res.statusText)
      setAdminData({ columns: data.columns || [], rows: data.rows || [], total: data.total ?? 0 })
    } catch (e) {
      setAdminData({ columns: [], rows: [], total: 0 })
      setAdminError(e.message)
    } finally {
      setAdminLoading(false)
    }
  }, [adminSelectedTable, adminOffset, adminPageSize])

  useEffect(() => {
    if (view === 'admin') loadAdminTables()
  }, [view, loadAdminTables])

  useEffect(() => {
    if (view === 'admin' && adminSelectedTable) loadAdminTable(adminOffset, adminPageSize)
  }, [view, adminSelectedTable, adminOffset, adminPageSize, loadAdminTable])

  const adminGoToPage = useCallback((newOffset) => {
    setAdminOffset((prev) => Math.max(0, newOffset))
  }, [])

  const adminSaveRow = useCallback(async (row) => {
    if (!adminSelectedTable || !row) return
    setAdminSaving(true)
    try {
      const res = await fetch(`${API}/admin/table/${encodeURIComponent(adminSelectedTable)}/row`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(row),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || data.error || res.statusText)
      setAdminEditRow(null)
      loadAdminTable()
    } catch (e) {
      setAdminError(e.message)
    } finally {
      setAdminSaving(false)
    }
  }, [adminSelectedTable, loadAdminTable])

  const adminDeleteRow = useCallback(async (rowid) => {
    if (!adminSelectedTable || rowid == null) return
    if (!window.confirm(t('config.adminDelete') + ' rowid ' + rowid + '?')) return
    try {
      const res = await fetch(`${API}/admin/table/${encodeURIComponent(adminSelectedTable)}/row/${rowid}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || data.error || res.statusText)
      loadAdminTable()
    } catch (e) {
      setAdminError(e.message)
    }
  }, [adminSelectedTable, loadAdminTable])

  const adminClearTable = useCallback(async () => {
    if (!adminSelectedTable) return
    if (!window.confirm(t('config.adminClearTableConfirm', { table: adminSelectedTable }))) return
    setAdminLoading(true)
    setAdminError(null)
    try {
      const res = await fetch(`${API}/admin/table/${encodeURIComponent(adminSelectedTable)}/clear`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || data.error || res.statusText)
      setAdminOffset(0)
      loadAdminTable(0, adminPageSize)
    } catch (e) {
      setAdminError(e.message)
    } finally {
      setAdminLoading(false)
    }
  }, [adminSelectedTable, loadAdminTable, adminPageSize, t])

  const testLmStudio = useCallback(async () => {
    setNewsAiTestLoading(true)
    setNewsAiTestResult(null)
    try {
      const qs = newsAiSelectedModel ? `?model=${encodeURIComponent(newsAiSelectedModel)}` : ''
      const res = await fetch(`${API}/ai/test${qs}`)
      const data = await res.json().catch(() => ({}))
      setNewsAiTestResult({ ok: data.ok === true, message: data.message || (res.ok ? t('news.aiTestOk') : data.detail || res.statusText) })
    } catch (e) {
      setNewsAiTestResult({ ok: false, message: e.message || 'Netzwerkfehler' })
    } finally {
      setNewsAiTestLoading(false)
    }
  }, [t, newsAiSelectedModel])

  const askLmStudioTestPrompt = useCallback(async () => {
    const q = (newsAiTestPrompt || '').trim()
    if (!q) return
    setNewsAiTestAskLoading(true)
    setNewsAiTestResponse(null)
    try {
      const body = { question: q, title: '', summary: '' }
      if (newsAiSelectedModel) body.model = newsAiSelectedModel
      const res = await fetch(`${API}/ai/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNewsAiTestResponse({ error: data.detail || res.statusText })
        return
      }
      setNewsAiTestResponse({ answer: data.answer || '' })
    } catch (e) {
      setNewsAiTestResponse({ error: e.message || 'Netzwerkfehler' })
    } finally {
      setNewsAiTestAskLoading(false)
    }
  }, [newsAiTestPrompt, newsAiSelectedModel])

  const askAi = useCallback(async (index, question, title, summary) => {
    if (!(question || '').trim()) return
    setNewsAiLoadingIndex(index)
    setNewsAiResponseByIndex((prev) => ({ ...prev, [index]: null }))
    try {
      const body = { question: (question || '').trim(), title: title || '', summary: summary || '' }
      if (newsAiSelectedModel) body.model = newsAiSelectedModel
      const res = await fetch(`${API}/ai/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNewsAiResponseByIndex((prev) => ({ ...prev, [index]: { question: (question || '').trim(), error: data.detail || res.statusText } }))
        return
      }
      setNewsAiResponseByIndex((prev) => ({ ...prev, [index]: { question: (question || '').trim(), answer: data.answer || '' } }))
    } catch (e) {
      setNewsAiResponseByIndex((prev) => ({ ...prev, [index]: { question: (question || '').trim(), error: e.message } }))
    } finally {
      setNewsAiLoadingIndex(null)
    }
  }, [newsAiSelectedModel])
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

  const newsWsRef = useRef(null)

  const loadNewsHttp = useCallback(async (symbol, forceRefresh = false, source = newsSource) => {
    const sym = (symbol || '').trim()
    const lang = i18n.language && i18n.language.startsWith('en') ? 'en' : 'de'
    setError(null)
    try {
      const res = await fetch(`${API}/news?symbol=${encodeURIComponent(sym)}&limit=15${forceRefresh ? '&refresh=1' : ''}&source=${encodeURIComponent(source)}&lang=${encodeURIComponent(lang)}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNewsFeed([])
        setError(data.detail || res.statusText)
        setNewsLoading(false)
        return
      }
      const feed = Array.isArray(data.feed) ? data.feed : []
      setNewsFeed(feed)
      if (feed.length === 0) setError(sym ? t('news.noNewsForSymbol', { symbol: sym }) : t('news.noNewsDefault'))
      else setError(null)
    } catch (e) {
      setNewsFeed([])
      setError(e.message)
    } finally {
      setNewsLoading(false)
    }
  }, [t, newsSource, i18n.language])

  useEffect(() => {
    if (view !== 'news') return
    const sym = (newsSymbol || '').trim()
    const lang = i18n.language && i18n.language.startsWith('en') ? 'en' : 'de'
    setNewsLoading(true)
    setError(null)
    loadNewsHttp(sym, false, newsSource)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const path = '/api/news/ws'
    const params = new URLSearchParams()
    if (sym) params.set('symbol', sym)
    params.set('source', newsSource)
    params.set('lang', lang)
    const wsUrl = `${protocol}//${host}${path}?${params.toString()}`
    const ws = new WebSocket(wsUrl)
    newsWsRef.current = ws
    ws.onopen = () => {}
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'feed') {
          setNewsFeed(data.feed || [])
          setError(null)
        } else if (data.type === 'error') {
          setError(data.message || 'Fehler')
          setNewsFeed([])
        }
      } catch (_) {}
      setNewsLoading(false)
    }
    ws.onerror = () => setNewsLoading(false)
    ws.onclose = () => setNewsLoading(false)
    return () => {
      ws.close()
      newsWsRef.current = null
    }
  }, [view, newsSymbol, newsSource, newsWsKey, loadNewsHttp, i18n.language])

  const refreshNews = useCallback(() => {
    setNewsWsKey((k) => k + 1)
    setNewsLoading(true)
    loadNewsHttp((newsSymbol || '').trim(), true, newsSource)
  }, [loadNewsHttp, newsSymbol, newsSource])

  // Übersetzungen kommen vom Backend (einmalig pro Meldung in DB gespeichert), keine zusätzlichen /api/translate-Aufrufe

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
  const labelDJIA = t('labels.djia')
  const labelNASDAQ = t('labels.nasdaq')
  const labelBTC = t('labels.btc')
  const labelETH = t('labels.eth')
  const labelLTC = t('labels.ltc')

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
  const [visibleKurseSeries, setVisibleKurseSeries] = useState({ sp500: true, djia: true, nasdaq: true, btc: true, eth: true, ltc: true })
  const toggleSeries = (key) => setVisibleSeries((s) => ({ ...s, [key]: !s[key] }))
  const toggleKurseSeries = (key) => setVisibleKurseSeries((s) => ({ ...s, [key]: !s[key] }))

  const kurseChartData = (() => {
    const byLabel = (lbl) => marketsHistory.filter((r) => r.label === lbl).map((r) => ({ date: r.date, value: Number(r.value) }))
    const sp500 = byLabel(labelSP500)
    const djia = byLabel(labelDJIA)
    const nasdaq = byLabel(labelNASDAQ)
    const btc = byLabel(labelBTC)
    const eth = byLabel(labelETH)
    const ltc = byLabel(labelLTC)
    const allDates = [...new Set([
      ...sp500.map((x) => x.date), ...djia.map((x) => x.date), ...nasdaq.map((x) => x.date),
      ...btc.map((x) => x.date), ...eth.map((x) => x.date), ...ltc.map((x) => x.date),
    ])].filter((d) => d >= '2020-01-01').sort()
    return allDates.map((date) => {
      const s = sp500.find((x) => x.date === date)
      const d = djia.find((x) => x.date === date)
      const n = nasdaq.find((x) => x.date === date)
      const b = btc.find((x) => x.date === date)
      const e = eth.find((x) => x.date === date)
      const l = ltc.find((x) => x.date === date)
      return {
        date,
        sp500: s != null ? s.value : null,
        djia: d != null ? d.value : null,
        nasdaq: n != null ? n.value : null,
        btc: b != null ? b.value : null,
        eth: e != null ? e.value : null,
        ltc: l != null ? l.value : null,
      }
    })
  })()
  const hasKurseData = kurseChartData.length > 0 && kurseChartData.some((d) => d.sp500 != null || d.djia != null || d.nasdaq != null || d.btc != null || d.eth != null || d.ltc != null)

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
            onClick={() => setView('news')}
            style={{
              padding: '0.35rem 0.75rem',
              border: view === 'news' ? '2px solid #2563eb' : '1px solid #ccc',
              borderRadius: 6,
              background: view === 'news' ? '#eff6ff' : '#fff',
              cursor: 'pointer',
              fontSize: '0.95rem',
            }}
          >
            {t('menu.news')}
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
          <button
            type="button"
            onClick={() => setView('konfiguration')}
            style={{
              padding: '0.35rem 0.75rem',
              border: view === 'konfiguration' ? '2px solid #2563eb' : '1px solid #ccc',
              borderRadius: 6,
              background: view === 'konfiguration' ? '#eff6ff' : '#fff',
              cursor: 'pointer',
              fontSize: '0.95rem',
            }}
          >
            {t('menu.konfiguration')}
          </button>
          <button
            type="button"
            onClick={() => setView('admin')}
            style={{
              padding: '0.35rem 0.75rem',
              border: view === 'admin' ? '2px solid #2563eb' : '1px solid #ccc',
              borderRadius: 6,
              background: view === 'admin' ? '#eff6ff' : '#fff',
              cursor: 'pointer',
              fontSize: '0.95rem',
            }}
          >
            {t('menu.admin')}
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
                    {entry.ts && <span style={{ fontVariantNumeric: 'tabular-nums', marginRight: '0.5rem', color: '#64748b' }}>[{entry.ts}]</span>}
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
                    <input type="checkbox" checked={visibleKurseSeries.djia} onChange={() => toggleKurseSeries('djia')} />
                    <span style={{ width: 10, height: 10, backgroundColor: '#059669' }} />
                    <span>{labelDJIA}</span>
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="checkbox" checked={visibleKurseSeries.nasdaq} onChange={() => toggleKurseSeries('nasdaq')} />
                    <span style={{ width: 10, height: 10, backgroundColor: '#dc2626' }} />
                    <span>{labelNASDAQ}</span>
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="checkbox" checked={visibleKurseSeries.btc} onChange={() => toggleKurseSeries('btc')} />
                    <span style={{ width: 10, height: 10, backgroundColor: '#f59e0b' }} />
                    <span>{labelBTC}</span>
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="checkbox" checked={visibleKurseSeries.eth} onChange={() => toggleKurseSeries('eth')} />
                    <span style={{ width: 10, height: 10, backgroundColor: '#6366f1' }} />
                    <span>{labelETH}</span>
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="checkbox" checked={visibleKurseSeries.ltc} onChange={() => toggleKurseSeries('ltc')} />
                    <span style={{ width: 10, height: 10, backgroundColor: '#14b8a6' }} />
                    <span>{labelLTC}</span>
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
                        label={{ value: t('kurse.axisIndices'), angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: 12 } }}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 12 }}
                        tickFormatter={(v) => v.toLocaleString(locale, { maximumFractionDigits: 0 })}
                        label={{ value: 'Krypto (USD)', angle: 90, position: 'insideRight', style: { textAnchor: 'middle', fontSize: 12 } }}
                      />
                      <Tooltip
                        formatter={(value, name) => [value != null ? Number(value).toLocaleString(locale, { maximumFractionDigits: 2 }) : '–', name ?? t('chart.tooltipValue')]}
                        labelFormatter={(label) => `${t('chart.tooltipDate')}: ${formatDate(label)}`}
                      />
                      {visibleKurseSeries.sp500 && <Line type="monotone" dataKey="sp500" name={labelSP500} stroke="#2563eb" strokeWidth={2} dot={false} connectNulls yAxisId="left" />}
                      {visibleKurseSeries.djia && <Line type="monotone" dataKey="djia" name={labelDJIA} stroke="#059669" strokeWidth={2} dot={false} connectNulls yAxisId="left" />}
                      {visibleKurseSeries.nasdaq && <Line type="monotone" dataKey="nasdaq" name={labelNASDAQ} stroke="#dc2626" strokeWidth={2} dot={false} connectNulls yAxisId="left" />}
                      {visibleKurseSeries.btc && <Line type="monotone" dataKey="btc" name={labelBTC} stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls yAxisId="right" />}
                      {visibleKurseSeries.eth && <Line type="monotone" dataKey="eth" name={labelETH} stroke="#6366f1" strokeWidth={2} dot={false} connectNulls yAxisId="right" />}
                      {visibleKurseSeries.ltc && <Line type="monotone" dataKey="ltc" name={labelLTC} stroke="#14b8a6" strokeWidth={2} dot={false} connectNulls yAxisId="right" />}
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
              {(stats.news_total != null || (stats.news_by_symbol && stats.news_by_symbol.length > 0)) && (
                <div>
                  <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>{t('statistik.newsTotal')}</h3>
                  <p style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>{Number(stats.news_total || 0).toLocaleString(locale)}</p>
                  {stats.news_by_symbol && stats.news_by_symbol.length > 0 && (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                          <th style={{ textAlign: 'left', padding: '0.5rem' }}>{t('statistik.symbol')}</th>
                          <th style={{ textAlign: 'right', padding: '0.5rem' }}>{t('statistik.count')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(stats.news_by_symbol || []).map((row, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '0.5rem' }}>{row.symbol}</td>
                            <td style={{ textAlign: 'right', padding: '0.5rem' }}>{Number(row.count).toLocaleString(locale)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          </>
        ) : null}
      </section>
        </>
      ) : view === 'konfiguration' ? (
        <>
      <section style={{ background: '#fff', padding: '1rem', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}>{t('config.title')}</h2>
        <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: '#64748b', maxWidth: '42rem' }}>{t('config.aiModelsHint')}</p>
        <h3 style={{ margin: '1rem 0 0.5rem', fontSize: '1rem', color: '#334155' }}>{t('config.lmStudioTitle')}</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.95rem' }}>
            <span>{t('news.aiModel')}:</span>
            <select
              value={newsAiSelectedModel}
              onChange={(e) => setNewsAiSelectedModel(e.target.value)}
              disabled={newsAiModelsLoading}
              style={{
                padding: '0.35rem 0.5rem',
                fontSize: '0.9rem',
                minWidth: 180,
                maxWidth: 280,
                border: '1px solid #cbd5e1',
                borderRadius: 6,
                background: '#fff',
              }}
            >
              {newsAiModelsLoading ? (
                <option value="">{t('news.aiLoading')}</option>
              ) : newsAiModels.length === 0 ? (
                <option value="">{t('news.aiNoModels')}</option>
              ) : (
                newsAiModels.map((m) => {
                  const label = m.id === 'gemini-2.5-flash' ? t('config.gemini25Flash') : m.id === 'gemini-2.5-pro' ? t('config.gemini25Pro') : m.id === 'claude-sonnet-4-6' ? t('config.sonnet46') : m.id
                  return <option key={m.id} value={m.id}>{label}</option>
                })
              )}
            </select>
          </label>
          <button
            type="button"
            onClick={() => loadLmStudioModels()}
            disabled={newsAiModelsLoading}
            style={{
              padding: '0.35rem 0.6rem',
              fontSize: '0.9rem',
              background: newsAiModelsLoading ? '#94a3b8' : '#e2e8f0',
              color: '#334155',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              cursor: newsAiModelsLoading ? 'not-allowed' : 'pointer',
            }}
          >
            {t('news.refresh')}
          </button>
          <button
            type="button"
            onClick={testLmStudio}
            disabled={newsAiTestLoading}
            style={{
              padding: '0.4rem 0.75rem',
              fontSize: '0.95rem',
              background: newsAiTestLoading ? '#94a3b8' : '#64748b',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: newsAiTestLoading ? 'not-allowed' : 'pointer',
            }}
          >
            {newsAiTestLoading ? t('news.aiLoading') : t('news.aiTest')}
          </button>
        </div>
        {newsAiTestResult && (
          <div
            role="status"
            style={{
              padding: '0.5rem 0.75rem',
              marginBottom: '1rem',
              borderRadius: 6,
              fontSize: '0.9rem',
              background: newsAiTestResult.ok ? '#f0fdf4' : '#fef2f2',
              color: newsAiTestResult.ok ? '#166534' : '#b91c1c',
              border: `1px solid ${newsAiTestResult.ok ? '#bbf7d0' : '#fecaca'}`,
            }}
          >
            {newsAiTestResult.ok ? '✓ ' : '✗ '}{newsAiTestResult.message}
          </div>
        )}
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <input
              type="text"
              value={newsAiTestPrompt}
              onChange={(e) => setNewsAiTestPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') askLmStudioTestPrompt() }}
              placeholder={t('news.aiTestPromptPlaceholder')}
              style={{ padding: '0.4rem 0.6rem', fontSize: '0.95rem', flex: '1', minWidth: 200, maxWidth: 400, border: '1px solid #cbd5e1', borderRadius: 6 }}
            />
            <button
              type="button"
              onClick={askLmStudioTestPrompt}
              disabled={newsAiTestAskLoading || !(newsAiTestPrompt || '').trim()}
              style={{
                padding: '0.4rem 0.75rem',
                fontSize: '0.95rem',
                background: newsAiTestAskLoading || !(newsAiTestPrompt || '').trim() ? '#94a3b8' : '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: newsAiTestAskLoading || !(newsAiTestPrompt || '').trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {newsAiTestAskLoading ? t('news.aiLoading') : t('news.aiTestSend')}
            </button>
          </div>
          {newsAiTestResponse && (
            <div
              role="status"
              style={{
                padding: '0.75rem 1rem',
                marginTop: '0.5rem',
                borderRadius: 6,
                fontSize: '0.9rem',
                background: newsAiTestResponse.error ? '#fef2f2' : '#f0f9ff',
                color: newsAiTestResponse.error ? '#b91c1c' : '#0c4a6e',
                border: `1px solid ${newsAiTestResponse.error ? '#fecaca' : '#bae6fd'}`,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {newsAiTestResponse.error ? newsAiTestResponse.error : newsAiTestResponse.answer}
            </div>
          )}
        </div>
      </section>
      <section style={{ background: '#fff', padding: '1rem', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '1.5rem' }}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: '#334155' }}>{t('config.aiPresetQuestionsTitle')}</h3>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', color: '#64748b' }}>{t('config.aiPresetQuestionsHint')}</p>
        {aiQuestionsConfigLoading ? (
          <p style={{ color: '#64748b', margin: 0 }}>{t('news.loading')}</p>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
              {aiQuestionsConfig.map((q, idx) => (
                <div key={idx} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                  <input
                    type="text"
                    placeholder={t('config.aiQuestionKey')}
                    value={q.key}
                    onChange={(e) => setAiQuestionsConfig(prev => prev.map((r, i) => i === idx ? { ...r, key: e.target.value } : r))}
                    style={{ width: 80, padding: '0.35rem 0.5rem', fontSize: '0.85rem', border: '1px solid #cbd5e1', borderRadius: 4 }}
                  />
                  <input
                    type="text"
                    placeholder="DE"
                    value={q.text_de}
                    onChange={(e) => setAiQuestionsConfig(prev => prev.map((r, i) => i === idx ? { ...r, text_de: e.target.value } : r))}
                    style={{ flex: '1', minWidth: 180, padding: '0.35rem 0.5rem', fontSize: '0.85rem', border: '1px solid #cbd5e1', borderRadius: 4 }}
                  />
                  <input
                    type="text"
                    placeholder="EN"
                    value={q.text_en}
                    onChange={(e) => setAiQuestionsConfig(prev => prev.map((r, i) => i === idx ? { ...r, text_en: e.target.value } : r))}
                    style={{ flex: '1', minWidth: 180, padding: '0.35rem 0.5rem', fontSize: '0.85rem', border: '1px solid #cbd5e1', borderRadius: 4 }}
                  />
                  <input
                    type="number"
                    min={0}
                    value={q.sort_order}
                    onChange={(e) => setAiQuestionsConfig(prev => prev.map((r, i) => i === idx ? { ...r, sort_order: parseInt(e.target.value, 10) || 0 } : r))}
                    style={{ width: 56, padding: '0.35rem 0.5rem', fontSize: '0.85rem', border: '1px solid #cbd5e1', borderRadius: 4 }}
                    title={t('config.aiQuestionSortOrder')}
                  />
                  <button type="button" onClick={() => setAiQuestionsConfig(prev => prev.filter((_, i) => i !== idx))} style={{ padding: '0.35rem 0.5rem', fontSize: '0.85rem', background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 4, cursor: 'pointer' }}>{t('config.adminDelete')}</button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setAiQuestionsConfig(prev => [...prev, { key: '', text_de: '', text_en: '', sort_order: prev.length }])} style={{ padding: '0.4rem 0.75rem', fontSize: '0.9rem', background: '#e2e8f0', color: '#334155', border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer' }}>{t('config.aiPresetQuestionsAdd')}</button>
              <button type="button" onClick={saveAiQuestionsConfig} disabled={aiQuestionsConfigSaving || aiQuestionsConfig.length === 0} style={{ padding: '0.4rem 0.75rem', fontSize: '0.9rem', background: aiQuestionsConfigSaving || aiQuestionsConfig.length === 0 ? '#94a3b8' : '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: aiQuestionsConfigSaving || aiQuestionsConfig.length === 0 ? 'not-allowed' : 'pointer' }}>{aiQuestionsConfigSaving ? t('news.loading') : t('config.adminSave')}</button>
            </div>
            {adminError && <p style={{ margin: '0.5rem 0 0', color: '#b91c1c', fontSize: '0.9rem' }}>{adminError}</p>}
          </>
        )}
      </section>
      <section style={{ background: '#fff', padding: '1rem', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '1.5rem' }}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: '#334155' }}>{t('config.adminTitle')}</h3>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', color: '#64748b' }}>
          {t('config.adminDescription')}
        </p>
        <button
          type="button"
          onClick={() => setView('admin')}
          style={{
            padding: '0.5rem 1rem',
            fontSize: '0.95rem',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          {t('config.adminOpenButton')}
        </button>
      </section>
        </>
      ) : view === 'admin' ? (
        <>
      <section style={{ background: '#fff', padding: '1.25rem', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setView('konfiguration')}
              style={{ padding: '0.35rem 0.6rem', fontSize: '0.9rem', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer' }}
            >
              ← {t('config.adminBack')}
            </button>
            <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#0f172a' }}>{t('config.adminTitle')}</h2>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.9rem' }}>
            <span>{t('config.adminTable')}:</span>
            <select
              value={adminSelectedTable}
              onChange={(e) => { setAdminSelectedTable(e.target.value); setAdminEditRow(null); setAdminOffset(0) }}
              style={{ padding: '0.4rem 0.6rem', fontSize: '0.9rem', minWidth: 160, border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff' }}
            >
              <option value="">{t('config.adminSelectTable')}</option>
              {adminTables.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.9rem' }}>
            <span>{t('config.adminPageSize')}:</span>
            <select
              value={adminPageSize}
              onChange={(e) => { setAdminPageSize(Number(e.target.value)); setAdminOffset(0) }}
              style={{ padding: '0.4rem 0.6rem', fontSize: '0.9rem', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff' }}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </label>
          <button type="button" onClick={() => loadAdminTable(adminOffset, adminPageSize)} disabled={adminLoading || !adminSelectedTable} style={{ padding: '0.4rem 0.75rem', fontSize: '0.9rem', background: adminLoading || !adminSelectedTable ? '#94a3b8' : '#0f172a', color: '#fff', border: 'none', borderRadius: 6, cursor: adminLoading || !adminSelectedTable ? 'not-allowed' : 'pointer' }}>
            {adminLoading ? '…' : t('config.adminRefresh')}
          </button>
          <button type="button" onClick={adminClearTable} disabled={adminLoading || !adminSelectedTable} style={{ padding: '0.4rem 0.75rem', fontSize: '0.9rem', background: adminLoading || !adminSelectedTable ? '#94a3b8' : '#b91c1c', color: '#fff', border: 'none', borderRadius: 6, cursor: adminLoading || !adminSelectedTable ? 'not-allowed' : 'pointer' }} title={t('config.adminClearTableHint')}>
            {t('config.adminClearTable')}
          </button>
          {adminData.total > 0 && (
            <span style={{ fontSize: '0.9rem', color: '#64748b' }}>
              {t('config.adminTotal', { total: adminData.total })}
              {adminData.total > adminPageSize && (
                <span style={{ marginLeft: '0.5rem' }}>
                  ({t('config.adminPage')} {Math.floor(adminOffset / adminPageSize) + 1} / {Math.ceil(adminData.total / adminPageSize)})
                </span>
              )}
            </span>
          )}
        </div>
        {adminData.total > adminPageSize && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <button type="button" onClick={() => adminGoToPage(adminOffset - adminPageSize)} disabled={adminOffset <= 0} style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem', border: '1px solid #cbd5e1', borderRadius: 6, background: adminOffset <= 0 ? '#f1f5f9' : '#fff', cursor: adminOffset <= 0 ? 'not-allowed' : 'pointer' }}>
              {t('config.adminPrev')}
            </button>
            <button type="button" onClick={() => adminGoToPage(adminOffset + adminPageSize)} disabled={adminOffset + adminPageSize >= adminData.total} style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem', border: '1px solid #cbd5e1', borderRadius: 6, background: adminOffset + adminPageSize >= adminData.total ? '#f1f5f9' : '#fff', cursor: adminOffset + adminPageSize >= adminData.total ? 'not-allowed' : 'pointer' }}>
              {t('config.adminNext')}
            </button>
          </div>
        )}
        {adminError && <div role="alert" style={{ marginBottom: '0.75rem', padding: '0.6rem 0.75rem', fontSize: '0.9rem', color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6 }}>{t('config.adminError')}: {adminError}</div>}
        {adminData.columns.length > 0 && (
          <div style={{ overflowX: 'auto', maxHeight: '60vh', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead style={{ position: 'sticky', top: 0, background: '#0f172a', color: '#fff', zIndex: 1 }}>
                <tr>
                  {adminData.columns.map((col) => (
                    <th key={col} style={{ padding: '0.5rem 0.6rem', textAlign: 'left', borderBottom: '1px solid #334155', whiteSpace: 'nowrap' }}>{col}</th>
                  ))}
                  <th style={{ padding: '0.5rem 0.6rem', borderBottom: '1px solid #334155', width: 140, textAlign: 'right' }}>{t('config.adminActions')}</th>
                </tr>
              </thead>
              <tbody>
                {adminData.rows.map((row, idx) => (
                  <tr key={row.rowid ?? idx} style={{ background: adminEditRow?.rowid === row.rowid ? '#fef9c3' : idx % 2 ? '#f8fafc' : undefined }}>
                    {adminEditRow?.rowid === row.rowid ? (
                      <>
                        {adminData.columns.map((col) => (
                          <td key={col} style={{ padding: '0.3rem 0.5rem', borderBottom: '1px solid #e2e8f0', verticalAlign: 'middle' }}>
                            {col === 'rowid' ? String(row[col]) : (
                              <input
                                value={adminEditRow[col] ?? ''}
                                onChange={(e) => setAdminEditRow((prev) => ({ ...prev, [col]: e.target.value }))}
                                style={{ width: '100%', minWidth: 80, padding: '0.25rem 0.4rem', fontSize: '0.85rem', boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 4 }}
                              />
                            )}
                          </td>
                        ))}
                        <td style={{ padding: '0.3rem 0.5rem', borderBottom: '1px solid #e2e8f0', textAlign: 'right' }}>
                          <button type="button" onClick={() => adminSaveRow(adminEditRow)} disabled={adminSaving} style={{ marginRight: 6, padding: '0.25rem 0.5rem', fontSize: '0.8rem', background: '#059669', color: '#fff', border: 'none', borderRadius: 4, cursor: adminSaving ? 'not-allowed' : 'pointer' }}>{t('config.adminSave')}</button>
                          <button type="button" onClick={() => setAdminEditRow(null)} style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', background: '#64748b', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>{t('config.adminCancel')}</button>
                        </td>
                      </>
                    ) : (
                      <>
                        {adminData.columns.map((col) => (
                          <td key={col} style={{ padding: '0.45rem 0.6rem', borderBottom: '1px solid #e2e8f0', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }} title={String(row[col] ?? '')}>{String(row[col] ?? '')}</td>
                        ))}
                        <td style={{ padding: '0.45rem 0.6rem', borderBottom: '1px solid #e2e8f0', textAlign: 'right' }}>
                          <button type="button" onClick={() => setAdminEditRow({ ...row })} style={{ marginRight: 6, padding: '0.25rem 0.5rem', fontSize: '0.8rem', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>{t('config.adminEdit')}</button>
                          <button type="button" onClick={() => adminDeleteRow(row.rowid)} style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>{t('config.adminDelete')}</button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
        </>
      ) : view === 'news' ? (
        <>
      <section style={{ background: '#fff', padding: '1rem', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.1rem' }}>{t('news.title')}</h2>
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: '#64748b' }}>{t('news.symbolHint')} {newsSource === 'all' ? t('news.sourceAllHint') : newsSource === 'finnhub' ? t('news.sourceFinnhubHint') : t('news.tooltipHint')}</p>
        <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: '#64748b' }}>
          {newsSource === 'all' ? (
            <> {t('news.sourceAll')}: <a href="https://www.alphavantage.co/" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>alphavantage.co</a>, <a href="https://finnhub.io/" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>finnhub.io</a> </>
          ) : newsSource === 'finnhub' ? (
            <> {t('news.sourceFinnhub')}: <a href="https://finnhub.io/" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>finnhub.io</a> </>
          ) : (
            <> {t('news.sourceAlphaVantage')}: <a href="https://www.alphavantage.co/" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>alphavantage.co</a> </>
          )}
        </p>
        {error && view === 'news' && (
          <div role="alert" style={{ padding: '0.75rem', background: '#fef2f2', color: '#b91c1c', borderRadius: 6, marginBottom: '1rem', fontSize: '0.9rem' }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.95rem' }}>
            <span>{t('news.newsSource')}:</span>
            <select
              value={newsSource}
              onChange={(e) => { setNewsSource(e.target.value); setNewsWsKey((k) => k + 1); setNewsLoading(true); loadNewsHttp((newsSymbol || '').trim(), true, e.target.value); }}
              style={{ padding: '0.35rem 0.5rem', fontSize: '0.9rem', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff' }}
            >
              <option value="all">{t('news.sourceAll')}</option>
              <option value="alpha_vantage">{t('news.sourceAlphaVantage')}</option>
              <option value="finnhub">{t('news.sourceFinnhub')}</option>
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.95rem' }}>
            <span>{t('news.symbol')}:</span>
            <input
              type="text"
              value={newsSymbol}
              onChange={(e) => setNewsSymbol((e.target.value || '').toUpperCase().slice(0, 6))}
              placeholder="TSLA"
              style={{ padding: '0.4rem 0.6rem', fontSize: '1rem', width: 90, border: '1px solid #cbd5e1', borderRadius: 6 }}
            />
          </label>
          <button
            type="button"
            onClick={refreshNews}
            disabled={newsLoading}
            style={{
              padding: '0.4rem 0.75rem',
              fontSize: '0.95rem',
              background: newsLoading ? '#94a3b8' : '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: newsLoading ? 'not-allowed' : 'pointer',
            }}
          >
            {newsLoading ? t('news.loading') : t('news.refresh')}
          </button>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.95rem', color: '#64748b' }}>
            <span>{t('news.aiModel')}:</span>
            <span style={{ fontWeight: 500 }}>{newsAiSelectedModel || t('news.aiNoModels')}</span>
          </label>
        </div>
        {newsLoading && newsFeed.length === 0 ? (
          <p style={{ color: '#64748b', margin: 0 }}>{t('news.loading')}</p>
        ) : newsFeed.length === 0 ? (
          <p style={{ color: '#64748b', margin: 0 }}>{t('news.noNews')}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {newsFeed.map((item, i) => {
              const ts = item.time_published
              const dateStr = ts ? `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)} ${ts.slice(9, 11)}:${ts.slice(11, 13)}` : ''
              const sentiment = item.ticker_sentiment?.[0]
              const sentLabel = sentiment?.ticker_sentiment_label
              const sentScore = sentiment?.ticker_sentiment_score
              const displayTitle = item.title || ''
              const displaySummary = item.summary || ''
              const apiSource = item.api_source || newsSource
              const sourceBg = apiSource === 'finnhub' ? '#dcfce7' : apiSource === 'alpha_vantage' ? '#dbeafe' : '#f8fafc'
              const sourceBorder = apiSource === 'finnhub' ? '#86efac' : apiSource === 'alpha_vantage' ? '#93c5fd' : '#e2e8f0'
              return (
                <li
                  key={i}
                  style={{
                    padding: '1rem',
                    background: sourceBg,
                    border: `1px solid ${sourceBorder}`,
                    borderRadius: 8,
                  }}
                  title={apiSource === 'finnhub' ? t('news.sourceFinnhub') : apiSource === 'alpha_vantage' ? t('news.sourceAlphaVantage') : ''}
                >
                  <div style={{ marginBottom: '0.5rem' }}>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontWeight: 600, color: '#1e40af', textDecoration: 'none', fontSize: '1rem' }}
                    >
                      {displayTitle || t('news.noTitle')}
                    </a>
                  </div>
                  {displaySummary && (
                    <p style={{ margin: '0.5rem 0', fontSize: '0.9rem', color: '#475569', lineHeight: 1.45 }}>
                      {displaySummary}
                    </p>
                  )}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', fontSize: '0.8rem', color: '#64748b', marginTop: '0.5rem' }}>
                    {newsSource === 'all' && item.api_source && (
                      <span style={{ fontWeight: 600, color: apiSource === 'finnhub' ? '#166534' : '#1e40af' }}>{apiSource === 'finnhub' ? t('news.sourceFinnhub') : t('news.sourceAlphaVantage')}</span>
                    )}
                    {item.source && <span>{t('news.source')}: {item.source}</span>}
                    {dateStr && <span>{formatDate(dateStr.slice(0, 10))} {dateStr.slice(11, 16)}</span>}
                    {sentLabel != null && (
                      <span>
                        {t('news.sentiment')}: {sentLabel}
                        {sentScore != null && ` (${Number(sentScore).toFixed(2)})`}
                      </span>
                    )}
                  </div>
                  <div data-ai-dropdown style={{ position: 'relative', marginTop: '0.75rem' }}>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setNewsAiOpenIndex((prev) => (prev === i ? null : i)) }}
                      style={{
                        padding: '0.35rem 0.6rem',
                        fontSize: '0.85rem',
                        background: '#f1f5f9',
                        border: '1px solid #e2e8f0',
                        borderRadius: 6,
                        cursor: 'pointer',
                        fontWeight: 500,
                      }}
                    >
                      {t('news.aiButton')} ▾
                    </button>
                    {newsAiOpenIndex === i && (
                      <div
                        role="menu"
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: '100%',
                          marginTop: 4,
                          minWidth: 280,
                          background: '#fff',
                          border: '1px solid #e2e8f0',
                          borderRadius: 8,
                          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                          padding: '0.5rem 0',
                          zIndex: 10,
                        }}
                      >
                        {(aiPresetQuestions.length ? aiPresetQuestions : [{ key: 'stocks', text: t('news.aiQuestionStocks') }, { key: 'btc', text: t('news.aiQuestionBtc') }]).map((q) => (
                          <button
                            key={q.key}
                            type="button"
                            role="menuitem"
                            onClick={() => askAi(i, q.text, item.title, item.summary)}
                            disabled={newsAiLoadingIndex === i}
                            style={{ display: 'block', width: '100%', padding: '0.5rem 0.75rem', textAlign: 'left', border: 'none', background: 'none', cursor: newsAiLoadingIndex === i ? 'wait' : 'pointer', fontSize: '0.9rem' }}
                          >
                            {q.text}
                          </button>
                        ))}
                        <div style={{ padding: '0.5rem 0.75rem', borderTop: '1px solid #e2e8f0', display: 'flex', gap: 4 }}>
                          <input
                            type="text"
                            placeholder={t('news.aiCustomPrompt')}
                            value={newsAiCustomPrompt}
                            onChange={(e) => setNewsAiCustomPrompt(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') askAi(i, newsAiCustomPrompt, item.title, item.summary) }}
                            style={{ flex: 1, padding: '0.4rem 0.5rem', fontSize: '0.9rem', border: '1px solid #e2e8f0', borderRadius: 6, boxSizing: 'border-box' }}
                          />
                          <button
                            type="button"
                            onClick={() => askAi(i, newsAiCustomPrompt, item.title, item.summary)}
                            disabled={newsAiLoadingIndex === i}
                            style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                          >
                            {t('news.aiAsk')}
                          </button>
                        </div>
                        {newsAiLoadingIndex === i && (
                          <div style={{ padding: '0.5rem 0.75rem', borderTop: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#64748b' }}>
                            {t('news.aiLoading')}
                          </div>
                        )}
                        {newsAiResponseByIndex[i] && newsAiLoadingIndex !== i && (
                          <div style={{ padding: '0.5rem 0.75rem', borderTop: '1px solid #e2e8f0', fontSize: '0.85rem', maxHeight: 200, overflow: 'auto' }}>
                            {newsAiResponseByIndex[i].error ? (
                              <p style={{ margin: 0, color: '#b91c1c' }}>{newsAiResponseByIndex[i].error}</p>
                            ) : (
                              <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{newsAiResponseByIndex[i].answer}</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
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
                {entry.ts && <span style={{ fontVariantNumeric: 'tabular-nums', marginRight: '0.5rem', color: '#64748b' }}>[{entry.ts}]</span>}
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
                      formatter={(value, name) => [value != null ? Number(value).toLocaleString(locale, { maximumFractionDigits: 2 }) : '–', name ?? t('chart.tooltipValue')]}
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
