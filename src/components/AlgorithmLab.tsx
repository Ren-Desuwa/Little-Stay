import { useState } from 'react';
import { FlaskConical, Hash, ScanText, MapPinned } from 'lucide-react';
import { type Data, type Property } from '../lib/model';
import HashDemo from './HashDemo';
import FuzzyDemo from './FuzzyDemo';
import VoronoiDemo from './VoronoiDemo';

const tabs = [
  { id: 'hash', label: 'Hashing', Icon: Hash },
  { id: 'fuzzy', label: 'Fuzzy search', Icon: ScanText },
  { id: 'voronoi', label: 'Voronoi', Icon: MapPinned },
] as const;

export default function AlgorithmLab({ data, properties }: { data: Data; properties: Property[] }) {
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('hash');
  return (
    <section className="page-section lab-page">
      <div className="eyebrow">
        <FlaskConical size={15} /> BUILT TO BE UNDERSTOOD
      </div>
      <h1>Behind every little stay.</h1>
      <p className="page-intro">
        Three custom algorithms. Press Play to watch them work, or move through each step at your
        own pace.
      </p>
      <div className="lab-tabs" role="tablist" aria-label="Algorithms">
        {tabs.map(({ id, label, Icon }, index) => (
          <button
            type="button"
            key={id}
            id={`algorithm-tab-${id}`}
            role="tab"
            aria-selected={tab === id}
            aria-controls={`algorithm-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
            onKeyDown={(event) => {
              const nextIndex =
                event.key === 'ArrowRight'
                  ? (index + 1) % tabs.length
                  : event.key === 'ArrowLeft'
                    ? (index + tabs.length - 1) % tabs.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? tabs.length - 1
                        : undefined;
              if (nextIndex === undefined) return;
              event.preventDefault();
              setTab(tabs[nextIndex].id);
              document.getElementById(`algorithm-tab-${tabs[nextIndex].id}`)?.focus();
            }}
          >
            <Icon size={17} />
            {label}
          </button>
        ))}
      </div>
      <div
        id={`algorithm-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`algorithm-tab-${tab}`}
        tabIndex={0}
      >
        {tab === 'hash' && <HashDemo data={data} />}
        {tab === 'fuzzy' && <FuzzyDemo properties={properties} />}
        {tab === 'voronoi' && <VoronoiDemo properties={properties} />}
      </div>
    </section>
  );
}
