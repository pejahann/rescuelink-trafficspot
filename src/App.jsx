import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from './supabaseClient'

const PERMANENT_USER_LOCATION = [10.2449, 123.8492]

const UNIT_HOME_BASES = {
  1: [10.2492, 123.8435], // Ambulance 1 (Talisay Hall)
  2: [10.2625, 123.8425], // Fire Truck 2 (Tabunok)
  3: [10.2545, 123.8465], // Patrol Car 3 (San Isidro)
  4: [10.2445, 123.8380], // Rescue Squad 4 (Lawaan)
  5: [10.2475, 123.8460], // Police Patrol 5 (Mohon)
}

const createPin = (color, emoji, label = '', size = 34) => {
  const fontSize = Math.round(size * 0.48)
  const borderWidth = size < 28 ? 2 : 3
  return L.divIcon({
    className: 'custom-pin',
    html: `<div style="display:flex; flex-direction:column; align-items:center; transform:translate(-50%, -50%);">
      ${label ? `<span style="background:#0f172a; color:white; padding:2px 7px; border-radius:999px; font-size:11px; font-weight:bold; border:1px solid white; margin-bottom:2px; white-space:nowrap; box-shadow:0 2px 5px rgba(0,0,0,0.5);">${label}</span>` : ''}
      <div style="background:${color}; width:${size}px; height:${size}px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:${borderWidth}px solid white; box-shadow:0 2px 6px rgba(0,0,0,0.4); font-size:${fontSize}px;">${emoji}</div>
    </div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  })
}

const youBlueIcon = createPin('#2563eb', '📍', 'You', 36)
const youSosRedIcon = createPin('#ef4444', '🚨', 'You (SOS)', 36)
const sosIcon = createPin('#ef4444', '🚨', '', 34)
const hazardIcon = createPin('#f59e0b', '🚧', '', 24)
const unitIcon = createPin('#0284c7', '🚑', '', 36)

function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3
  const p1 = (lat1 * Math.PI) / 180
  const p2 = (lat2 * Math.PI) / 180
  const dp = ((lat2 - lat1) * Math.PI) / 180
  const dl = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function isAtPermanentLocation(lat, lng) {
  return (
    Math.abs(lat - PERMANENT_USER_LOCATION[0]) < 0.0001 &&
    Math.abs(lng - PERMANENT_USER_LOCATION[1]) < 0.0001
  )
}

function RecenterMapButton({ isSosOn }) {
  const map = useMap()
  function handleRecenter(e) {
    e.stopPropagation()
    map.flyTo(PERMANENT_USER_LOCATION, 15, { duration: 0.9 })
  }
  return (
    <div style={{ position: 'absolute', top: '14px', left: '14px', zIndex: 1000 }}>
      <button
        type="button"
        onClick={handleRecenter}
        title="Center map back on your location"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '9px 14px',
          background: isSosOn ? '#dc2626' : '#2563eb',
          color: 'white',
          border: '2px solid white',
          borderRadius: '999px',
          fontSize: '13px',
          fontWeight: 'bold',
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.45)',
        }}
      >
        <span>🎯</span>
        <span>Back to You</span>
      </button>
    </div>
  )
}

function MapClickReporter({ enabled, onMapClick }) {
  useMapEvents({
    click(e) {
      if (enabled) onMapClick(e.latlng)
    },
  })
  return null
}

export default function App() {
  const [role, setRole] = useState('CITIZEN')
  const [selectedType, setSelectedType] = useState('Medical')
  const [description, setDescription] = useState('')
  const [statusMsg, setStatusMsg] = useState('')
  const [sosBusy, setSosBusy] = useState(false)

  // Command Center TrafficSpot Reporting State
  const [reportingHazard, setReportingHazard] = useState(false)
  const [hazardType, setHazardType] = useState('Flooding')
  const [hazardDesc, setHazardDesc] = useState('')

  // Responder Detour Toggle
  const [avoidHazards, setAvoidHazards] = useState(false)

  const [myActiveSosId, setMyActiveSosId] = useState(() => {
    const saved = localStorage.getItem('rescuelink_active_sos')
    return saved ? Number(saved) : null
  })

  const [emergencies, setEmergencies] = useState([])
  const [hazards, setHazards] = useState([])
  const [units, setUnits] = useState([])
  const [selectedUnitId, setSelectedUnitId] = useState('')
  const [routes, setRoutes] = useState({})

  const isConfigured =
    import.meta.env.VITE_SUPABASE_URL &&
    import.meta.env.VITE_SUPABASE_URL.startsWith('http') &&
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

  const activeEmergencies = emergencies.filter(
    (e) => e.status !== 'Resolved' && e.status !== 'Canceled'
  )
  const resolvedEmergencies = emergencies.filter((e) => e.status === 'Resolved')

  const myActiveSosList = activeEmergencies.filter(
    (e) => e.id === myActiveSosId || isAtPermanentLocation(e.lat, e.lng)
  )
  const myActiveSos = myActiveSosList[0] || null

  const assignedUnitForMySos = myActiveSos
    ? units.find((u) => u.id === myActiveSos.assigned_unit_id)
    : null
  const hasResponderArrivedForMe = Boolean(
    myActiveSos &&
      assignedUnitForMySos &&
      (assignedUnitForMySos.status === 'On Scene' ||
        getDistanceMeters(
          assignedUnitForMySos.lat,
          assignedUnitForMySos.lng,
          myActiveSos.lat,
          myActiveSos.lng
        ) <= 50)
  )

  useEffect(() => {
    if (myActiveSosId && emergencies.length > 0 && !myActiveSos) {
      setMyActiveSosId(null)
      localStorage.removeItem('rescuelink_active_sos')
    }
  }, [emergencies, myActiveSosId, myActiveSos])

  useEffect(() => {
    if (!isConfigured || !supabase) return
    fetchAll()

    const channel = supabase
      .channel('rescuelink-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emergencies' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'traffic_incidents' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'responder_units' }, fetchAll)
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [isConfigured])

  useEffect(() => {
    async function computeRoutes() {
      const activeDispatches = activeEmergencies.filter(
        (e) => e.status === 'Dispatched' && e.assigned_unit_id
      )
      const newRoutes = {}

      for (const sos of activeDispatches) {
        const unit = units.find((u) => u.id === sos.assigned_unit_id)
        if (!unit) continue

        let coords = [
          [unit.lat, unit.lng],
          [sos.lat, sos.lng],
        ]
        let etaMinutes = 3
        let distanceKm = '1.2'

        try {
          let waypointStr = `${unit.lng},${unit.lat};${sos.lng},${sos.lat}`
          if (avoidHazards) {
            const midLat = (unit.lat + sos.lat) / 2 - 0.004
            const midLng = (unit.lng + sos.lng) / 2 - 0.004
            waypointStr = `${unit.lng},${unit.lat};${midLng},${midLat};${sos.lng},${sos.lat}`
          }

          const res = await fetch(
            `https://router.project-osrm.org/route/v1/driving/${waypointStr}?overview=full&geometries=geojson`
          )
          const json = await res.json()
          if (json.routes && json.routes[0]) {
            coords = json.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng])
            etaMinutes = Math.max(1, Math.round(json.routes[0].duration / 60))
            distanceKm = (json.routes[0].distance / 1000).toFixed(1)
          }
        } catch {
          // Fallback to straight line
        }

        const hazardsOnRoute = hazards.filter(
          (h) =>
            h.verified &&
            coords.some(([rLat, rLng]) => getDistanceMeters(rLat, rLng, h.lat, h.lng) <= 250)
        )

        newRoutes[sos.id] = { coords, hazardsOnRoute, etaMinutes, distanceKm }
      }
      setRoutes(newRoutes)
    }

    if (emergencies.length > 0 && units.length > 0) {
      computeRoutes()
    } else {
      setRoutes({})
    }
  }, [emergencies, units, hazards, avoidHazards])

  async function fetchAll() {
    if (!supabase) return
    const [sosRes, hazRes, unitRes] = await Promise.all([
      supabase.from('emergencies').select('*').order('created_at', { ascending: false }),
      supabase.from('traffic_incidents').select('*').order('created_at', { ascending: false }),
      supabase.from('responder_units').select('*').order('id', { ascending: true }),
    ])
    if (sosRes.error) setStatusMsg(`Database Error: ${sosRes.error.message}`)
    if (sosRes.data) setEmergencies(sosRes.data)
    if (hazRes.data) setHazards(hazRes.data)
    if (unitRes.data) {
      setUnits(unitRes.data)
      if (!selectedUnitId && unitRes.data.length > 0) {
        setSelectedUnitId(String(unitRes.data[0].id))
      }
    }
  }

  async function handleMapHazardDrop(latlng) {
    if (!supabase || !reportingHazard || role !== 'ADMIN') return
    const { error } = await supabase.from('traffic_incidents').insert([
      {
        hazard_type: hazardType,
        description: hazardDesc || `${hazardType} alert issued by Command Center`,
        lat: latlng.lat,
        lng: latlng.lng,
        verified: true,
      },
    ])
    if (error) {
      setStatusMsg(`Hazard Broadcast Error: ${error.message}`)
    } else {
      setReportingHazard(false)
      setHazardDesc('')
      setStatusMsg(`🚧 Command Center published active ${hazardType} hazard on the map!`)
      await fetchAll()
    }
  }

  async function handleSosButton() {
    if (!isConfigured || !supabase || sosBusy) return
    setSosBusy(true)

    try {
      if (myActiveSosList.length > 0) {
        const idsToCancel = myActiveSosList.map((e) => e.id)
        const unitIdsToFree = myActiveSosList
          .map((e) => e.assigned_unit_id)
          .filter(Boolean)

        const { error: delError } = await supabase
          .from('emergencies')
          .delete()
          .in('id', idsToCancel)

        if (delError) {
          const { error: updError } = await supabase
            .from('emergencies')
            .update({ status: 'Canceled' })
            .in('id', idsToCancel)

          if (updError) {
            setStatusMsg(`Cancel Error: ${updError.message}`)
            return
          }
        }

        for (const uId of unitIdsToFree) {
          const home = UNIT_HOME_BASES[uId] || [10.2492, 123.8435]
          await supabase
            .from('responder_units')
            .update({ status: 'Available', lat: home[0], lng: home[1] })
            .eq('id', uId)
        }

        setMyActiveSosId(null)
        setAvoidHazards(false)
        localStorage.removeItem('rescuelink_active_sos')
        setStatusMsg('✅ Accidental SOS canceled. Your "You" pin is back to blue.')
        await fetchAll()
      } else {
        const [lat, lng] = PERMANENT_USER_LOCATION
        const { data, error } = await supabase
          .from('emergencies')
          .insert([
            {
              emergency_type: selectedType,
              description: description || `${selectedType} emergency at Talisay fixed location`,
              lat,
              lng,
              status: 'Pending',
            },
          ])
          .select()
          .single()

        if (error) {
          setStatusMsg(`Error: ${error.message}`)
        } else if (data) {
          setMyActiveSosId(data.id)
          localStorage.setItem('rescuelink_active_sos', String(data.id))
          setDescription('')
          setStatusMsg('🚨 SOS Sent! Your "You" pin is now RED. Press the button again to cancel.')
          await fetchAll()
        }
      }
    } finally {
      setSosBusy(false)
    }
  }

  async function handleDispatch(emergencyId, unitId) {
    if (!unitId) return alert('Select a responder unit first!')
    await supabase.from('emergencies').update({ status: 'Dispatched', assigned_unit_id: Number(unitId) }).eq('id', emergencyId)
    await supabase.from('responder_units').update({ status: 'Dispatched' }).eq('id', Number(unitId))
    setStatusMsg('🚑 Responder unit dispatched with live route & ETA!')
  }

  async function handleToggleHazardStatus(hazardId, currentVerified) {
    await supabase
      .from('traffic_incidents')
      .update({ verified: !currentVerified })
      .eq('id', hazardId)
    await fetchAll()
  }

  async function handleDeleteHazard(hazardId) {
    await supabase.from('traffic_incidents').delete().eq('id', hazardId)
    await fetchAll()
    setStatusMsg('🗑️ Hazard removed from map.')
  }

  async function handleResolve(emergencyId, unitId) {
    await supabase.from('emergencies').update({ status: 'Resolved' }).eq('id', emergencyId)
    if (unitId) {
      const home = UNIT_HOME_BASES[unitId] || [10.2492, 123.8435]
      await supabase
        .from('responder_units')
        .update({ status: 'Available', lat: home[0], lng: home[1] })
        .eq('id', unitId)
    }
    if (emergencyId === myActiveSosId) {
      setMyActiveSosId(null)
      localStorage.removeItem('rescuelink_active_sos')
    }
    setAvoidHazards(false)
    await fetchAll()
    setStatusMsg('✅ Emergency resolved & logged to history. Responder returned to base!')
  }

  async function simulateDrive(sos) {
    const routeInfo = routes[sos.id]
    if (!routeInfo || routeInfo.coords.length < 2) return

    const responderUnit = units.find((u) => u.id === sos.assigned_unit_id)
    const unitLabel = responderUnit ? responderUnit.unit_name : 'Responder unit'

    setStatusMsg(`🚑 ${unitLabel} is en route (ETA: ~${routeInfo.etaMinutes} min)...`)
    const step = Math.max(1, Math.floor(routeInfo.coords.length / 8))

    for (let i = 0; i < routeInfo.coords.length; i += step) {
      const [lat, lng] = routeInfo.coords[i]
      await supabase
        .from('responder_units')
        .update({ lat, lng })
        .eq('id', sos.assigned_unit_id)
      await new Promise((r) => setTimeout(r, 700))
    }

    await supabase
      .from('responder_units')
      .update({ lat: sos.lat, lng: sos.lng, status: 'On Scene' })
      .eq('id', sos.assigned_unit_id)

    await fetchAll()
    setStatusMsg(`🔔 REMINDER: ${unitLabel} has arrived at the emergency scene!`)
  }

  const isSosOn = myActiveSosList.length > 0

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', height: '100vh', display: 'flex', flexDirection: 'column', background: '#0f172a', color: '#f8fafc' }}>
      <style>{`
        .compact-map-label {
          background: rgba(15, 23, 42, 0.85) !important;
          color: #f8fafc !important;
          border: 1px solid rgba(255, 255, 255, 0.25) !important;
          border-radius: 4px !important;
          padding: 1px 5px !important;
          font-size: 10px !important;
          line-height: 1.25 !important;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4) !important;
          pointer-events: none !important;
          white-space: nowrap !important;
        }
        .compact-map-label::before {
          display: none !important;
        }
      `}</style>

      <header style={{ padding: '12px 20px', background: '#1e293b', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <strong style={{ fontSize: '18px' }}>🚨 RescueLink & 🚧 TrafficSpot</strong>
          <span style={{ marginLeft: '10px', fontSize: '12px', color: '#94a3b8' }}>Group 4 Geospatial Dispatch & Hazard Map</span>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          {['CITIZEN', 'ADMIN', 'RESPONDER'].map((r) => (
            <button
              key={r}
              onClick={() => { setRole(r); setReportingHazard(false) }}
              style={{
                padding: '8px 14px',
                borderRadius: '6px',
                border: 'none',
                fontWeight: 'bold',
                cursor: 'pointer',
                background: role === r ? '#3b82f6' : '#334155',
                color: 'white',
              }}
            >
              {r === 'CITIZEN' ? '👤 Citizen' : r === 'ADMIN' ? '🖥️ Command Center' : '🚑 Responder'}
            </button>
          ))}
        </div>
      </header>

      {!isConfigured && (
        <div style={{ background: '#dc2626', color: 'white', padding: '10px 20px', fontSize: '13px', fontWeight: 'bold' }}>
          ⚠️ Supabase keys not detected in .env.local! Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, then restart npm run dev.
        </div>
      )}

      {statusMsg && (
        <div style={{ background: statusMsg.includes('REMINDER') ? '#15803d' : '#1d4ed8', color: 'white', padding: '9px 20px', fontSize: '13px', fontWeight: statusMsg.includes('REMINDER') ? 'bold' : 'normal', display: 'flex', justifyContent: 'space-between' }}>
          <span>{statusMsg}</span>
          <button onClick={() => setStatusMsg('')} style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <aside style={{ width: '370px', background: '#1e293b', padding: '16px', overflowY: 'auto', borderRight: '1px solid #334155' }}>
          {role === 'CITIZEN' && (
            <div>
              <h3 style={{ marginTop: 0 }}>🚨 RescueLink Emergency SOS</h3>

              <div style={{ background: '#0f172a', padding: '10px', borderRadius: '6px', marginBottom: '12px', fontSize: '12px', borderLeft: `4px solid ${isSosOn ? '#ef4444' : '#2563eb'}` }}>
                📍 <b>Stationary Location ("You"):</b> Talisay City ({PERMANENT_USER_LOCATION[0]}, {PERMANENT_USER_LOCATION[1]})
              </div>

              {hasResponderArrivedForMe && (
                <div style={{ background: '#14532d', border: '2px solid #22c55e', padding: '12px', borderRadius: '8px', marginBottom: '12px', fontSize: '13px', color: '#dcfce7' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '4px' }}>
                    🔔 Responder Has Arrived!
                  </div>
                  <b>{assignedUnitForMySos.unit_name}</b> is now on scene at your location.
                </div>
              )}

              {!isSosOn ? (
                <>
                  <label style={{ fontSize: '12px', color: '#94a3b8' }}>Emergency Type</label>
                  <select
                    value={selectedType}
                    onChange={(e) => setSelectedType(e.target.value)}
                    style={{ width: '100%', padding: '8px', marginTop: '4px', marginBottom: '10px', borderRadius: '6px', background: '#0f172a', color: 'white', border: '1px solid #475569' }}
                  >
                    <option value="Medical">Medical Emergency</option>
                    <option value="Fire">Fire Incident</option>
                    <option value="Vehicular Accident">Vehicular Accident</option>
                    <option value="Crime / Security">Crime / Security</option>
                  </select>

                  <label style={{ fontSize: '12px', color: '#94a3b8' }}>Details / Landmarks</label>
                  <input
                    type="text"
                    placeholder="e.g., Near South Road intersection"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '8px', marginTop: '4px', marginBottom: '12px', borderRadius: '6px', background: '#0f172a', color: 'white', border: '1px solid #475569' }}
                  />
                </>
              ) : (
                <div style={{ background: '#7f1d1d', border: '1px solid #ef4444', padding: '10px', borderRadius: '6px', marginBottom: '12px', fontSize: '12px', color: '#fecaca' }}>
                  <b>🚨 Active SOS ({myActiveSos.status}):</b> {myActiveSos.emergency_type} — {myActiveSos.description}
                  {routes[myActiveSos.id] && (
                    <div style={{ marginTop: '4px', color: '#fde047' }}>
                      ⏱️ Estimated Responder Arrival: <b>~{routes[myActiveSos.id].etaMinutes} min</b> ({routes[myActiveSos.id].distanceKm} km)
                    </div>
                  )}
                </div>
              )}

              <button
                type="button"
                disabled={sosBusy}
                onClick={handleSosButton}
                style={{
                  width: '100%',
                  padding: '14px',
                  marginBottom: '16px',
                  background: isSosOn ? '#334155' : '#ef4444',
                  color: 'white',
                  border: isSosOn ? '2px solid #ef4444' : 'none',
                  borderRadius: '8px',
                  fontSize: '15px',
                  fontWeight: 'bold',
                  cursor: sosBusy ? 'wait' : 'pointer',
                  boxShadow: isSosOn ? 'none' : '0 4px 14px rgba(239,68,68,0.45)',
                }}
              >
                {isSosOn ? '✖ Cancel Accidental SOS (Turn Pin Blue)' : '🚨 Send SOS Alert (Turn Pin Red)'}
              </button>

              <hr style={{ borderColor: '#334155' }} />
              <h4>🚧 TrafficSpot Public Advisories ({hazards.filter(h => h.verified).length} Active)</h4>
              <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: '-6px' }}>
                Official road hazards issued by Command Center:
              </p>
              {hazards.filter(h => h.verified).length === 0 && (
                <p style={{ fontSize: '12px', color: '#22c55e' }}>✅ All major Talisay roads are clear.</p>
              )}
              {hazards.filter(h => h.verified).map((h) => (
                <div key={h.id} style={{ background: '#0f172a', padding: '10px', borderRadius: '6px', marginBottom: '8px', borderLeft: '4px solid #f59e0b' }}>
                  <strong>🚧 {h.hazard_type}</strong> <span style={{ fontSize: '11px', color: '#fbbf24' }}>⚠️ Active Advisory</span>
                  <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>{h.description}</div>
                </div>
              ))}
            </div>
          )}

          {role === 'ADMIN' && (
            <div>
              <h3 style={{ marginTop: 0 }}>🖥️ Command Center Dashboard</h3>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', fontSize: '12px' }}>
                <div style={{ flex: 1, background: '#0f172a', padding: '8px', borderRadius: '6px', textAlign: 'center' }}>
                  <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#ef4444' }}>{activeEmergencies.length}</div>
                  Active SOS
                </div>
                <div style={{ flex: 1, background: '#0f172a', padding: '8px', borderRadius: '6px', textAlign: 'center' }}>
                  <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#3b82f6' }}>{units.filter(u => u.status === 'Available').length}</div>
                  Units Ready
                </div>
                <div style={{ flex: 1, background: '#0f172a', padding: '8px', borderRadius: '6px', textAlign: 'center' }}>
                  <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#22c55e' }}>{resolvedEmergencies.length}</div>
                  Resolved
                </div>
              </div>

              <h4>Active SOS Emergencies</h4>
              {activeEmergencies.length === 0 && <p style={{ fontSize: '13px', color: '#94a3b8' }}>No active SOS alerts.</p>}
              {activeEmergencies.map((sos) => {
                const assignedUnit = units.find((u) => u.id === sos.assigned_unit_id)
                const arrived =
                  assignedUnit &&
                  (assignedUnit.status === 'On Scene' ||
                    getDistanceMeters(assignedUnit.lat, assignedUnit.lng, sos.lat, sos.lng) <= 50)
                return (
                  <div key={sos.id} style={{ background: '#0f172a', padding: '12px', borderRadius: '6px', marginBottom: '10px', borderLeft: `4px solid ${arrived ? '#22c55e' : '#ef4444'}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <strong>🚨 {sos.emergency_type}</strong>
                      <span style={{ fontSize: '12px', background: arrived ? '#15803d' : '#334155', padding: '2px 6px', borderRadius: '4px' }}>
                        {arrived ? 'Responder On Scene 🔔' : sos.status}
                      </span>
                    </div>
                    <p style={{ fontSize: '12px', color: '#cbd5e1', margin: '6px 0' }}>{sos.description}</p>

                    {arrived && (
                      <div style={{ fontSize: '12px', color: '#86efac', marginTop: '4px' }}>
                        🔔 Reminder: <b>{assignedUnit.unit_name}</b> has arrived at the emergency scene.
                      </div>
                    )}

                    {sos.status === 'Pending' && (
                      <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                        <select
                          value={selectedUnitId}
                          onChange={(e) => setSelectedUnitId(e.target.value)}
                          style={{ flex: 1, padding: '6px', borderRadius: '4px', background: '#1e293b', color: 'white', border: '1px solid #475569' }}
                        >
                          {units.filter(u => u.status === 'Available').map((u) => (
                            <option key={u.id} value={u.id}>{u.unit_name}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleDispatch(sos.id, selectedUnitId)}
                          style={{ padding: '6px 10px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                        >
                          Dispatch
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}

              <hr style={{ borderColor: '#334155' }} />
              <h4>🚧 TrafficSpot Hazard Control</h4>

              <div style={{ background: '#0f172a', padding: '10px', borderRadius: '6px', marginBottom: '12px', border: '1px solid #334155' }}>
                <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '6px', color: '#fbbf24' }}>
                  📢 Issue Official Road Hazard Pin:
                </div>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                  <select
                    value={hazardType}
                    onChange={(e) => setHazardType(e.target.value)}
                    style={{ flex: 1, padding: '6px', borderRadius: '4px', background: '#1e293b', color: 'white', border: '1px solid #475569', fontSize: '12px' }}
                  >
                    <option value="Flooding">Flooding</option>
                    <option value="Heavy Traffic">Heavy Traffic</option>
                    <option value="Roadblock">Roadblock</option>
                    <option value="Accident">Accident</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Street / landmark..."
                    value={hazardDesc}
                    onChange={(e) => setHazardDesc(e.target.value)}
                    style={{ flex: 1.3, padding: '6px', borderRadius: '4px', background: '#1e293b', color: 'white', border: '1px solid #475569', fontSize: '12px' }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setReportingHazard(!reportingHazard)}
                  style={{
                    width: '100%',
                    padding: '8px',
                    background: reportingHazard ? '#d97706' : '#2563eb',
                    color: 'white',
                    border: reportingHazard ? '1px solid #fde047' : 'none',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                  }}
                >
                  {reportingHazard ? '📍 Click Anywhere on Map to Drop Pin (Cancel)' : '🚧 Pin New Hazard on Map'}
                </button>
              </div>

              {hazards.map((h) => (
                <div key={h.id} style={{ background: '#0f172a', padding: '10px', borderRadius: '6px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                  <div style={{ flex: 1 }}>
                    <strong style={{ fontSize: '13px' }}>🚧 {h.hazard_type}</strong>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>{h.description}</div>
                  </div>
                  <button
                    onClick={() => handleToggleHazardStatus(h.id, h.verified)}
                    style={{ padding: '5px 7px', background: h.verified ? '#f59e0b' : '#22c55e', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', whiteSpace: 'nowrap' }}
                  >
                    {h.verified ? 'Active ⚠️' : 'Cleared ✓'}
                  </button>
                  <button
                    onClick={() => handleDeleteHazard(h.id)}
                    title="Delete hazard"
                    style={{ padding: '5px 7px', background: '#334155', color: '#f87171', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}
                  >
                    ✕
                  </button>
                </div>
              ))}

              {resolvedEmergencies.length > 0 && (
                <>
                  <hr style={{ borderColor: '#334155' }} />
                  <h4>✅ Resolved Incident History ({resolvedEmergencies.length})</h4>
                  {resolvedEmergencies.slice(0, 5).map((item) => (
                    <div key={item.id} style={{ background: '#0f172a', padding: '8px', borderRadius: '6px', marginBottom: '6px', fontSize: '11px', color: '#94a3b8', borderLeft: '3px solid #22c55e' }}>
                      <strong style={{ color: '#e2e8f0' }}>{item.emergency_type}</strong> — {item.description}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {role === 'RESPONDER' && (
            <div>
              <h3 style={{ marginTop: 0 }}>🚑 Responder Unit View</h3>
              <label style={{ fontSize: '12px', color: '#94a3b8' }}>Select Your Unit</label>
              <select
                value={selectedUnitId}
                onChange={(e) => setSelectedUnitId(e.target.value)}
                style={{ width: '100%', padding: '8px', marginTop: '4px', marginBottom: '16px', borderRadius: '6px', background: '#0f172a', color: 'white', border: '1px solid #475569' }}
              >
                {units.map((u) => (
                  <option key={u.id} value={u.id}>{u.unit_name} ({u.status})</option>
                ))}
              </select>

              <h4>Assigned Dispatches</h4>
              {activeEmergencies.filter((e) => e.status === 'Dispatched' && String(e.assigned_unit_id) === String(selectedUnitId)).length === 0 && (
                <p style={{ fontSize: '13px', color: '#94a3b8' }}>No active dispatches for this unit.</p>
              )}
              {activeEmergencies
                .filter((e) => e.status === 'Dispatched' && String(e.assigned_unit_id) === String(selectedUnitId))
                .map((sos) => {
                  const routeInfo = routes[sos.id]
                  const blocked = routeInfo && routeInfo.hazardsOnRoute.length > 0
                  const currentUnit = units.find((u) => u.id === sos.assigned_unit_id)
                  const arrived =
                    currentUnit &&
                    (currentUnit.status === 'On Scene' ||
                      getDistanceMeters(currentUnit.lat, currentUnit.lng, sos.lat, sos.lng) <= 50)

                  return (
                    <div key={sos.id} style={{ background: '#0f172a', padding: '12px', borderRadius: '6px', borderLeft: `4px solid ${arrived ? '#22c55e' : '#3b82f6'}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong>🚨 {sos.emergency_type}</strong>
                        {routeInfo && (
                          <span style={{ fontSize: '11px', background: '#1e3a8a', color: '#93c5fd', padding: '2px 7px', borderRadius: '999px', fontWeight: 'bold' }}>
                            ETA: ~{routeInfo.etaMinutes} min ({routeInfo.distanceKm} km)
                          </span>
                        )}
                      </div>
                      <p style={{ fontSize: '13px', color: '#cbd5e1' }}>{sos.description}</p>

                      {arrived && (
                        <div style={{ background: '#14532d', border: '1px solid #22c55e', padding: '9px', borderRadius: '6px', fontSize: '12px', color: '#dcfce7', marginBottom: '10px' }}>
                          🔔 <b>ARRIVAL REMINDER:</b> You have arrived at the emergency scene! Assist the victim, then click <b>Mark Emergency Resolved</b> below when finished.
                        </div>
                      )}

                      {blocked ? (
                        <div style={{ background: '#7f1d1d', border: '1px solid #ef4444', padding: '8px', borderRadius: '6px', fontSize: '12px', marginBottom: '10px' }}>
                          ⚠️ <b>ROUTE HAZARD ALERT:</b> {routeInfo.hazardsOnRoute.map((h) => h.hazard_type).join(', ')} detected within 250m of your path!
                          {!avoidHazards && (
                            <button
                              type="button"
                              onClick={() => setAvoidHazards(true)}
                              style={{ display: 'block', width: '100%', marginTop: '6px', padding: '6px', background: '#f59e0b', color: '#0f172a', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}
                            >
                              🔄 Compute Alternate Detour Route
                            </button>
                          )}
                        </div>
                      ) : (
                        <p style={{ fontSize: '12px', color: '#22c55e' }}>
                          ✅ {avoidHazards ? 'Detour route active — clear of hazards.' : 'Route clear of TrafficSpot hazards.'}
                        </p>
                      )}

                      {!arrived && (
                        <button
                          onClick={() => simulateDrive(sos)}
                          style={{ width: '100%', padding: '9px', marginBottom: '8px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}
                        >
                          ▶️ Simulate Live Drive to Scene
                        </button>
                      )}

                      <button
                        onClick={() => handleResolve(sos.id, sos.assigned_unit_id)}
                        style={{ width: '100%', padding: '10px', background: '#22c55e', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}
                      >
                        Mark Emergency Resolved
                      </button>
                    </div>
                  )
                })}
            </div>
          )}
        </aside>

        <main style={{ flex: 1, position: 'relative' }}>
          {reportingHazard && role === 'ADMIN' && (
            <div style={{ position: 'absolute', top: '14px', right: '14px', zIndex: 1000, background: '#d97706', color: 'white', padding: '8px 14px', borderRadius: '999px', fontSize: '12px', fontWeight: 'bold', boxShadow: '0 4px 12px rgba(0,0,0,0.4)' }}>
              📍 Command Center Mode: Click on any road to drop a {hazardType} pin
            </div>
          )}

          <MapContainer
            center={PERMANENT_USER_LOCATION}
            zoom={14}
            zoomControl={false}
            style={{ height: '100%', width: '100%', cursor: reportingHazard && role === 'ADMIN' ? 'crosshair' : 'grab' }}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <MapClickReporter enabled={reportingHazard && role === 'ADMIN'} onMapClick={handleMapHazardDrop} />
            <RecenterMapButton isSosOn={isSosOn} />

            {!isSosOn && (
              <Marker position={PERMANENT_USER_LOCATION} icon={youBlueIcon} zIndexOffset={600}>
                <Popup>📍 <b>You</b> (Permanent Location — Talisay City)<br />Press "Send SOS Alert" to request emergency help.</Popup>
              </Marker>
            )}

            {activeEmergencies.map((sos) => {
              const isMine = isAtPermanentLocation(sos.lat, sos.lng)
              const routeInfo = routes[sos.id]
              const hasHazard = routeInfo && routeInfo.hazardsOnRoute.length > 0
              return (
                <div key={`sos-group-${sos.id}`}>
                  <Marker position={[sos.lat, sos.lng]} icon={isMine ? youSosRedIcon : sosIcon} zIndexOffset={600}>
                    <Tooltip permanent direction="bottom" offset={[0, 18]} className="compact-map-label">
                      {sos.emergency_type}: {sos.description}
                    </Tooltip>
                    <Popup>
                      <strong>🚨 {sos.emergency_type} {isMine ? '(You)' : ''}</strong><br />
                      {sos.description}<br />
                      Status: <b>{sos.status}</b>
                    </Popup>
                  </Marker>
                  {routeInfo && (
                    <Polyline
                      positions={routeInfo.coords}
                      pathOptions={{ color: hasHazard ? '#ef4444' : '#3b82f6', weight: 5 }}
                    />
                  )}
                </div>
              )
            })}

            {hazards
              .filter((h) => h.verified)
              .map((h) => (
                <Marker key={`haz-${h.id}`} position={[h.lat, h.lng]} icon={hazardIcon} zIndexOffset={-100}>
                  <Tooltip permanent direction="right" offset={[12, 0]} className="compact-map-label">
                    {h.hazard_type}: {h.description}
                  </Tooltip>
                  <Popup>
                    <strong>🚧 TrafficSpot: {h.hazard_type}</strong><br />
                    {h.description}
                  </Popup>
                </Marker>
              ))}

            {units.map((u) => (
              <Marker key={`unit-${u.id}`} position={[u.lat, u.lng]} icon={unitIcon} zIndexOffset={500}>
                <Tooltip permanent direction="right" offset={[16, 0]} className="compact-map-label">
                  {u.unit_name} ({u.status})
                </Tooltip>
                <Popup>
                  <strong>🚑 {u.unit_name}</strong><br />
                  Type: {u.unit_type}<br />
                  Status: <b>{u.status}</b>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </main>
      </div>
    </div>
  )
}