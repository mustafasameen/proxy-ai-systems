import BarChart from './charts/BarChart.jsx';
import ReliabilityChart from './charts/ReliabilityChart.jsx';
import CurveChart from './charts/CurveChart.jsx';
import { pct, pct1 } from '../lib/decide.js';
import { fmtCount } from '../lib/format.js';

const DESIGN_TAG = 'Measured on the 2,291 design-phase choices';

const ERROR_LABELS = {
  both_new: 'They tried a new kind of place and PROXY guessed a different new kind',
  habit_pull: 'PROXY stuck to their habits, they tried something new',
  missed_familiar: 'They went back to a familiar kind, PROXY guessed something new',
  both_familiar: 'Two familiar kinds, PROXY chose the wrong one',
  same_kind_other_venue: 'Right kind of place, wrong venue',
};

// How the average stated confidence compares with how often PROXY was right.
function calibrationLead(bins) {
  const total = bins.reduce((s, b) => s + b.n, 0);
  if (total === 0) return '';
  const gap = bins.reduce((s, b) => s + b.n * (b.confidence - b.accuracy), 0) / total;
  if (gap > 0.08) return "PROXY's confidence runs high.";
  if (gap > 0.01) return "PROXY's confidence runs slightly high.";
  if (gap < -0.08) return "PROXY's confidence runs low.";
  if (gap < -0.01) return "PROXY's confidence runs slightly low.";
  return "PROXY's confidence is close to honest.";
}

// A sentence comparing the three ways of deciding when to ask, at the selected setting's ask rate.
function curveSentence(curves, setting) {
  const rate = setting.ask_rate;
  if (rate <= 0) return 'With no questions asked, all three rules give the same result.';
  if (rate >= 1) return 'When PROXY asks every time, the choice of when to ask no longer matters.';
  const at = (key) => curves[key].find((p) => Math.abs(p.ask_rate - rate) < 1e-6);
  const voi = at('voi');
  const conf = at('confidence');
  const rnd = at('random');
  if (!voi || !conf || !rnd) {
    return 'Asking where the question helps most beats asking at random or when least sure.';
  }
  return `Asking on ${pct(rate)}% of choices, PROXY's rule picks right ${pct(voi.accuracy)}% of the time. Asking when least sure would give ${pct(conf.accuracy)}% and asking at random ${pct(rnd.accuracy)}%.`;
}

function Tag({ children }) {
  return <p className="tag">{children}</p>;
}

// The trust report: plain questions, each with one number or chart and one sentence.
export default function TrustReport({ data, settingIdx }) {
  const { summary, reference, about } = data;
  const ref = Object.fromEntries(reference.map((r) => [r.key, r]));
  const testTag = `Measured on ${fmtCount(about.n_decisions)} held-out choices from ${fmtCount(about.n_people)} people`;
  const nDecisions = fmtCount(about.n_decisions);

  const accuracyRows = [
    { label: 'Chance', value: summary.chance },
    ref.habit_rule && {
      label: 'Picking their most frequent kind of place',
      value: ref.habit_rule.value,
    },
    { label: 'PROXY on its own', value: summary.act_now_accuracy, accent: true },
    { label: 'PROXY after one question', value: summary.always_ask_accuracy, accent: true },
  ].filter(Boolean);

  const cw = summary.confidently_wrong;
  const setting = summary.settings[settingIdx];

  const own = ref.own_history_dev;
  const stranger = ref.stranger_history_dev;
  const same = ref.own_minus_stranger_same_kind;
  const unseen = ref.unseen_people;
  const matched = ref.own_minus_stranger_matched;

  const patterns = summary.error_patterns;
  const errorRows = Object.keys(ERROR_LABELS)
    .filter((k) => typeof patterns[k] === 'number')
    .map((k) => ({ key: k, label: ERROR_LABELS[k], count: patterns[k] }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="trust">
      <section className="trust-sec" aria-labelledby="t1">
        <h2 id="t1">How often does PROXY pick the place the person actually chose?</h2>
        <BarChart rows={accuracyRows} caption="Share of choices where the pick matched what the person did" />
        <p className="sentence">
          On its own PROXY picks right {pct(summary.act_now_accuracy)}% of the time, against{' '}
          {pct(summary.chance)}% by chance. After one question it reaches{' '}
          {pct(summary.always_ask_accuracy)}%.
        </p>
        <Tag>{testTag}</Tag>
      </section>

      <section className="trust-sec" aria-labelledby="t2">
        <h2 id="t2">When it says it's sure, is it right?</h2>
        <ReliabilityChart bins={summary.reliability} />
        <p className="sentence">
          {calibrationLead(summary.reliability)} It was confidently wrong (70% sure or more) on{' '}
          {cw['0.7']} of {nDecisions} choices.
        </p>
        <Tag>{testTag}</Tag>
      </section>

      <section className="trust-sec" aria-labelledby="t3">
        <h2 id="t3">When should it ask?</h2>
        <CurveChart curves={summary.curves} settings={summary.settings} selectedIdx={settingIdx} />
        <p className="sentence">{curveSentence(summary.curves, setting)}</p>
        <p className="muted small">
          The five dots on PROXY's line are the ask settings. The filled dot is the one chosen
          on Choose for me, {setting.label}.
        </p>
        <Tag>{testTag}</Tag>
      </section>

      <section className="trust-sec" aria-labelledby="t4">
        <h2 id="t4">Is it using your history, or just guessing what most people like?</h2>
        {own && stranger && (
          <BarChart
            rows={[
              { label: 'Their own history', value: own.value, accent: true },
              { label: "A stranger's history", value: stranger.value },
            ]}
            caption="Share of choices picked right, using each history in turn"
          />
        )}
        {same && (
          <p className="sentence">
            Even when all five options are the same kind of place, their own history beats a
            stranger's by {pct1(same.value)} points (95% interval {pct1(same.ci[0])} to{' '}
            {pct1(same.ci[1])}).
          </p>
        )}
        {(own || same) && <Tag>{DESIGN_TAG}</Tag>}
        {matched && (
          <>
            <p className="sentence">
              PROXY was also given a matched stranger's history in place of the person's own, with
              distance and other cues that ignore the person matched across the five options. Their
              own history beats the stranger's by {pct1(matched.value)} points (95% interval{' '}
              {pct1(matched.ci[0])} to {pct1(matched.ci[1])}).
            </p>
            <Tag>Measured on matched rebuilds of the design and held-out choices, five training runs</Tag>
          </>
        )}
        {unseen && (
          <>
            <p className="sentence spaced">
              Retrained without these {fmtCount(about.n_people)} people, PROXY still picks right{' '}
              {pct1(unseen.value)}% of the time against {pct1(unseen.compare)}%, so it works for
              people it has never seen, as long as they have a history.
            </p>
            <Tag>{testTag}</Tag>
          </>
        )}
      </section>

      <section className="trust-sec" aria-labelledby="t5">
        <h2 id="t5">Where does it go wrong?</h2>
        <table className="err-table">
          <thead>
            <tr>
              <th scope="col">What happened</th>
              <th scope="col" className="num">
                Misses
              </th>
              <th scope="col" className="num">
                Share
              </th>
            </tr>
          </thead>
          <tbody>
            {errorRows.map((r) => {
              const share = patterns.n_wrong ? r.count / patterns.n_wrong : 0;
              return (
                <tr key={r.key}>
                  <td>
                    <span className="err-label">{r.label}</span>
                    <svg
                      className="err-bar"
                      viewBox="0 0 100 6"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <rect className="bar-track" x="0" y="0" width="100" height="6" />
                      <rect className="bar-fill" x="0" y="0" width={share * 100} height="6" />
                    </svg>
                  </td>
                  <td className="num">{fmtCount(r.count)}</td>
                  <td className="num">{pct(share)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="sentence">
          Most misses happen when the person tries a kind of place they have not been to
          recently.
        </p>
        <Tag>{testTag}</Tag>
      </section>

      <section className="trust-sec" aria-labelledby="t6">
        <h2 id="t6">Who this covers</h2>
        <ul className="cover-list">
          <li>New York users with at least 20 check-ins (about half the users, 85% of check-ins).</li>
          <li>People with no history: PROXY should always ask.</li>
          <li>
            Discretionary choices only, such as food, drinks, nightlife and shopping. Errands, trips
            and visits to someone&apos;s home are out of scope, because no history predicts them.
          </li>
          <li>Tested only on New York in this app.</li>
        </ul>
      </section>
    </div>
  );
}
