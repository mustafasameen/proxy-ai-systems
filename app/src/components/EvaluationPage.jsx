import TrustReport from './TrustReport.jsx';

// Developer view only: the full evaluation, with every chart, for the dataset on screen.
export default function EvaluationPage({ data, settingIdx, onBack }) {
  return (
    <div className="evaluation">
      <button type="button" className="link back" onClick={onBack}>
        <svg className="back-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <path d="M7.75 2 3.75 6l4 4" />
        </svg>
        Back
      </button>
      <h1 className="page-title" data-page-heading="true" tabIndex={-1}>
        Detailed evaluation
      </h1>
      <TrustReport data={data} settingIdx={settingIdx} />
    </div>
  );
}
