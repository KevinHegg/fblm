"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CountRecord = { year: number; county: string; fips: string; count: number };
type Person = { name: string; url: string; chamber: string };
type NameRecord = CountRecord & { people: Person[] };
type CountsData = { years: number[]; totals: Record<string, number>; records: CountRecord[] };
type NamesData = { records: NameRecord[] };
type CountyProperties = {
  GEOID: string;
  BASENAME: string;
  INTPTLAT: string;
  INTPTLON: string;
};
type CountyCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, CountyProperties>;

const COMPANION_URL = "https://much-ado.net/legislators/";

function detectAssetBase() {
  if (typeof window === "undefined") return "";
  return window.location.pathname === "/fblm" || window.location.pathname.startsWith("/fblm/")
    ? "/fblm"
    : "";
}

export function MapExperience() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("mapbox-gl").Map | null>(null);
  const popupRef = useRef<import("mapbox-gl").Popup | null>(null);
  const [counts, setCounts] = useState<CountsData | null>(null);
  const [names, setNames] = useState<NamesData | null>(null);
  const [counties, setCounties] = useState<CountyCollection | null>(null);
  const [yearIndex, setYearIndex] = useState(0);
  const [selectedFips, setSelectedFips] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loadingError, setLoadingError] = useState("");
  const [embed, setEmbed] = useState(false);

  const year = counts?.years[yearIndex] ?? 1870;
  const records = useMemo(
    () => counts?.records.filter((record) => record.year === year && record.count > 0) ?? [],
    [counts, year],
  );
  const nameLookup = useMemo(
    () => new Map(names?.records.map((record) => [`${record.year}|${record.fips}`, record]) ?? []),
    [names],
  );
  const selected = selectedFips
    ? records.find((record) => record.fips === selectedFips) ?? null
    : null;
  const selectedNames = selected ? nameLookup.get(`${year}|${selected.fips}`)?.people ?? [] : [];

  const pointData = useCallback(
    (activeRecords: CountRecord[]): GeoJSON.FeatureCollection<GeoJSON.Point> => {
      const byFips = new Map(activeRecords.map((record) => [record.fips, record]));
      return {
        type: "FeatureCollection",
        features: (counties?.features ?? []).flatMap((county) => {
          const record = byFips.get(county.properties.GEOID);
          if (!record) return [];
          return [{
            type: "Feature" as const,
            geometry: {
              type: "Point" as const,
              coordinates: [Number(county.properties.INTPTLON), Number(county.properties.INTPTLAT)],
            },
            properties: { ...record },
          }];
        }),
      };
    },
    [counties],
  );

  useEffect(() => {
    const embedParam = new URLSearchParams(window.location.search).get("embed") === "1";
    queueMicrotask(() => setEmbed(embedParam));
    const base = detectAssetBase();
    Promise.all([
      fetch(`${base}/data/counts.json`).then((response) => response.json()),
      fetch(`${base}/data/legislators.json`).then((response) => response.json()),
      fetch(`${base}/data/ms-counties.geojson`).then((response) => response.json()),
    ])
      .then(([countsResult, namesResult, countiesResult]) => {
        setCounts(countsResult);
        setNames(namesResult);
        setCounties(countiesResult);
      })
      .catch(() => setLoadingError("The historical data could not be loaded."));
  }, []);

  useEffect(() => {
    if (!playing || !counts) return;
    const timer = window.setInterval(() => {
      setYearIndex((current) => (current + 1) % counts.years.length);
    }, 1800);
    return () => window.clearInterval(timer);
  }, [playing, counts]);

  useEffect(() => {
    if (!counties || !counts || !mapContainer.current || mapRef.current) return;
    let cancelled = false;
    const base = detectAssetBase();
    const countyData = counties;
    const countsData = counts;

    async function initializeMap() {
      try {
        const [{ default: mapboxgl }, configResponse] = await Promise.all([
          import("mapbox-gl"),
          fetch(`${base}/config.json`),
        ]);
        const config = await configResponse.json();
        if (!config.mapboxToken) throw new Error("token");
        if (cancelled || !mapContainer.current) return;
        mapboxgl.accessToken = config.mapboxToken;
        const map = new mapboxgl.Map({
          container: mapContainer.current,
          style: "mapbox://styles/mapbox/light-v11",
          center: [-89.75, 32.75],
          zoom: 5.5,
          attributionControl: false,
        });
        mapRef.current = map;
        popupRef.current = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 18 });
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-left");
        map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-left");

        map.on("load", () => {
          map.fitBounds([[-91.72, 30.08], [-88.02, 35.08]], { padding: 28, duration: 0 });
          map.addSource("counties", { type: "geojson", data: countyData });
          map.addLayer({
            id: "county-fill",
            type: "fill",
            source: "counties",
            paint: { "fill-color": "#f6f0e5", "fill-opacity": 0.68 },
          });
          map.addLayer({
            id: "county-lines",
            type: "line",
            source: "counties",
            paint: { "line-color": "#8a7e70", "line-opacity": 0.5, "line-width": 0.8 },
          });
          const initialRecords = countsData.records.filter(
            (record) => record.year === countsData.years[0] && record.count > 0,
          );
          map.addSource("legislators", { type: "geojson", data: pointData(initialRecords) });
          map.addLayer({
            id: "legislator-circles",
            type: "circle",
            source: "legislators",
            paint: {
              "circle-color": "#8f1d2c",
              "circle-stroke-color": "#fffaf1",
              "circle-stroke-width": 2,
              "circle-opacity": 0.92,
              "circle-radius": ["interpolate", ["linear"], ["get", "count"], 1, 13, 5, 27],
            },
          });
          map.addLayer({
            id: "legislator-counts",
            type: "symbol",
            source: "legislators",
            layout: {
              "text-field": ["to-string", ["get", "count"]],
              "text-size": 13,
              "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
              "text-allow-overlap": true,
            },
            paint: { "text-color": "#fffaf1" },
          });

          const showTooltip = (event: import("mapbox-gl").MapMouseEvent & { features?: import("mapbox-gl").MapboxGeoJSONFeature[] }) => {
            const feature = event.features?.[0];
            const properties = (feature as unknown as { properties?: Record<string, string | number> })?.properties;
            if (!properties) return;
            map.getCanvas().style.cursor = "pointer";
            popupRef.current
              ?.setLngLat(event.lngLat)
              .setHTML(`<strong>${properties.county} County</strong><span>${properties.count} legislator${properties.count === 1 ? "" : "s"} in ${properties.year}</span>`)
              .addTo(map);
          };
          map.on("mousemove", "legislator-circles", showTooltip);
          map.on("mouseleave", "legislator-circles", () => {
            map.getCanvas().style.cursor = "";
            popupRef.current?.remove();
          });
          map.on("click", "legislator-circles", (event) => {
            const fips = (event.features?.[0] as unknown as { properties?: { fips?: string } })?.properties?.fips;
            if (fips) setSelectedFips(String(fips));
          });
        });
        map.on("error", (event) => {
          if (String(event.error?.message ?? "").includes("401")) setLoadingError("The map token is not authorized for this address.");
        });
      } catch {
        setLoadingError("The map is ready, but its public Mapbox token still needs to be added.");
      }
    }
    initializeMap();
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
  }, [counties, counts, pointData]);

  useEffect(() => {
    const source = mapRef.current?.getSource("legislators") as import("mapbox-gl").GeoJSONSource | undefined;
    source?.setData(pointData(records));
  }, [records, pointData]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!counts || ["INPUT", "SELECT", "A", "BUTTON"].includes((event.target as HTMLElement).tagName)) return;
      if (event.key === "ArrowLeft") setYearIndex((value) => Math.max(0, value - 1));
      if (event.key === "ArrowRight") setYearIndex((value) => Math.min(counts.years.length - 1, value + 1));
      if (event.key === " ") { event.preventDefault(); setPlaying((value) => !value); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [counts]);

  return (
    <main className={embed ? "site site--embed" : "site"}>
      {!embed && (
        <header className="masthead">
          <a className="eyebrow" href={COMPANION_URL} target="_blank" rel="noreferrer">The companion project ↗</a>
          <h1><a href={COMPANION_URL} target="_blank" rel="noreferrer">Against All Odds: <em>The First Black Legislators in Mississippi</em></a></h1>
          <p>Follow the rise, persistence, and forced retreat of Black political representation across Mississippi’s counties after emancipation.</p>
        </header>
      )}

      <section className="explorer" aria-label="Interactive legislator map and timeline">
        <div className="timeline">
          <div className="timeline__summary">
            <span className="timeline__kicker">Mississippi legislature</span>
            <strong>{year}</strong>
            <span>{counts?.totals[String(year)] ?? 0} legislators · {records.length} counties</span>
          </div>
          <div className="timeline__controls">
            <button type="button" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "Pause timeline" : "Play timeline"} className="play-button">
              {playing ? "Pause" : "Play"}<span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span>
            </button>
            <input
              aria-label="Year"
              type="range"
              min="0"
              max={Math.max(0, (counts?.years.length ?? 1) - 1)}
              value={yearIndex}
              onChange={(event) => { setPlaying(false); setYearIndex(Number(event.target.value)); }}
            />
            <div className="year-ticks" aria-hidden="true">
              <span>1870</span><span>1882</span><span>1894</span>
            </div>
          </div>
        </div>

        <div className="map-layout">
          <div className="map-wrap">
            <div ref={mapContainer} className="map" aria-label={`Map of Black legislators by Mississippi county in ${year}`} />
            {loadingError && <div className="map-message" role="status">{loadingError}</div>}
            <div className="legend"><span className="legend__dot">3</span><span>Circle size and number show legislators serving that county</span></div>
          </div>
          <aside className="detail-panel" aria-live="polite">
            {selected ? (
              <>
                <button className="close-panel" type="button" onClick={() => setSelectedFips(null)} aria-label="Close county details">×</button>
                <span className="detail-panel__year">{year}</span>
                <h2>{selected.county} County</h2>
                <p className="detail-panel__count">{selected.count} legislator{selected.count === 1 ? "" : "s"}</p>
                {selectedNames.length > 0 ? (
                  <ol className="people-list">
                    {selectedNames.map((person) => (
                      <li key={`${person.url}-${person.chamber}`}>
                        <a href={person.url} target="_blank" rel="noreferrer">{person.name}<span>{person.chamber} biography ↗</span></a>
                      </li>
                    ))}
                  </ol>
                ) : <p className="detail-note">No linked profile is available for this county-year.</p>}
                {selectedNames.length !== selected.count && (
                  <p className="detail-note">The workbook records {selected.count}; the companion roster currently links {selectedNames.length} {selectedNames.length === 1 ? "profile" : "profiles"}.</p>
                )}
              </>
            ) : (
              <div className="detail-panel__empty">
                <span aria-hidden="true">↖</span>
                <h2>Select a county</h2>
                <p>Choose a numbered circle to see the legislators serving there and open their biographies.</p>
                <label htmlFor="county-select">Or choose from the active counties</label>
                <select id="county-select" value="" onChange={(event) => setSelectedFips(event.target.value)}>
                  <option value="" disabled>County in {year}</option>
                  {[...records].sort((a, b) => a.county.localeCompare(b.county)).map((record) => <option key={record.fips} value={record.fips}>{record.county} ({record.count})</option>)}
                </select>
              </div>
            )}
          </aside>
        </div>
      </section>

      {!embed && (
        <footer>
          <p>Counts from the project research workbook. Names and biographies from <a href={COMPANION_URL} target="_blank" rel="noreferrer">Against All Odds</a>. County boundaries: U.S. Census Bureau.</p>
          <p>Use ← and → to change year; spacebar to play or pause.</p>
        </footer>
      )}
    </main>
  );
}
