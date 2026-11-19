import React, { useEffect, useRef, useState } from 'react';
import { Button, Card, TextField, Typography } from '@material-ui/core';
import { useResource } from './management-ui.jsx';
import { usePosting } from './inventory-ui.jsx';
import storesCover from './stores-cover.jpg';

const imageOptions = {
  logo: { label: 'Logo', maxKiB: 128, dimension: 1024 },
  cover: { label: 'Cover', maxKiB: 512, dimension: 2560 }
};

function BrandingText({ request, settings, onUpdated }) {
  const [name, setName] = useState(settings.name);
  const [shortName, setShortName] = useState(settings.shortName);
  const [aboutUs, setAboutUs] = useState(settings.aboutUs);
  const [saved, setSaved] = useState(false);
  const { saving, error, post } = usePosting(request);
  return (
    <Card className="workspace-card" variant="outlined">
      <Typography component="h2" variant="h6">System details</Typography>
      <form aria-busy={saving} onSubmit={event => {
        event.preventDefault();
        setSaved(false);
        post('settings', { name, shortName, aboutUs }, data => {
          setName(data.name);
          setShortName(data.shortName);
          setAboutUs(data.aboutUs);
          setSaved(true);
          onUpdated({ name: data.name, shortName: data.shortName });
        });
      }}>
        <fieldset className="record-fieldset" disabled={saving}>
          <div className="detail-grid">
            <TextField required label="System name" size="small" variant="outlined" value={name}
              onChange={event => { setSaved(false); setName(event.target.value); }} inputProps={{ maxLength: 100 }} />
            <TextField required label="Short name" size="small" variant="outlined" value={shortName}
              onChange={event => { setSaved(false); setShortName(event.target.value); }} inputProps={{ maxLength: 32 }} />
          </div>
          <TextField fullWidth multiline rows={3} className="order-remarks" label="About Us" variant="outlined"
            value={aboutUs} onChange={event => { setSaved(false); setAboutUs(event.target.value); }}
            inputProps={{ maxLength: 2000 }} helperText="Shown on the signed-in dashboard." />
          <div className="record-tools"><Button type="submit" color="primary" variant="contained">
            {saving ? 'Saving…' : 'Save system details'}
          </Button></div>
        </fieldset>
        {saved && <p role="status">System details saved.</p>}
        {error && <p className="error-message" role="alert">{error}</p>}
      </form>
    </Card>
  );
}

function BrandingImage({ request, slot, initialUrl, initialFallback, onUpdated }) {
  const { label, maxKiB, dimension } = imageOptions[slot];
  const [url, setUrl] = useState(initialUrl);
  const [fallback, setFallback] = useState(initialFallback);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [checking, setChecking] = useState(false);
  const [validation, setValidation] = useState('');
  const [notice, setNotice] = useState('');
  const [inputVersion, setInputVersion] = useState(0);
  const { saving, error, post } = usePosting(request);
  const mounted = useRef(true);
  const busy = checking || saving;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    setPreview({ file, url: objectUrl });
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  const selectedPreview = file && preview?.file === file ? preview.url : null;
  const builtIn = slot === 'logo' ? '/app-icon-192.png' : storesCover;
  const previewLabel = selectedPreview ? 'Selected' : url ? 'Saved' : 'Built-in';

  function complete(data) {
    const key = `${slot}Url`;
    const fallbackKey = `${slot}FallbackUrl`;
    setUrl(data[key]);
    setFallback(data[fallbackKey]);
    onUpdated({ [key]: data[key], [fallbackKey]: data[fallbackKey] });
    setFile(null);
    setInputVersion(version => version + 1);
    setNotice(`${label} saved.`);
  }

  function select(event) {
    const selected = event.target.files[0];
    setNotice('');
    setValidation('');
    if (selected && (!selected.size || selected.size > maxKiB * 1024 ||
        (selected.type && !['image/png', 'image/jpeg'].includes(selected.type)))) {
      setFile(null);
      setInputVersion(version => version + 1);
      setValidation(`Choose a PNG or JPEG up to ${maxKiB} KiB.`);
      return;
    }
    setFile(selected ?? null);
  }

  async function upload(event) {
    event.preventDefault();
    if (!selectedPreview || busy) return;
    setChecking(true);
    setValidation('');
    try {
      // Decode the preview before upload for useful file errors. The Worker
      // also validates the submitted bytes and dimensions independently.
      const image = new Image();
      image.src = selectedPreview;
      await image.decode();
      if (!mounted.current) return;
      if (image.naturalWidth > dimension || image.naturalHeight > dimension) {
        setValidation(`Image width and height must each be at most ${dimension} pixels.`);
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!mounted.current) return;
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      await post(`branding/${slot}`, { content: btoa(binary) }, complete);
    } catch {
      if (mounted.current) setValidation('This image could not be decoded. Choose another PNG or JPEG.');
    } finally {
      if (mounted.current) setChecking(false);
    }
  }

  return (
    <Card className="workspace-card" variant="outlined">
      <Typography component="h2" variant="h6">{label}</Typography>
      <img className={`branding-preview branding-preview-${slot}`} src={selectedPreview || url || builtIn}
        alt={`${previewLabel} ${label.toLowerCase()} preview`} />
      {!selectedPreview && !url && <p className="muted">Using the built-in {label.toLowerCase()}.</p>}
      <form onSubmit={upload} aria-busy={busy}>
        <fieldset className="record-fieldset" disabled={busy}>
          <label className="branding-file">
            <span>Choose {label.toLowerCase()} image</span>
            <input key={inputVersion} type="file" accept="image/png,image/jpeg" onChange={select} />
          </label>
          <p className="muted">PNG or JPEG, up to {maxKiB} KiB and {dimension} pixels on either side.</p>
          <Button type="submit" color="primary" variant="contained" disabled={!selectedPreview || busy}>
            {busy ? 'Saving…' : `Save ${label.toLowerCase()}`}
          </Button>
          {fallback && <Button type="button" disabled={busy} onClick={() => {
            setNotice('');
            setValidation('');
            const revision = new URL(fallback, window.location.origin).searchParams.get('v');
            post(`branding/${slot}`, { restore: true, revision }, complete);
          }}>Restore previous {label.toLowerCase()}</Button>}
        </fieldset>
        {notice && <p role="status">{notice}</p>}
        {!notice && (validation || error) && <p className="error-message" role="alert">{validation || error}</p>}
      </form>
    </Card>
  );
}

export default function SettingsPage({ request, onUpdated }) {
  const [revision, setRevision] = useState(0);
  const result = useResource(request, 'settings', revision);
  const settings = result?.data;
  return (
    <>
      <header className="page-heading"><Typography component="h1" variant="h4">Settings</Typography></header>
      {!result && <p role="status">Loading settings…</p>}
      {result?.error && <p className="error-message" role="alert">
        {result.error} <Button type="button" onClick={() => setRevision(value => value + 1)}>Retry</Button>
      </p>}
      {settings && <>
        <BrandingText request={request} settings={settings} onUpdated={onUpdated} />
        <div className="inventory-summary">
          {Object.keys(imageOptions).map(slot => <BrandingImage key={slot} slot={slot}
            request={request} initialUrl={settings[`${slot}Url`]} initialFallback={settings[`${slot}FallbackUrl`]}
            onUpdated={onUpdated} />)}
        </div>
      </>}
    </>
  );
}
