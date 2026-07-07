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
        <img
          className="screw-diagram-reference-img"
          src="/screw-map-no-callouts.svg"
          alt="Screw measurement reference with feed, transition, and metering sections"
        />
      </div>
    </section>
  );
}
