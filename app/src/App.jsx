import { useEffect, useMemo, useState } from 'react';
import TopBar from './components/TopBar.jsx';
import Assistant from './components/Assistant.jsx';
import SettingsSheet from './components/SettingsSheet.jsx';
import AboutPage from './components/AboutPage.jsx';
import EvaluationPage from './components/EvaluationPage.jsx';
import { FRESH_FLOW, answerAsPerson, conversationView, tallyFor } from './lib/decide.js';
import {
  RECOMMENDED_IDX,
  domainCopy,
  domainKeyOf,
  historyLabelOf,
  settingLabel,
} from './lib/copy.js';
import { historyNoun } from './lib/format.js';
import { loadDatasets } from './lib/data.js';

const PAGES = ['about', 'evaluation'];

// The page named by the address: #about, #evaluation, or the home view.
function readPage() {
  if (typeof window === 'undefined') return 'home';
  const name = window.location.hash.replace(/^#\/?/, '');
  return PAGES.includes(name) ? name : 'home';
}

// After a page change, put keyboard and screen reader focus on the new page's heading.
function focusHeading() {
  setTimeout(() => {
    const el = document.querySelector('[data-page-heading]');
    if (el) el.focus({ preventScroll: true });
  }, 0);
}

export default function App() {
  const [datasets, setDatasets] = useState(null);
  const [failed, setFailed] = useState(false);

  // Load places.json, and shopping.json when it exists.
  useEffect(() => {
    const controller = new AbortController();
    loadDatasets(undefined, controller.signal)
      .then((d) => {
        if (!controller.signal.aborted) setDatasets(d);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setFailed(true);
      });
    return () => controller.abort();
  }, []);

  if (failed) {
    return (
      <div className="status">
        <p>PROXY could not load its data. Reload the page to try again.</p>
      </div>
    );
  }
  if (!datasets) {
    return (
      <div className="status" role="status">
        <p>Loading</p>
      </div>
    );
  }
  return <Shell datasets={datasets} />;
}

// The loaded app. Exported so the tests can render it with synthetic data.
export function Shell({ datasets }) {
  const slots = useMemo(
    () => [
      { key: 'places', data: datasets.places },
      ...(datasets.shopping ? [{ key: 'shopping', data: datasets.shopping }] : []),
    ],
    [datasets],
  );

  const [slotKey, setSlotKey] = useState('places');
  const [personIdx, setPersonIdx] = useState(0);
  const [decisionIdx, setDecisionIdx] = useState(0);
  const [settingIdx, setSettingIdx] = useState(RECOMMENDED_IDX);
  const [flow, setFlow] = useState(FRESH_FLOW);
  const [focusTick, setFocusTick] = useState(0);
  // Developer view: per decision, whether a question was answered and whether PROXY was right once revealed.
  const [tally, setTally] = useState({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dev, setDev] = useState(false);
  const [page, setPage] = useState(readPage);

  const slot = slots.find((s) => s.key === slotKey) || slots[0];
  const { data } = slot;
  const { summary, about, people } = data;
  const domainKey = domainKeyOf(about, slot.key);
  const copy = domainCopy(domainKey);
  const historyLabel = historyLabelOf(about, domainKey);
  const pIdx = Math.min(personIdx, people.length - 1);
  const person = people[pIdx];
  const decisions = person.decisions;
  const dIdx = decisions.length ? decisionIdx % decisions.length : 0;
  const decision = decisions[dIdx];
  const sIdx = Math.min(settingIdx, summary.settings.length - 1);
  const setting = summary.settings[sIdx];

  // The detailed evaluation uses the same names for the settings as the settings sheet.
  const evalData = useMemo(
    () => ({
      ...data,
      summary: {
        ...data.summary,
        settings: data.summary.settings.map((s, i) => ({
          ...s,
          label: settingLabel(data.summary.settings, i),
        })),
      },
    }),
    [data],
  );

  // Browser back and forward move between the home view and the pages.
  useEffect(() => {
    const onPop = () => {
      setPage(readPage());
      focusHeading();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = (next) => {
    const idx = ((window.history.state && window.history.state.idx) || 0) + 1;
    const url = next === 'home' ? window.location.pathname + window.location.search : `#${next}`;
    window.history.pushState({ idx }, '', url);
    setPage(next);
    window.scrollTo(0, 0);
    focusHeading();
  };

  // Back goes to the page the person came from, or to the fallback when they opened this page directly.
  const back = (fallback) => {
    if (window.history.state && window.history.state.idx > 0) window.history.back();
    else go(fallback);
  };

  const shownPage = page === 'evaluation' && !dev ? 'about' : page;

  const resetFlow = () => setFlow(FRESH_FLOW);
  const tallyKey = (d) => `${slot.key}/${d.id}`;
  const record = (patch) =>
    setTally((t) => {
      const k = tallyKey(decision);
      return { ...t, [k]: { ...(t[k] || {}), ...patch } };
    });
  const tick = () => setFocusTick((n) => n + 1);

  // Start the request for one decision. A replayed decision starts its tally again.
  const begin = (idx) => {
    const d = decisions[idx];
    setDecisionIdx(idx);
    setFlow({ ...FRESH_FLOW, started: true });
    setTally((t) => {
      const next = { ...t };
      delete next[tallyKey(d)];
      return next;
    });
    tick();
  };

  const actions = {
    onStart: () => begin(dIdx),
    onNext: () => begin((dIdx + 1) % decisions.length),
    onChange: () => setSheetOpen(true),
    onAnswer: (answer) => {
      setFlow((f) => ({ ...f, answer }));
      if (answer === 'yes' || answer === 'no') record({ asked: true });
      tick();
    },
    onAsPerson: () => actions.onAnswer(answerAsPerson(decision)),
    onConfirm: () => {
      setFlow((f) => ({ ...f, confirmed: true }));
      tick();
    },
    onReject: () => {
      setFlow((f) => {
        const cv = conversationView(decision, setting, f);
        if (cv.shownIdx === null) return f;
        return { ...f, rejected: [...f.rejected, cv.shownIdx] };
      });
      tick();
    },
    onToggleOthers: () => setFlow((f) => ({ ...f, others: !f.others })),
    onReveal: () => {
      setFlow((f) => ({ ...f, revealed: true }));
      record({ right: conversationView(decision, setting, flow).view.pick === decision.answer_idx });
    },
  };

  const onDomain = (key) => {
    if (key === slot.key) return;
    setSlotKey(key);
    setDecisionIdx(0);
    resetFlow();
  };
  const onPerson = (i) => {
    if (i === pIdx) return;
    setPersonIdx(i);
    setDecisionIdx(0);
    resetFlow();
  };
  // A different check-in setting starts the current request over.
  const onSetting = (i) => {
    if (i === sIdx) return;
    setSettingIdx(i);
    resetFlow();
  };

  return (
    <div className={shownPage === 'evaluation' ? 'app wide' : 'app'}>
      <TopBar
        domains={slots.map((s) => ({ key: s.key, label: domainCopy(s.key).label }))}
        domain={slot.key}
        onDomain={onDomain}
        people={people}
        personIdx={pIdx}
        onPerson={onPerson}
        onSettings={() => setSheetOpen(true)}
      />
      <SettingsSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        settings={summary.settings}
        settingIdx={sIdx}
        onSetting={onSetting}
        history={decision ? decision.history : []}
        historyLabel={historyLabel}
        onAbout={() => {
          setSheetOpen(false);
          go('about');
        }}
        dev={dev}
        onDev={setDev}
      />
      <main className="column main">
        {shownPage === 'about' && (
          <AboutPage
            about={about}
            summary={summary}
            dev={dev}
            onBack={() => back('home')}
            onEvaluation={() => go('evaluation')}
          />
        )}
        {shownPage === 'evaluation' && (
          <EvaluationPage data={evalData} settingIdx={sIdx} onBack={() => back('about')} />
        )}
        {shownPage === 'home' &&
          (decision ? (
            <Assistant
              copy={copy}
              decision={decision}
              position={{ index: dIdx, count: decisions.length }}
              summary={summary}
              settingIdx={sIdx}
              flow={flow}
              dev={dev}
              tally={tallyFor(decisions, tally, slot.key)}
              noun={historyNoun(historyLabel)}
              focusTick={focusTick}
              actions={actions}
            />
          ) : (
            <p className="status-note">There is nothing to show for this account yet.</p>
          ))}
      </main>
    </div>
  );
}
