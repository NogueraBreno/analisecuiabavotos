import { useEffect, useMemo, useRef, useState } from 'react'
import { geoJSON } from 'leaflet'
import Papa from 'papaparse'
import { GeoJSON, MapContainer, TileLayer, useMap } from 'react-leaflet'
import neighborhoodCsv from './assets/data/Votacao por Secao Zona Bairro Regiao - Cuiaba 2026 - Consolidado por Bairro.csv?raw'
import regionCsv from './assets/data/Votacao por Secao Zona Bairro Regiao - Cuiaba 2026 - Consolidado por Regiao.csv?raw'
import reductionCsv from './assets/data/Votacao por Secao Zona Bairro Regiao - Cuiaba 2026 - Bairros - Pricipais Reduções Votos.csv?raw'
import fairCsv from './assets/data/Votacao por Secao Zona Bairro Regiao - Cuiaba 2026 - Bairros - Feiras.csv?raw'
import './App.css'

const numberFormat = new Intl.NumberFormat('pt-BR')
const CUIABA_CENTER = [-15.601, -56.097]
const CUIABA_ZOOM = 11
const percentFormat = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 1,
})

const metrics = [
  { id: 'plVotes', label: 'Votos PL', format: 'number' },
  { id: 'ptVotes', label: 'Votos PT', format: 'number' },
  { id: 'plShare', label: 'Participação PL', format: 'percent' },
  { id: 'ptShare', label: 'Participação PT', format: 'percent' },
  { id: 'turnout', label: 'Comparecimento', format: 'percent' },
  { id: 'abstention', label: 'Abstenção', format: 'number' },
  { id: 'margin', label: 'Vantagem PL − PT', format: 'number' },
]

const tableSortOptions = [
  { id: 'name', label: 'Bairro', type: 'text' },
  { id: 'region', label: 'Região', type: 'text' },
  { id: 'voters', label: 'Eleitores aptos', type: 'number' },
  { id: 'plVotes', label: 'Votos PL', type: 'number' },
  { id: 'ptVotes', label: 'Votos PT', type: 'number' },
  { id: 'turnout', label: 'Comparecimento', type: 'number' },
  { id: 'abstention', label: 'Abstenção', type: 'number' },
  { id: 'margin', label: 'Vantagem PL − PT', type: 'number' },
  { id: 'reductionDifference', label: 'Diferença (2026 − 2024)', type: 'number' },
]

const coreDetailFields = new Set([
  'qtdsecoes',
  'eleitoresaptos',
  '22pl',
  '13pt',
  'totalvotosnominais',
  'comparecimento',
  'abstencoestotais',
  'vantagem2213',
  'diferenca',
])

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]/g, '')
}

function parseBrazilianNumber(value, isPercent = false) {
  if (value == null || value === '') return 0
  let normalized = String(value).trim().replace(/\s/g, '').replace('%', '')
  if (isPercent) {
    normalized = normalized.replace(',', '.')
  } else {
    normalized = normalized.replace(/\./g, '').replace(',', '.')
  }
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatCsvValue(value, header) {
  if (value == null || String(value).trim() === '') return '—'
  const numericValue = parseBrazilianNumber(value, header.includes('%'))
  if (!Number.isFinite(numericValue)) return value
  return header.includes('%')
    ? `${percentFormat.format(numericValue)}%`
    : numberFormat.format(numericValue)
}

function findColumn(headers, predicate) {
  return headers.find((header) => predicate(normalize(header), header))
}

function parseRegions(csv) {
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: 'greedy' })
  if (parsed.errors.length > 0) {
    throw new Error(`Não foi possível ler o CSV de regiões: ${parsed.errors[0].message}`)
  }

  const headers = parsed.meta.fields ?? []
  const nameColumn = findColumn(headers, (key) => key === 'regiao')
  if (!nameColumn) {
    throw new Error('O CSV de regiões precisa conter a coluna Região.')
  }

  const rows = parsed.data
    .filter((row) => row[nameColumn]?.trim() && normalize(row[nameColumn]) !== 'totalcuiaba')
    .map((row) => ({
      name: row[nameColumn].trim(),
      key: normalize(row[nameColumn]),
      details: headers
        .filter((header) => header !== nameColumn)
        .map((header) => ({
          label: header.trim() || 'Sem título',
          value: formatCsvValue(row[header], header),
        })),
    }))

  if (rows.length === 0) {
    throw new Error('O CSV não contém dados regionais válidos.')
  }
  return rows
}

function parseNeighborhoods(csv, reductionsCsv, fairsCsv) {
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: 'greedy' })
  if (parsed.errors.length > 0) {
    throw new Error(`Não foi possível ler o CSV: ${parsed.errors[0].message}`)
  }

  const headers = parsed.meta.fields ?? []
  const parsedReductions = Papa.parse(reductionsCsv, { header: true, skipEmptyLines: 'greedy' })
  if (parsedReductions.errors.length > 0) {
    throw new Error(`Não foi possível ler o CSV de reduções: ${parsedReductions.errors[0].message}`)
  }
  const reductionHeaders = parsedReductions.meta.fields ?? []
  const reductionNameColumn = findColumn(reductionHeaders, (key) => key === 'bairro')
  const reductionDifferenceColumn = findColumn(reductionHeaders, (key) => key === 'diferenca')
  if (!reductionNameColumn || !reductionDifferenceColumn) {
    throw new Error('O CSV de reduções precisa conter as colunas Bairro e Diferença.')
  }
  const differencesByNeighborhood = new Map(
    parsedReductions.data
      .filter((row) => row[reductionNameColumn]?.trim() && row[reductionDifferenceColumn]?.trim())
      .map((row) => [
        normalize(row[reductionNameColumn]),
        parseBrazilianNumber(row[reductionDifferenceColumn]),
      ]),
  )
  const parsedFairs = Papa.parse(fairsCsv, { header: true, skipEmptyLines: 'greedy' })
  if (parsedFairs.errors.length > 0) {
    throw new Error(`Não foi possível ler o CSV de feiras: ${parsedFairs.errors[0].message}`)
  }
  const fairNameColumn = findColumn(parsedFairs.meta.fields ?? [], (key) => key === 'feira')
  if (!fairNameColumn) {
    throw new Error('O CSV de feiras precisa conter a coluna Feira.')
  }
  const neighborhoodKeysWithFairs = new Set(
    parsedFairs.data
      .filter((row) => row[fairNameColumn]?.trim())
      .map((row) => normalize(row[fairNameColumn])),
  )

  const columns = {
    name: findColumn(headers, (key) => key === 'bairro'),
    region: findColumn(headers, (key) => key === 'regiao'),
    voters: findColumn(headers, (key) => key === 'eleitoresaptos'),
    plVotes: findColumn(
      headers,
      (key, header) => key === '22pl' && !header.trim().startsWith('%'),
    ),
    ptVotes: findColumn(
      headers,
      (key, header) => key === '13pt' && !header.trim().startsWith('%'),
    ),
    turnout: findColumn(
      headers,
      (key, header) => key.includes('comparecimento') && header.includes('%'),
    ),
    abstention: findColumn(headers, (key) => key === 'abstencoestotais'),
    plShare: findColumn(
      headers,
      (key, header) => key === '22pl' && header.includes('%'),
    ),
    ptShare: findColumn(
      headers,
      (key, header) => key === '13pt' && header.includes('%'),
    ),
  }

  const missing = Object.entries(columns)
    .filter(([, value]) => !value)
    .map(([key]) => key)
  if (missing.length) {
    throw new Error(`Colunas obrigatórias ausentes no CSV: ${missing.join(', ')}`)
  }

  const rows = parsed.data
    .filter((row) => row[columns.name]?.trim())
    .map((row) => {
      const plVotes = parseBrazilianNumber(row[columns.plVotes])
      const ptVotes = parseBrazilianNumber(row[columns.ptVotes])
      const neighborhoodKey = normalize(row[columns.name])
      const reductionDifference = differencesByNeighborhood.get(neighborhoodKey)
      const details = headers
        .filter((header) => coreDetailFields.has(normalize(header)))
        .map((header) => ({
          label: header.trim() || 'Sem título',
          value: formatCsvValue(row[header], header),
        }))

      if (reductionDifference !== undefined) {
        details.push({
          label: 'Diferença (2026 − 2024)',
          value: numberFormat.format(reductionDifference),
        })
      }

      return {
        name: row[columns.name].trim(),
        key: neighborhoodKey,
        region: row[columns.region]?.trim() || 'Sem região',
        hasFair: neighborhoodKeysWithFairs.has(neighborhoodKey),
        voters: parseBrazilianNumber(row[columns.voters]),
        plVotes,
        ptVotes,
        plShare: parseBrazilianNumber(row[columns.plShare], true),
        ptShare: parseBrazilianNumber(row[columns.ptShare], true),
        turnout: parseBrazilianNumber(row[columns.turnout], true),
        abstention: parseBrazilianNumber(row[columns.abstention]),
        margin: plVotes - ptVotes,
        reductionDifference,
        details,
      }
    })

  if (rows.length === 0) {
    throw new Error('O CSV não contém linhas de bairros válidas.')
  }
  return rows
}

function formatMetric(value, format = 'number') {
  if (format === 'percent') return `${percentFormat.format(value)}%`
  return numberFormat.format(value)
}

function metricColor(value, metric, extent) {
  if (metric === 'margin') {
    if (value > 0) return value > extent.max * 0.55 ? '#19745c' : '#65a58c'
    if (value < 0) return value < extent.min * 0.55 ? '#b84f54' : '#d58d87'
    return '#e5e9e7'
  }
  const range = extent.max - extent.min || 1
  const strength = Math.max(0, Math.min(1, (value - extent.min) / range))
  const colors = ['#e7f2ed', '#b4d6c8', '#65a58c', '#28775f']
  return colors[Math.min(colors.length - 1, Math.floor(strength * colors.length))]
}

function getFeatureName(feature, field) {
  if (feature.properties?.lookupBoundary) return feature.properties.name
  return feature.properties?.[field]
}

function MapViewport({ boundary, selectedBoundary, recenterKey }) {
  const map = useMap()
  const previousRecenterKey = useRef(recenterKey)

  useEffect(() => {
    if (previousRecenterKey.current !== recenterKey) {
      previousRecenterKey.current = recenterKey
      map.setView(CUIABA_CENTER, CUIABA_ZOOM)
      return
    }

    const features = [
      ...(boundary?.features ?? []),
      ...(selectedBoundary?.features ?? []),
    ]
    if (features.length === 0) return

    const bounds = geoJSON({ type: 'FeatureCollection', features }).getBounds()
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 14 })
    }
  }, [boundary, map, recenterKey, selectedBoundary])

  return null
}

function MapView({
  boundary,
  selectedBoundary,
  boundaryField,
  rowsByName,
  activeRows,
  metric,
  extent,
  selectedName,
  revision,
  recenterKey,
}) {
  const activeKeys = useMemo(() => new Set(activeRows.map((row) => row.key)), [activeRows])
  const rowsByKey = rowsByName

  function tooltipContent(row, name, currentMetric) {
    const content = document.createElement('div')
    const title = document.createElement('strong')
    title.textContent = row?.name ?? String(name ?? 'Bairro sem nome')
    content.append(title, document.createElement('br'))

    if (row) {
      const region = document.createElement('span')
      region.textContent = row.region
      content.append(region, document.createElement('br'))
      const metricLabel = metrics.find((item) => item.id === currentMetric)
      const value = document.createElement('span')
      value.textContent = `${metricLabel?.label}: ${formatMetric(row[currentMetric], metricLabel?.format)}`
      content.append(value)
    } else {
      const missing = document.createElement('span')
      missing.textContent = 'Sem dados no CSV'
      content.append(missing)
    }
    return content
  }

  function styleFeature(feature) {
    const name = normalize(getFeatureName(feature, boundaryField))
    const row = rowsByKey.get(name)
    const isActive = activeKeys.has(name)
    const isSelected = row?.key === selectedName || feature.properties?.lookupBoundary === true
    return {
      color: isSelected ? '#102e27' : '#ffffff',
      weight: isSelected ? 3 : 1.2,
      opacity: 1,
      fillColor: row && isActive ? metricColor(row[metric], metric, extent) : '#d8ddda',
      fillOpacity: row && isActive ? 0.82 : 0.36,
      dashArray: row && isActive ? undefined : '4 4',
    }
  }

  const styleFeatureRef = useRef(styleFeature)
  const metricRef = useRef(metric)
  useEffect(() => {
    styleFeatureRef.current = styleFeature
    metricRef.current = metric
  })

  function bindFeature(feature, layer) {
    const name = getFeatureName(feature, boundaryField)
    const row = rowsByKey.get(normalize(name))
    layer.bindTooltip(tooltipContent(row, name, metricRef.current))
    layer.on({
      mouseover: (event) => {
        event.target.setStyle({ weight: 3, color: '#263d36' })
        event.target.setTooltipContent(tooltipContent(row, name, metricRef.current))
      },
      mouseout: (event) => event.target.setStyle(styleFeatureRef.current(feature)),
    })
  }

  return (
    <MapContainer
      center={CUIABA_CENTER}
      zoom={CUIABA_ZOOM}
      scrollWheelZoom
      className="leaflet-map"
      aria-label="Mapa interativo dos bairros de Cuiabá"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapViewport
        boundary={boundary}
        selectedBoundary={selectedBoundary}
        recenterKey={recenterKey}
      />
      {boundary && (
        <GeoJSON
          key={`${revision}-${boundaryField}`}
          data={boundary}
          style={styleFeature}
          onEachFeature={bindFeature}
        />
      )}
      {selectedBoundary && (
        <GeoJSON
          key={`lookup-${revision}`}
          data={selectedBoundary}
          style={styleFeature}
          onEachFeature={bindFeature}
        />
      )}
    </MapContainer>
  )
}

function App() {
  const fileInput = useRef(null)
  const [boundary, setBoundary] = useState(null)
  const [selectedBoundary, setSelectedBoundary] = useState(null)
  const [boundaryRevision, setBoundaryRevision] = useState(0)
  const [boundaryField, setBoundaryField] = useState('')
  const [boundaryName, setBoundaryName] = useState('')
  const [boundaryError, setBoundaryError] = useState('')
  const [boundaryLoading, setBoundaryLoading] = useState(false)
  const metric = 'plVotes'
  const [region, setRegion] = useState('Todas as regiões')
  const [search, setSearch] = useState('')
  const [selectedName, setSelectedName] = useState(null)
  const [mapRecenterKey, setMapRecenterKey] = useState(0)
  const [sortKey, setSortKey] = useState('name')
  const [sortDirection, setSortDirection] = useState('asc')

  const neighborhoods = useMemo(
    () => parseNeighborhoods(neighborhoodCsv, reductionCsv, fairCsv),
    [],
  )
  const regionRows = useMemo(() => parseRegions(regionCsv), [])
  const regions = useMemo(
    () => [...new Set(neighborhoods.map((item) => item.region))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [neighborhoods],
  )
  const rowsByName = useMemo(
    () => new Map(neighborhoods.map((row) => [row.key, row])),
    [neighborhoods],
  )
  const activeRows = useMemo(
    () =>
      neighborhoods.filter((row) => {
        const matchesRegion = region === 'Todas as regiões' || row.region === region
        const matchesSearch = normalize(row.name).includes(normalize(search))
        return matchesRegion && matchesSearch
      }),
    [neighborhoods, region, search],
  )
  const sortedRows = useMemo(() => {
    const sortOption = tableSortOptions.find((option) => option.id === sortKey)
    return [...activeRows].sort((a, b) => {
      const aValue = a[sortKey]
      const bValue = b[sortKey]
      if (aValue === undefined) return bValue === undefined ? 0 : 1
      if (bValue === undefined) return -1
      const comparison =
        sortOption?.type === 'text'
          ? String(aValue).localeCompare(String(bValue), 'pt-BR')
          : Number(aValue) - Number(bValue)
      return (sortDirection === 'asc' ? 1 : -1) * comparison
    })
  }, [activeRows, sortDirection, sortKey])
  const selectedRow = neighborhoods.find((row) => row.key === selectedName)
  const selectedRegion = regionRows.find((row) => row.key === normalize(region))
  const showingRegionDetails = region !== 'Todas as regiões' && Boolean(selectedRegion)
  const selectedNeighborhoodName = selectedRow?.name
  const selectedNeighborhoodKey = selectedRow?.key
  const totals = activeRows.reduce(
    (total, row) => ({
      voters: total.voters + row.voters,
      plVotes: total.plVotes + row.plVotes,
      ptVotes: total.ptVotes + row.ptVotes,
    }),
    { voters: 0, plVotes: 0, ptVotes: 0 },
  )
  const extent = useMemo(() => {
    const values = neighborhoods.map((row) => row[metric])
    return { min: Math.min(...values), max: Math.max(...values) }
  }, [metric, neighborhoods])
  const featureCount = boundary?.features?.length ?? 0
  const matchedFeatureCount =
    boundary?.features?.filter((feature) => rowsByName.has(normalize(getFeatureName(feature, boundaryField)))).length ?? 0

  function handleBoundaryUpload(event) {
    const [file] = event.target.files ?? []
    if (!file) return
    setBoundaryError('')
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result))
        if (
          data.type !== 'FeatureCollection' ||
          !Array.isArray(data.features) ||
          data.features.some(
            (feature) =>
              !['Polygon', 'MultiPolygon'].includes(feature.geometry?.type) ||
              !feature.properties ||
              typeof feature.properties !== 'object',
          )
        ) {
          throw new Error('Use um GeoJSON FeatureCollection com polígonos e nome dos bairros nas propriedades.')
        }
        const fields = [...new Set(data.features.flatMap((feature) => Object.keys(feature.properties)))]
        const preferredField =
          fields.find((field) => ['bairro', 'nome', 'name', 'neighborhood'].includes(normalize(field))) ??
          fields.find((field) =>
            data.features.some((feature) => typeof feature.properties[field] === 'string'),
          )
        if (!preferredField) {
          throw new Error('O GeoJSON não possui uma propriedade de texto com o nome dos bairros.')
        }
        setBoundary(data)
        setBoundaryRevision((revision) => revision + 1)
        setBoundaryField(preferredField)
        setBoundaryName(file.name)
      } catch (error) {
        setBoundary(null)
        setBoundaryName('')
        setBoundaryError(error instanceof Error ? error.message : 'Não foi possível ler este GeoJSON.')
      }
    }
    reader.onerror = () => {
      setBoundaryError('Não foi possível ler o arquivo selecionado.')
    }
    reader.readAsText(file, 'utf-8')
    event.target.value = ''
  }

  useEffect(() => {
    if (!selectedNeighborhoodName) return undefined
    const controller = new AbortController()

    const timeout = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          q: `${selectedNeighborhoodName}, Cuiabá, Mato Grosso, Brasil`,
          format: 'jsonv2',
          polygon_geojson: '1',
          addressdetails: '1',
          countrycodes: 'br',
          limit: '1',
        })
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?${params}`,
          {
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          },
        )

        if (!response.ok) {
          throw new Error(`A busca de limites falhou (HTTP ${response.status}).`)
        }

        const results = await response.json()
        const result = Array.isArray(results) && results.find((item) =>
          ['Polygon', 'MultiPolygon'].includes(item.geojson?.type),
        )
        if (!result) {
          throw new Error(`Não foi possivel marcar ${selectedNeighborhoodName} no mapa.`)
        }

        setSelectedBoundary({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {
                name: selectedNeighborhoodName,
                lookupBoundary: true,
                displayName: result.display_name,
              },
              geometry: result.geojson,
            },
          ],
        })
        setBoundaryRevision((revision) => revision + 1)
      } catch (error) {
        if (error.name === 'AbortError') return
        setSelectedBoundary(null)
        setBoundaryError(
          error instanceof Error
            ? error.message
          : `Não foi possível buscar o limite de ${selectedNeighborhoodName}.`,
        )
      } finally {
        if (!controller.signal.aborted) setBoundaryLoading(false)
      }
    }, 1000)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [selectedNeighborhoodKey, selectedNeighborhoodName])

  function handleSelectNeighborhood(name) {
    if (name === selectedName) return
    setSelectedName(name)
    setBoundaryError('')
    setBoundaryLoading(Boolean(name))
    if (!name) setSelectedBoundary(null)
  }

  function handleRegionChange(event) {
    setRegion(event.target.value)
    handleSelectNeighborhood(null)
    setMapRecenterKey((key) => key + 1)
  }

  function handleSortChange(key) {
    const option = tableSortOptions.find((item) => item.id === key)
    setSortKey(key)
    setSortDirection(option?.type === 'text' ? 'asc' : 'desc')
  }

  function toggleSortDirection() {
    setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'))
  }



  return (
    <main className="dashboard">
      <section className="page-intro">
        <div>
          <h1>Panorama eleitoral de Cuiabá - Votos para Presidente - 2026</h1>
        </div>        
      </section>

      <section className="metric-cards" aria-label="Resumo eleitoral">
        <article className="metric-card">
          <strong>{numberFormat.format(totals.voters)}</strong>
          <small>{region === 'Todas as regiões' ? 'em todos os bairros' : region}</small>
        </article>
        <article className="metric-card">
          <div className="metric-card-top"><span>VOTOS · PL</span></div>
          <strong>{numberFormat.format(totals.plVotes)}</strong>
          <small>{totals.voters ? percentFormat.format((totals.plVotes / totals.voters) * 100) : '0'}% dos eleitores aptos</small>
        </article>
        <article className="metric-card">
          <div className="metric-card-top"><span>VOTOS · PT</span></div>
          <strong>{numberFormat.format(totals.ptVotes)}</strong>
          <small>{totals.voters ? percentFormat.format((totals.ptVotes / totals.voters) * 100) : '0'}% dos eleitores aptos</small>
        </article>
        <article className="metric-card">
          <div className="metric-card-top"><span>BAIRROS ANALISADOS</span></div>
          <strong>{numberFormat.format(activeRows.length)}</strong>
          <small>{region === 'Todas as regiões' ? `${regions.length} regiões eleitorais` : `região ${region}`}</small>
        </article>
      </section>

      <section className="analysis-layout">
        <article className="panel map-panel">
          <div className="panel-heading map-heading">
            <div>
              <p className="eyebrow">VISÃO GEOGRÁFICA</p>
              <h2>Mapa dos bairros</h2>
            </div>
          </div>
          {boundaryError && <p className="error-message" role="alert">{boundaryError}</p>}
          
          <div className="map-shell">
            <MapView
              boundary={boundary}
              selectedBoundary={selectedBoundary}
              boundaryField={boundaryField}
              rowsByName={rowsByName}
              activeRows={activeRows}
              metric={metric}
              extent={extent}
              selectedName={selectedName}
              revision={boundaryRevision}
              recenterKey={mapRecenterKey}
            />
            <input
              ref={fileInput}
              className="visually-hidden"
              type="file"
              accept=".geojson,.json,application/geo+json,application/json"
              onChange={handleBoundaryUpload}
            />
            {boundaryLoading && (
              <div className="map-empty-state" role="status">
                <strong>Buscando limite do bairro…</strong>
                <span>Consultando o OpenStreetMap.</span>
              </div>
            )}
          </div>
          <div className="map-footer">
            <div className="map-legend">
              <span>{metric === 'margin' ? 'PT à frente' : 'Menor'}</span>
              <i className={metric === 'margin' ? 'legend-diverging' : ''} />
              <span>{metric === 'margin' ? 'PL à frente' : 'Maior'}</span>
            </div>
            <span className="boundary-info">
              {boundary
                ? `${boundaryName} · ${matchedFeatureCount}/${featureCount} bairros associados`
                : selectedBoundary
                  ? `Limite de ${selectedRow?.name} · OpenStreetMap`
                  : 'Limites geográficos não carregados'}
            </span>
          </div>
          {boundary && (
            <div className="boundary-controls">
              <label htmlFor="boundary-field">Propriedade com nome do bairro</label>
              <select
                id="boundary-field"
                value={boundaryField}
                onChange={(event) => setBoundaryField(event.target.value)}
              >
                {[...new Set(boundary.features.flatMap((feature) => Object.keys(feature.properties)))].map((field) => (
                  <option key={field} value={field}>{field}</option>
                ))}
              </select>
            </div>
          )}
        </article>

        <aside className="panel detail-panel">
          <div className="panel-heading detail-heading">
            <div>
              <p className="eyebrow">{showingRegionDetails ? 'CONSULTA POR REGIÃO' : 'CONSULTA POR BAIRRO'}</p>
              <h2>{showingRegionDetails ? 'Detalhes da região' : 'Detalhes do bairro'}</h2>
            </div>
          </div>
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar bairro..."
              aria-label="Buscar bairro"
            />
          </label>
          <label className="region-filter">
            <span>Região</span>
            <select value={region} onChange={handleRegionChange}>
              <option>Todas as regiões</option>
              {regions.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          {showingRegionDetails ? (
            <div className="selected-neighborhood selected-region">
              <span>REGIÃO SELECIONADA</span>
              <strong>{selectedRegion.name}</strong>
            </div>
          ) : selectedRow && (
            <div
              className={`selected-neighborhood ${
                selectedRow.reductionDifference < 0
                  ? 'has-negative-difference'
                  : 'has-positive-difference'
              }`}
            >
              <button type="button" aria-label="Limpar bairro selecionado" onClick={() => handleSelectNeighborhood(null)}>×</button>
              <span>BAIRRO SELECIONADO</span>
              <strong className="selected-neighborhood-name">
                {selectedRow.name}
                {selectedRow.hasFair && (<>
                  <span
                    className="fair-symbol"
                    role="img"
                  >
                    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                      <path d="M3 8h14l-1.1-4H4.1L3 8Z" />
                      <path d="M4 8v9h12V8M7 17v-5h6v5M3 8c0 1.1.9 2 2 2s2-.9 2-2c0 1.1.9 2 2 2s2-.9 2-2c0 1.1.9 2 2 2s2-.9 2-2c0 1.1.9 2 2 2s2-.9 2-2" />
                    </svg>
                  </span>
                  <span>BAIRRO COM FEIRA</span>
                  </>
                )}
              </strong>
              <small>{selectedRow.region}</small>
            </div>
          )}
          {showingRegionDetails ? (
            <dl className="neighborhood-details">
              {selectedRegion.details.map((item) => (
                <div className="detail-item" key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : selectedRow ? (
            <dl className="neighborhood-details">
              {selectedRow.details.map((item) => (
                <div className="detail-item" key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="details-placeholder">
              Selecione uma região ou escolha um bairro na tabela completa abaixo para ver os detalhes.
            </p>
          )}
        </aside>
      </section>

      <section className="panel data-panel">
        <div className="panel-heading table-heading">
          <div>
            <p className="eyebrow">DADOS DETALHADOS</p>
            <h2>Lista completa de bairros</h2>
          </div>
          <div className="table-tools">
            <label htmlFor="table-sort">Ordenar por</label>
            <select
              id="table-sort"
              value={sortKey}
              onChange={(event) => handleSortChange(event.target.value)}
            >
              {tableSortOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
            <button
              className="sort-direction-button"
              type="button"
              onClick={toggleSortDirection}
              aria-label={`Ordenação ${sortDirection === 'asc' ? 'crescente' : 'decrescente'}; inverter`}
              title={`Ordenação ${sortDirection === 'asc' ? 'crescente' : 'decrescente'}`}
            >
              {sortDirection === 'asc' ? '↑' : '↓'}
            </button>
            <span>{numberFormat.format(activeRows.length)} bairros</span>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {tableSortOptions.map((option) => (
                  <th
                    key={option.id}
                    aria-sort={sortKey === option.id ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    <button
                      className="table-sort-button"
                      type="button"
                      onClick={() => {
                        if (sortKey === option.id) {
                          toggleSortDirection()
                        } else {
                          handleSortChange(option.id)
                        }
                      }}
                    >
                      {option.label}
                      <span aria-hidden="true">{sortKey === option.id ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr
                  key={row.key}
                  className={selectedName === row.key ? 'is-selected' : ''}
                >
                  <td>
                    <button
                      className="table-select-button"
                      type="button"
                      aria-pressed={selectedName === row.key}
                      onClick={() => handleSelectNeighborhood(row.key)}
                    >
                      {row.name}
                    </button>
                  </td>
                  <td>{row.region}</td>
                  <td>{numberFormat.format(row.voters)}</td>
                  <td>{numberFormat.format(row.plVotes)}</td>
                  <td>{numberFormat.format(row.ptVotes)}</td>
                  <td>{formatMetric(row.turnout, 'percent')}</td>
                  <td>{numberFormat.format(row.abstention)}</td>
                  <td className={row.margin >= 0 ? 'positive-value' : 'negative-value'}>{numberFormat.format(row.margin)}</td>
                  <td className={row.reductionDifference < 0 ? 'negative-value' : 'positive-value'}>
                    {row.reductionDifference === undefined
                      ? '—'
                      : numberFormat.format(row.reductionDifference)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

export default App
