type ScrewMeasurementKind = 'flight' | 'root';
type ScrewSectionKey = 'feed' | 'transition' | 'metering';

type ScrewMeasurementMapProps = {
  onAddReading: (kind: ScrewMeasurementKind, section: ScrewSectionKey) => void;
};

const screwMapSections: Array<{
  key: ScrewSectionKey;
  label: string;
  shortLabel: string;
  accent: 'feed' | 'transition' | 'metering';
}> = [
  { key: 'feed', label: 'Feed Section', shortLabel: 'Feed', accent: 'feed' },
  { key: 'transition', label: 'Transition Section', shortLabel: 'Transition', accent: 'transition' },
  { key: 'metering', label: 'Metering Section', shortLabel: 'Metering', accent: 'metering' },
];

const flightBands = [286, 344, 402, 460, 518, 576, 634, 692, 750, 808, 866, 924, 982, 1040, 1098];

export default function ScrewMeasurementMap({ onAddReading }: ScrewMeasurementMapProps) {
  return (
    <section className="screw-diagram-panel">
      <div className="measurement-section-heading">
        <h4>Visual Screw Measurement Map</h4>
      </div>

      <div className="screw-diagram-controls" aria-label="Screw measurement controls">
        {screwMapSections.map(section => (
          <div className={`screw-diagram-control-column zone-${section.accent}`} key={section.key}>
            <strong className="screw-diagram-column-title">{section.label}</strong>
            <button
              className="screw-diagram-pill flight"
              type="button"
              onClick={() => onAddReading('flight', section.key)}
              aria-label={`Add ${section.shortLabel} Flight OD reading`}
            >
              <span className="screw-diagram-target-icon" aria-hidden="true" />
              <span className="screw-diagram-button-copy"><span>{section.shortLabel}</span><span>Flight OD</span></span>
            </button>
            <button
              className="screw-diagram-pill root"
              type="button"
              onClick={() => onAddReading('root', section.key)}
              aria-label={`Add ${section.shortLabel} Root Dia reading`}
            >
              <span className="screw-diagram-target-icon" aria-hidden="true" />
              <span className="screw-diagram-button-copy"><span>{section.shortLabel}</span><span>Root Dia</span></span>
            </button>
          </div>
        ))}
      </div>

      <div className="screw-diagram-wrap">
        <svg
          className="screw-diagram-svg"
          viewBox="0 0 1100 360"
          role="img"
          aria-labelledby="screw-map-title screw-map-desc"
        >
          <title id="screw-map-title">Visual screw measurement map</title>
          <desc id="screw-map-desc">
            Screw reference map with spline end, feed, transition, and metering zones. Blue callout marks Flight OD readings and amber callout marks Root Diameter readings.
          </desc>
          <defs>
            <linearGradient id="screwPanelFill" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#0b2a3a" />
              <stop offset="0.55" stopColor="#061723" />
              <stop offset="1" stopColor="#02080d" />
            </linearGradient>
            <linearGradient id="screwBodyFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#eef9ff" stopOpacity="0.92" />
              <stop offset="0.34" stopColor="#b8cbd3" stopOpacity="0.96" />
              <stop offset="0.58" stopColor="#7f969f" stopOpacity="0.98" />
              <stop offset="1" stopColor="#24343d" stopOpacity="0.98" />
            </linearGradient>
            <linearGradient id="screwFlightFill" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#f8fdff" stopOpacity="0.9" />
              <stop offset="0.42" stopColor="#b6c8cf" stopOpacity="0.95" />
              <stop offset="1" stopColor="#34444c" stopOpacity="0.98" />
            </linearGradient>
            <linearGradient id="screwCapFill" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#394b54" />
              <stop offset="0.5" stopColor="#b8ccd4" />
              <stop offset="1" stopColor="#5d727b" />
            </linearGradient>
            <filter id="screwSoftShadow" x="-10%" y="-35%" width="120%" height="170%">
              <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#00070d" floodOpacity="0.38" />
            </filter>
            <clipPath id="screwFlightClip">
              <rect x="204" y="70" width="812" height="132" rx="5" />
            </clipPath>
          </defs>

          <rect x="8" y="8" width="1084" height="344" rx="20" fill="#030d17" stroke="#18506a" strokeWidth="2" />
          <rect x="62" y="34" width="990" height="246" rx="16" fill="url(#screwPanelFill)" stroke="#174b62" strokeWidth="1.5" />

          <rect className="screw-zone-fill feed" x="204" y="70" width="286" height="132" rx="5" />
          <rect className="screw-zone-fill transition" x="490" y="70" width="288" height="132" rx="5" />
          <rect className="screw-zone-fill metering" x="778" y="70" width="238" height="132" rx="5" />
          <path className="screw-zone-divider" d="M490 50 V222 M778 50 V222" />
          <path className="screw-od-envelope" d="M204 70 H1016 M204 202 H1016" />

          <g className="screw-side-label" filter="url(#screwSoftShadow)">
            <text x="94" y="110" textAnchor="middle">DRIVE /</text>
            <text x="94" y="132" textAnchor="middle">SPLINE END</text>
            <rect className="screw-drive-shank" x="72" y="140" width="84" height="44" rx="8" />
            <path className="screw-spline-groove" d="M85 151 H143 M85 162 H143 M85 173 H143" />
            <rect className="screw-drive-collar" x="156" y="126" width="42" height="72" rx="7" />
            <rect className="screw-shoulder-ring" x="198" y="138" width="28" height="48" rx="6" />
          </g>

          <g filter="url(#screwSoftShadow)">
            <path className="screw-root-core" d="M226 124 C350 124 452 125 490 128 C610 136 694 126 778 104 H1016 V170 H778 C694 152 610 148 490 156 C452 160 350 160 226 160 Z" />
            <path className="screw-root-highlight" d="M226 124 C350 124 452 125 490 128 C610 136 694 126 778 104 H1016" />
            <path className="screw-root-shadow" d="M226 160 C350 160 452 160 490 156 C610 148 694 152 778 170 H1016" />
            <path className="screw-root-edge" d="M226 143 C350 143 452 144 490 145 C610 148 694 140 778 126 H1013" />
            <g clipPath="url(#screwFlightClip)">
              {flightBands.map(x => (
                <g key={x}>
                  <path className="screw-flight-shadow" d={`M${x + 28} 78 L${x + 82} 198`} />
                  <path className="screw-flight-band" d={`M${x} 70 H${x + 30} L${x + 90} 202 H${x + 60} Z`} />
                  <path className="screw-flight-rim" d={`M${x + 30} 74 L${x + 88} 198`} />
                </g>
              ))}
            </g>
            <rect className="screw-flat-end" x="1016" y="72" width="22" height="128" rx="3" />
            <path className="screw-flat-face" d="M1038 78 V194" />
          </g>

          <g className="screw-measure-label flight-label">
            <rect x="428" y="24" width="126" height="32" rx="9" />
            <text x="491" y="46" textAnchor="middle">FLIGHT OD</text>
            <line x1="491" y1="56" x2="555" y2="82" />
          </g>
          <g className="screw-measure-label root-label">
            <rect x="602" y="220" width="126" height="32" rx="9" />
            <text x="665" y="242" textAnchor="middle">ROOT DIA</text>
            <line x1="665" y1="220" x2="724" y2="154" />
          </g>

          <g className="screw-section-caption feed">
            <text x="347" y="304">FEED</text>
            <text x="347" y="326">material intake / rear screw section</text>
          </g>
          <g className="screw-section-caption transition">
            <text x="634" y="304">TRANSITION</text>
            <text x="634" y="326">compression / taper section</text>
          </g>
          <g className="screw-section-caption metering">
            <text x="897" y="304">METERING</text>
            <text x="897" y="326">front discharge section</text>
          </g>
        </svg>
      </div>

      <div className="screw-diagram-legend" aria-label="Screw visual legend">
        <span className="flight">Flight OD = outside diameter over the flights</span>
        <span className="root">Root Dia = screw core/root diameter between flights</span>
      </div>
    </section>
  );
}
