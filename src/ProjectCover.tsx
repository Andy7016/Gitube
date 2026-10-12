import { useEffect, useRef, useState } from 'react';
import { GitFork, ImageOff, Star } from 'lucide-react';
import { formatNumber, type Repo } from './data';

export default function ProjectCover({ repo }: { repo: Repo }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [retry, setRetry] = useState(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setFailed(false); setLoaded(false); setRetry(false);
    return () => { if (retryTimer.current) clearTimeout(retryTimer.current); retryTimer.current = null; };
  }, [repo.full_name]);
  const path = repo.full_name.split('/').map(encodeURIComponent).join('/');
  const src = `https://opengraph.githubassets.com/${retry ? '1' : new Date().toISOString().slice(0, 10)}/${path}`;
  const imageError = () => {
    if (retry) { setFailed(true); return; }
    // Stagger one retry against GitHub's cached image when generation is rate limited.
    if (!retryTimer.current) retryTimer.current = setTimeout(() => { retryTimer.current = null; setRetry(true); }, 1200 + repo.id % 900);
  };
  return <div className="project-cover">
    {!loaded && !failed && <div className="cover-loading" aria-hidden="true" />}
    {failed ? <div className="cover-fallback"><ImageOff size={24} /><strong>{repo.name}</strong><span>仓库封面暂不可用</span></div> : <img className="cover-image" src={src} alt={`${repo.full_name} GitHub 仓库封面`} loading="lazy" decoding="async" referrerPolicy="no-referrer" onLoad={() => setLoaded(true)} onError={imageError} />}
    <div className="cover-overlay"><div className="cover-counts"><span><Star size={12} />{formatNumber(repo.stargazers_count)}</span><span><GitFork size={12} />{formatNumber(repo.forks_count)}</span></div>{repo.language && <span className="cover-language">{repo.language}</span>}</div>
  </div>;
}
