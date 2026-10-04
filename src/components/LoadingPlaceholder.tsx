import '@/loading-feedback.css';

type Props = { label: string; kind?: 'text' | 'list' | 'stat'; rows?: number };

export default function LoadingPlaceholder({ label, kind = 'text', rows = 4 }: Props) {
  return <div className={`loading-placeholder loading-placeholder-${kind}`} role="status" aria-label={label}>
    <span className={kind === 'stat' ? 'sr-only' : 'loading-placeholder-label'}>{label}</span>
    <div className="loading-placeholder-shapes" aria-hidden="true">
      {Array.from({ length: kind === 'stat' ? 2 : rows }, (_, index) => kind === 'list'
        ? <div className="loading-placeholder-row" key={index}><div><span className="loading-placeholder-bar" /><span className="loading-placeholder-bar" /></div><span className="loading-placeholder-action" /></div>
        : <span key={index} className="loading-placeholder-bar" />)}
    </div>
  </div>;
}
