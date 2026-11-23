import { useId, useState } from 'react';
import { request } from '../lib/api.js';

export const NOTE_MAX = 280;

// What the person sees when a submission fails, in plain words.
export function feedbackError(err) {
  if (err && err.code === 'network') return "Couldn't send: the PROXY API is not running.";
  if (err && err.code === 'rate_limited') return 'Too many requests. Wait a minute and try again.';
  return (err && err.message) || "Couldn't send your feedback.";
}

// One yes/no rating with an optional short note, sent to the API and stored without a name.
export default function FeedbackBox({ where, item, question = 'Was this easy to follow?', className = '' }) {
  const id = useId();
  const [rating, setRating] = useState(null);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('idle'); // idle | sending | sent | failed
  const [error, setError] = useState('');

  const send = async (e) => {
    e.preventDefault();
    if (!rating || status === 'sending') return;
    setStatus('sending');
    try {
      await request('/api/feedback', { method: 'POST', body: { where, item: item || null, rating, note: note.trim() || null } }).promise;
      setStatus('sent');
    } catch (err) {
      setError(feedbackError(err));
      setStatus('failed');
    }
  };

  if (status === 'sent') {
    return <p className={`fb fb-done ${className}`} role="status">Thanks. Your feedback was saved, without your name.</p>;
  }
  return (
    <form className={`fb ${className}`} onSubmit={send} aria-label="Feedback">
      <p className="fb-q" id={`${id}-q`}>{question}</p>
      <div className="fb-choices" role="group" aria-labelledby={`${id}-q`}>
        <button type="button" aria-pressed={rating === 'clear'} onClick={() => setRating('clear')}>Yes</button>
        <button type="button" aria-pressed={rating === 'unclear'} onClick={() => setRating('unclear')}>Not really</button>
      </div>
      {rating ? (
        <>
          <label className="fb-lab" htmlFor={`${id}-note`}>
            {rating === 'clear' ? 'Anything to add?' : 'What was confusing or missing?'} <span>Optional. Please leave out names.</span>
          </label>
          <textarea id={`${id}-note`} rows={2} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="fb-row">
            <span className="fb-count" aria-live="polite">{note.length} / {NOTE_MAX}</span>
            <button type="submit" className="fb-send" disabled={status === 'sending'}>{status === 'sending' ? 'Sending...' : 'Send feedback'}</button>
          </div>
        </>
      ) : null}
      {status === 'failed' ? <p className="fb-err" role="alert">{error}</p> : null}
    </form>
  );
}
