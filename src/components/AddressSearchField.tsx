import { useState } from 'react';
import { MapPin, Search, Loader2, Check } from 'lucide-react';
import { apiRequest } from '../api';
import type { GeocodeResult } from '../types';

interface AddressValues {
  street: string;
  zip: string;
  city: string;
  country: string;
  lat: number | null;
  lon: number | null;
}

interface AddressSearchFieldProps {
  value: AddressValues;
  onChange: (next: AddressValues) => void;
  disabled?: boolean;
}

export function AddressSearchField({ value, onChange, disabled }: AddressSearchFieldProps) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searchedOnce, setSearchedOnce] = useState(false);

  async function handleSearch() {
    const q = query.trim();
    if (q.length < 3) return;
    setSearching(true);
    setSearchedOnce(true);
    try {
      const data = await apiRequest<{ results: GeocodeResult[] }>(`/geocode?q=${encodeURIComponent(q)}`);
      setResults(data.results);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  function applyResult(item: GeocodeResult) {
    onChange({
      street: item.street || value.street,
      zip: item.zip || value.zip,
      city: item.city || value.city,
      country: item.country || value.country,
      lat: item.lat,
      lon: item.lon,
    });
    setResults([]);
    setSearchedOnce(false);
  }

  return (
    <div className="space-y-3 p-3 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface-2)]/50">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold flex items-center gap-1.5 text-[var(--text-primary)]">
          <MapPin className="w-3.5 h-3.5 text-[var(--accent)]" />
          Adresse suchen &amp; speichern
        </span>
        {value.lat !== null && value.lon !== null && (
          <span className="text-[11px] font-mono tabular-nums text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
            <Check className="w-3 h-3" />
            {value.lat.toFixed(4)}, {value.lon.toFixed(4)}
          </span>
        )}
      </div>

      {!disabled && (
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleSearch();
              }
            }}
            placeholder="Straße, Hausnummer, PLZ oder Ort suchen..."
            className="theme-input flex-1 px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={() => void handleSearch()}
            disabled={searching || query.trim().length < 3}
            className="theme-btn-primary px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            Suchen
          </button>
        </div>
      )}

      {results.length > 0 && (
        <div className="max-h-44 overflow-y-auto rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] divide-y divide-[var(--border-hairline)]">
          {results.map((r, idx) => (
            <button
              key={`${r.lat}-${r.lon}-${idx}`}
              type="button"
              onClick={() => applyResult(r)}
              className="w-full text-left px-3 py-2 text-xs hover:bg-[var(--bg-hover)] transition-colors flex flex-col gap-0.5"
            >
              <span className="font-medium text-[var(--text-primary)] line-clamp-1">{r.displayName}</span>
              <span className="text-[var(--text-muted)]">
                {[r.street, r.zip, r.city, r.country].filter(Boolean).join(' · ')}
              </span>
            </button>
          ))}
        </div>
      )}

      {searchedOnce && !searching && results.length === 0 && (
        <p className="text-xs text-[var(--text-muted)]">Keine Treffer gefunden. Adresse kann unten manuell eingetragen werden.</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          type="text"
          disabled={disabled}
          value={value.street}
          onChange={(e) => onChange({ ...value, street: e.target.value })}
          placeholder="Straße & Hausnummer"
          className="theme-input px-2.5 py-1.5 text-xs sm:col-span-2 disabled:opacity-60"
        />
        <input
          type="text"
          disabled={disabled}
          value={value.zip}
          onChange={(e) => onChange({ ...value, zip: e.target.value })}
          placeholder="PLZ"
          className="theme-input px-2.5 py-1.5 text-xs disabled:opacity-60"
        />
        <input
          type="text"
          disabled={disabled}
          value={value.city}
          onChange={(e) => onChange({ ...value, city: e.target.value })}
          placeholder="Stadt / Ort"
          className="theme-input px-2.5 py-1.5 text-xs disabled:opacity-60"
        />
        <input
          type="text"
          disabled={disabled}
          value={value.country}
          onChange={(e) => onChange({ ...value, country: e.target.value })}
          placeholder="Land"
          className="theme-input px-2.5 py-1.5 text-xs sm:col-span-2 disabled:opacity-60"
        />
      </div>
    </div>
  );
}
