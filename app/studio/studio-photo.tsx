'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Heart, RefreshCw, Trash2 } from 'lucide-react';
import { STUDIO_PHOTO_MAX_BYTES } from '../studio-photo-contract';

const endpoint = '/api/manage/studio-photo';
const changedEvent = 'studio-photo-changed';
const sessionMessage = 'Your Studio session may have expired. Reload Studio and sign in again.';

async function checkResponse(response: Response) {
  if (response.redirected || response.status === 401 || response.status === 403) throw new Error(sessionMessage);
  if (!response.ok) {
    const body = response.headers.get('content-type')?.includes('application/json') ? await response.json() as { error?: string } : null;
    throw new Error(body?.error || 'Could not load or save the Studio photo. Reload it before trying again.');
  }
}

export default function StudioPhoto({ editable = false }: { editable?: boolean }) {
  const [image, setImage] = useState('');
  const [version, setVersion] = useState('none');
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [candidate, setCandidate] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [previewValid, setPreviewValid] = useState(false);
  const imageUrl = useRef('');
  const previewUrl = useRef('');
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const clearImage = useCallback(() => {
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
    imageUrl.current = '';
    setImage('');
  }, []);
  const clearCandidate = useCallback(() => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = '';
    setPreview(''); setCandidate(null); setPreviewValid(false);
    if (fileInput.current) fileInput.current.value = '';
  }, []);

  const load = useCallback(async () => {
    const current = ++sequence.current;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true); setLoaded(false); setError(''); clearImage();
    try {
      const response = await fetch(endpoint, { cache: 'no-store', signal: request.signal, redirect: 'error' });
      await checkResponse(response);
      const nextVersion = response.headers.get('x-studio-photo-version');
      if (!nextVersion) throw new Error(sessionMessage);
      let blob: Blob | null = null;
      if (response.status !== 204) {
        if (!['image/jpeg', 'image/png'].includes(response.headers.get('content-type') || '')) throw new Error(sessionMessage);
        blob = await response.blob();
      }
      if (!mounted.current || current !== sequence.current || request.signal.aborted) return;
      if (blob) { imageUrl.current = URL.createObjectURL(blob); setImage(imageUrl.current); }
      setVersion(nextVersion); setLoaded(true);
    } catch (cause) {
      if (!mounted.current || current !== sequence.current || request.signal.aborted) return;
      clearImage(); setLoaded(false);
      setError(cause instanceof Error ? cause.message : 'Could not load the photo. Reload Studio to try again.');
    } finally { if (mounted.current && current === sequence.current) setLoading(false); }
  }, [clearImage]);

  useEffect(() => {
    mounted.current = true;
    const refresh = () => { void load(); };
    window.addEventListener(changedEvent, refresh);
    const initial = setTimeout(refresh, 0);
    return () => {
      mounted.current = false; clearTimeout(initial); controller.current?.abort();
      window.removeEventListener(changedEvent, refresh);
      if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    };
  }, [load]);

  function choose(file: File | undefined) {
    clearCandidate(); setError(''); setNotice('');
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) { setError('Choose a JPEG or PNG photo.'); return; }
    if (!file.size || file.size > STUDIO_PHOTO_MAX_BYTES) { setError('Choose a photo no larger than 1 MB. Your original will not be resized.'); return; }
    previewUrl.current = URL.createObjectURL(file);
    setPreview(previewUrl.current); setCandidate(file);
  }

  async function save(remove = false) {
    if (inFlight.current || loading || !loaded || (!remove && (!candidate || !previewValid))) return;
    if (remove && !window.confirm('Remove the personal photo from Studio? This removes the current stored photo; Cloudflare database backups may retain it for their normal retention period.')) return;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(endpoint, { method: remove ? 'DELETE' : 'POST', redirect: 'error', headers: {
        'X-Studio-Photo-Version': version,
        ...(!remove && candidate ? { 'Content-Type': candidate.type } : {}),
      }, body: remove ? undefined : candidate });
      await checkResponse(response);
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(sessionMessage);
      // Settings may have unmounted during the request; the persistent header
      // still needs to refresh after a successfully confirmed upload/removal.
      window.dispatchEvent(new Event(changedEvent));
      if (!mounted.current) return;
      clearCandidate();
      setNotice(remove ? 'Photo removed from Studio.' : 'Original photo saved to your private Studio.');
    } catch (cause) {
      if (!mounted.current) return;
      clearImage(); setLoaded(false);
      setError(cause instanceof Error ? cause.message : 'Could not confirm this change.');
      setNotice('The change may already be saved if the connection was interrupted. Reload the photo before trying again.');
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }

  const frame = <div className={'studio-photo-frame' + (image ? ' has-photo' : '')} aria-busy={loading}>
    {image ? <img src={image} alt="Personal photo in Zach’s Studio" onError={() => { clearImage(); setLoaded(false); setError('This photo could not be displayed. Reload it or choose another JPEG or PNG.'); }}/>
      : <div className="studio-photo-placeholder"><Heart aria-hidden="true"/><span>{loading ? 'Loading…' : error ? 'Photo unavailable' : 'Your people. Your why.'}</span></div>}
  </div>;
  if (!editable) return frame;
  return <section className="studio-photo-settings" aria-labelledby="studio-photo-heading" aria-busy={loading || busy}>
    <div><h2 id="studio-photo-heading">A little piece of home.</h2><p>Your personal photo stays inside Studio, not on the public website.</p></div>
    {frame}
    <p className="studio-photo-storage">Choose a JPEG or PNG up to 1 MB. Saving stores the original file, including any existing metadata, in the same private Cloudflare database as Studio. No resizing or AI edits. It is never added to the public code or image assets.</p>
    <label className="studio-photo-picker"><ImagePlus aria-hidden="true"/>Choose a photo<input ref={fileInput} type="file" accept="image/jpeg,image/png" disabled={busy || loading || !loaded} onChange={event => choose(event.target.files?.[0])}/></label>
    {preview && <div className="studio-photo-preview"><img src={preview} alt="Selected photo preview, not yet saved" onLoad={() => setPreviewValid(true)} onError={() => { setPreviewValid(false); setError('This file could not be displayed. Please choose a valid JPEG or PNG.'); }}/><p>Preview only — not uploaded yet.</p><button type="button" disabled={busy || loading || !loaded || !previewValid} onClick={() => void save()}>{busy ? 'Saving…' : 'Save original photo to Studio'}</button><button type="button" disabled={busy} onClick={clearCandidate}>Cancel</button></div>}
    <div className="studio-photo-actions"><button type="button" disabled={busy || loading} onClick={() => { setNotice(''); void load(); }}><RefreshCw aria-hidden="true"/>Reload photo</button>{image && <button type="button" disabled={busy || loading || !loaded} onClick={() => void save(true)}><Trash2 aria-hidden="true"/>Remove photo</button>}</div>
    <p className="studio-error" role="alert">{error}</p><p role="status">{notice}</p>
    {error && <a href="/studio">Reload Studio / sign in again</a>}
  </section>;
}
