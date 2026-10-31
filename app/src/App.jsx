import { useEffect, useState } from 'react';
import TopBar from './components/TopBar.jsx';
import HistoryPanel from './components/HistoryPanel.jsx';
import OptionsList from './components/OptionsList.jsx';
import DecisionPanel from './components/DecisionPanel.jsx';
import TrustReport from './components/TrustReport.jsx';
import { decideMode, currentView, answerAsPerson } from './lib/decide.js';

// What has happened on the current decision: an optional ask or skip override,
// the answer given, and whether the real choice has been revealed.
const FRESH_FLOW = { override: null, answer: null, revealed: false };

export default function App() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState('choose');
  const [personIdx, setPersonIdx] = useState(0);
  const [decisionIdx, setDecisionIdx] = useState(0);
  const [settingIdx, setSettingIdx] = useState(2);
  const [flow, setFlow] = useState(FRESH_FLOW);
  // Per decision id: whether a question was answered and whether PROXY was right once revealed.
  const [tally, setTally] = useState({});

  // Load the replay data once.
  useEffect(() => {
    const controller = new AbortController();
    fetch('data/demo.json', { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => {
        if (e.name !== 'AbortError') setFailed(true);
      });
    return () => controller.abort();
  }, []);

  if (failed) {
    return (
      <div className="status">
        <p>The replay data could not be loaded. Reload the page to try again.</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="status">
        <p>Loading the replay data</p>
      </div>
    );
  }

  const { summary, about, people } = data;
  const person = people[personIdx];
  const decisions = person.decisions;
  const decision = decisions[decisionIdx];
  const setting = summary.settings[settingIdx];

  const mode = decideMode(decision, setting);
  const asking =
    !flow.answer && (flow.override === 'ask' || (flow.override !== 'skip' && mode === 'ask'));
  const view = currentView(decision, flow.answer);

  const resetFlow = () => setFlow(FRESH_FLOW);

  const record = (patch) =>
    setTally((t) => ({ ...t, [decision.id]: { ...(t[decision.id] || {}), ...patch } }));

  const onPerson = (i) => {
    setPersonIdx(i);
    setDecisionIdx(0);
    resetFlow();
  };

  const onStep = (delta) => {
    const n = decisions.length;
    setDecisionIdx((decisionIdx + delta + n) % n);
    resetFlow();
  };

  const onSetting = (i) => {
    setSettingIdx(i);
    resetFlow();
  };

  const onAnswer = (answer) => {
    setFlow((f) => ({ ...f, answer }));
    record({ asked: true });
  };

  const onReveal = () => {
    setFlow((f) => ({ ...f, revealed: true }));
    record({ asked: Boolean(flow.answer), right: view.pick === decision.answer_idx });
  };

  // Totals for the current person in this session.
  let right = 0;
  let revealedCount = 0;
  let asked = 0;
  for (const d of decisions) {
    const t = tally[d.id];
    if (!t) continue;
    if (t.asked) asked += 1;
    if (typeof t.right === 'boolean') {
      revealedCount += 1;
      if (t.right) right += 1;
    }
  }

  return (
    <div className="app">
      <TopBar
        tab={tab}
        onTab={setTab}
        people={people}
        personIdx={personIdx}
        onPerson={onPerson}
        decisionIdx={decisionIdx}
        decisionCount={decisions.length}
        onStep={onStep}
      />
      <main
        className="shell"
        id="main-panel"
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
      >
        {tab === 'choose' ? (
          <>
            <p className="note">
              Replaying real, anonymized New York check-ins. The person's actual choice stays
              hidden until you reveal it.
            </p>
            <div className="choose">
              <div className="col-know">
                <HistoryPanel
                  history={decision.history}
                  topCategories={decision.top_categories}
                />
              </div>
              <div className="col-options">
                <OptionsList
                  candidates={decision.candidates}
                  probs={view.probs}
                  topIdx={view.pick}
                  answered={Boolean(flow.answer)}
                  wentIdx={flow.revealed ? decision.answer_idx : null}
                />
              </div>
              <div className="col-decide">
                <DecisionPanel
                  decision={decision}
                  view={view}
                  settings={summary.settings}
                  settingIdx={settingIdx}
                  onSetting={onSetting}
                  asking={asking}
                  answer={flow.answer}
                  revealed={flow.revealed}
                  reliability={summary.reliability}
                  alwaysAskAccuracy={summary.always_ask_accuracy}
                  tally={{ right, revealed: revealedCount, asked }}
                  onAnswer={onAnswer}
                  onAsPerson={() => onAnswer(answerAsPerson(decision))}
                  onSkip={() => setFlow((f) => ({ ...f, override: 'skip' }))}
                  onAskInstead={() => setFlow((f) => ({ ...f, override: 'ask' }))}
                  onReveal={onReveal}
                  onNext={() => onStep(1)}
                />
              </div>
            </div>
          </>
        ) : (
          <TrustReport data={data} settingIdx={settingIdx} />
        )}
      </main>
      <footer className="footer">
        <div className="shell">
          <p>Data: {about.data}</p>
        </div>
      </footer>
    </div>
  );
}
