import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const sourcePath = fileURLToPath(new URL('../../supabase/config.toml', import.meta.url));
const defaultSite = 'https://english-learning-lab.pages.dev';
const defaultPreview = 'https://preview.english-learning-lab.pages.dev';

function httpsOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Auth URLs must be exact HTTPS origins.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      url.pathname !== '/' || url.search || url.hash ||
      !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) ||
      /(^|\.)(localhost|local|internal|invalid)$/.test(url.hostname)) {
    throw new Error('Auth URLs must be exact public HTTPS origins without paths, credentials, ports or wildcards.');
  }
  return url.origin;
}

function replaceSettings(lines, section, values) {
  let active = false;
  const seen = new Set();
  for (let index = 0; index < lines.length; index++) {
    const header = lines[index].match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (header) active = header[1] === section;
    if (!active) continue;
    const assignment = lines[index].match(/^\s*([a-z_]+)\s*=/);
    if (!assignment || !Object.hasOwn(values, assignment[1])) continue;
    const key = assignment[1];
    if (seen.has(key)) throw new Error(`Duplicate ${section}.${key} in source config.`);
    seen.add(key);
    lines[index] = `${key} = ${JSON.stringify(values[key])}`;
  }
  for (const key of Object.keys(values)) {
    if (!seen.has(key)) throw new Error(`Missing ${section}.${key} in source config.`);
  }
}

export function prepareCloudConfig({target, siteUrl = defaultSite, previewUrl = defaultPreview}) {
  if (!target) throw new Error('Provide a separate empty output directory with --target.');
  const site = httpsOrigin(siteUrl), preview = httpsOrigin(previewUrl);
  if (site === preview) throw new Error('Production and Preview origins must be different.');
  const output = path.resolve(target);
  if (fs.existsSync(output)) {
    if (!fs.lstatSync(output).isDirectory() || fs.lstatSync(output).isSymbolicLink() || fs.readdirSync(output).length) {
      throw new Error('Output directory must be empty and must not be a symlink.');
    }
  }
  const original = fs.readFileSync(sourcePath, 'utf8');
  const lines = original.split('\n');
  const redirects = [site, `${site}/?recovery=1`, preview, `${preview}/?recovery=1`];
  replaceSettings(lines, 'auth', {
    site_url: site,
    additional_redirect_urls: redirects,
    enable_signup: false,
  });
  replaceSettings(lines, 'auth.email', {
    enable_signup: true,
    enable_confirmations: true,
    secure_password_change: true,
    max_frequency: '60s',
  });
  fs.mkdirSync(path.join(output, 'supabase'), {recursive: true, mode: 0o700});
  const configPath = path.join(output, 'supabase', 'config.toml');
  fs.writeFileSync(configPath, lines.join('\n'), {flag: 'wx', mode: 0o600});
  return {configPath, siteUrl: site, additionalRedirectUrls: redirects, pushed: false};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const usage = 'Usage: node scripts/operations/prepare-cloud-config.mjs --target <empty-dir> [--site-url <HTTPS-origin>] [--preview-url <HTTPS-origin>]';
  if (args.includes('--help')) { console.log(usage); process.exit(0); }
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = {'--target': 'target', '--site-url': 'siteUrl', '--preview-url': 'previewUrl'}[args[index]];
    if (!key || options[key] || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(usage);
    options[key] = args[index + 1];
  }
  console.log(JSON.stringify(prepareCloudConfig(options), null, 2));
}
