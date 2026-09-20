// Capture automatique des BL Star6000, TEST LOCAL — jamais poussé dans l'app.
//
// Principe : PDFCreator (installé sur le PC qui fait tourner Star6000)
// remplace l'imprimante habituelle, génère un PDF texte ET renvoie
// l'impression vers la vraie imprimante (le vendeur ne change rien à son
// geste). Ce script surveille le dossier où PDFCreator dépose ces PDF, en
// extrait le texte, identifie le client et les pièces, et pousse le BL
// directement dans la file Supabase partagée de Scanette — sans action
// humaine.
//
// Installation : voir README.md dans ce même dossier.

'use strict';

const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const pdfParse = require('pdf-parse');
const { parseBLText, matchGarage, nextDepartureFor, MATCH_CONFIDENCE_THRESHOLD } = require('./bl_parser');
const { CARRIER_LABELS, GARAGES_DATA } = require('./garages_data');

/* ================= Configuration — à adapter au PC réel ================= */
const CONFIG = {
  // Dossier où PDFCreator enregistre les PDF (à faire correspondre au
  // "Répertoire de sauvegarde" configuré dans le profil PDFCreator).
  watchFolder: process.env.BL_WATCH_FOLDER || path.join(__dirname, 'a_traiter'),
  // Les PDF traités sont déplacés ici (archive), ceux qu'on n'a pas réussi
  // à comprendre sont déplacés dans "a_verifier" pour un tri manuel.
  processedFolder: process.env.BL_PROCESSED_FOLDER || path.join(__dirname, 'traites'),
  reviewFolder: process.env.BL_REVIEW_FOLDER || path.join(__dirname, 'a_verifier'),
  logFile: process.env.BL_LOG_FILE || path.join(__dirname, 'watcher.log'),

  supabaseUrl: process.env.SUPABASE_URL || 'https://crlajjxiztvlkveitjpy.supabase.co',
  supabaseKey: process.env.SUPABASE_KEY || 'sb_publishable_xxdT_igdGriNkQeM28vhzQ_6q3AI7SU',

  // true : n'écrit rien dans Supabase, affiche juste ce qui aurait été
  // envoyé — pour calibrer le parseur sur de vrais PDF sans risque.
  dryRun: process.env.BL_DRY_RUN === '1'
};

/* ================= Utilitaires ================= */
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

function log(msg) {
  const line = '[' + new Date().toISOString() + '] ' + msg;
  console.log(line);
  try { fs.appendFileSync(CONFIG.logFile, line + '\n'); } catch (e) { /* pas bloquant */ }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Un fichier peut encore être en cours d'écriture par PDFCreator au moment
// où l'évènement "add" arrive : on attend que sa taille se stabilise avant
// de le lire, plutôt que de risquer un PDF tronqué.
function waitUntilStable(filePath, { intervalMs = 400, stableChecks = 3 } = {}) {
  return new Promise((resolve, reject) => {
    let lastSize = -1;
    let stableCount = 0;
    const tick = () => {
      fs.stat(filePath, (err, stats) => {
        if (err) { reject(err); return; }
        if (stats.size === lastSize && stats.size > 0) {
          stableCount++;
          if (stableCount >= stableChecks) { resolve(); return; }
        } else {
          stableCount = 0;
          lastSize = stats.size;
        }
        setTimeout(tick, intervalMs);
      });
    };
    tick();
  });
}

function moveTo(filePath, destFolder) {
  ensureDir(destFolder);
  const dest = path.join(destFolder, path.basename(filePath));
  fs.renameSync(filePath, dest);
  return dest;
}

/* ================= Supabase (REST direct, pas de SDK nécessaire) ================= */
async function insertBLRow(row) {
  if (CONFIG.dryRun) {
    log('[DRY RUN] Aurait envoyé à Supabase : ' + JSON.stringify(row));
    return;
  }
  const res = await fetch(CONFIG.supabaseUrl + '/rest/v1/bl_queue', {
    method: 'POST',
    headers: {
      'apikey': CONFIG.supabaseKey,
      'Authorization': 'Bearer ' + CONFIG.supabaseKey,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(row)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('Supabase a refusé l\'insertion (' + res.status + ') : ' + text);
  }
}

async function logEvent(blId, docNumber, eventType, detail) {
  if (CONFIG.dryRun) return;
  try {
    await fetch(CONFIG.supabaseUrl + '/rest/v1/bl_events', {
      method: 'POST',
      headers: {
        'apikey': CONFIG.supabaseKey,
        'Authorization': 'Bearer ' + CONFIG.supabaseKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        id: uid(), bl_id: blId, doc_number: docNumber || null, event_type: eventType,
        actor: 'Star6000 (auto)', detail: detail || null, at: new Date().toISOString()
      })
    });
  } catch (e) { log('⚠ échec écriture bl_events (non bloquant) : ' + e.message); }
}

/* ================= Traitement d'un PDF ================= */
async function handlePdf(filePath) {
  const name = path.basename(filePath);
  log('Nouveau fichier détecté : ' + name);
  try {
    await waitUntilStable(filePath);
    const buffer = fs.readFileSync(filePath);
    const parsed = await pdfParse(buffer);
    const text = parsed.text || '';

    if (!text.trim()) {
      log('⚠ ' + name + ' : aucun texte extrait (PDF image / scan ?) — déplacé pour vérification manuelle.');
      moveTo(filePath, CONFIG.reviewFolder);
      return;
    }

    const bl = parseBLText(text);

    if (!bl.items.length) {
      log('⚠ ' + name + ' : aucune ligne de pièce reconnue — déplacé pour vérification manuelle.');
      moveTo(filePath, CONFIG.reviewFolder);
      return;
    }
    if (!bl.client) {
      log('⚠ ' + name + ' : nom du client non identifié dans le texte — déplacé pour vérification manuelle.');
      moveTo(filePath, CONFIG.reviewFolder);
      return;
    }

    const match = matchGarage(bl.client, GARAGES_DATA);
    const confident = match && match.score >= MATCH_CONFIDENCE_THRESHOLD;
    const dep = confident ? nextDepartureFor(match.garage) : null;

    const nowIso = new Date().toISOString();
    const row = {
      id: 'bl-' + uid(),
      doc_number: bl.docNumber || '(sans numéro)',
      doc_date: bl.docDate || null,
      client: bl.client,
      ref_commande: bl.refCommande || '',
      garage_name: confident ? match.garage.g : null,
      carrier_label: dep ? (CARRIER_LABELS[dep.carrier] || dep.carrier) + ' ' + dep.label : null,
      departure_at: dep ? new Date(dep.at).toISOString() : null,
      status: 'pending',
      claimed_by: null,
      claimed_at: null,
      items: bl.items.map(it => ({
        ref: it.refFournisseur, barcode: null, designation: it.designation,
        qtyRequired: it.qty, qtyDone: 0
      })),
      created_by: 'Star6000 (auto)',
      created_at: nowIso,
      completed_by: null,
      completed_at: null,
      updated_at: nowIso
    };

    await insertBLRow(row);
    await logEvent(row.id, row.doc_number, 'created', { client: row.client, source: 'watcher' });

    log('✓ ' + name + ' → BL ' + row.doc_number + ' (' + row.client + (confident ? ', ' + match.garage.g : ', ⚠ client non identifié') + ') — ' + row.items.length + ' pièce(s) ajoutée(s) à la file.');
    moveTo(filePath, CONFIG.processedFolder);
  } catch (err) {
    log('✗ Erreur sur ' + name + ' : ' + err.message + ' — laissé en place pour ne pas perdre le fichier.');
  }
}

/* ================= Démarrage ================= */
ensureDir(CONFIG.watchFolder);
ensureDir(CONFIG.processedFolder);
ensureDir(CONFIG.reviewFolder);

log('=== Watcher BL Star6000 démarré ===');
log('Dossier surveillé : ' + CONFIG.watchFolder);
log(CONFIG.dryRun ? 'Mode DRY RUN (rien n\'est envoyé à Supabase)' : 'Connecté à ' + CONFIG.supabaseUrl);

const watcher = chokidar.watch(CONFIG.watchFolder, {
  ignoreInitial: false,
  awaitWriteFinish: false // on gère la stabilité nous-mêmes (waitUntilStable)
});

watcher.on('add', (filePath) => {
  if (path.extname(filePath).toLowerCase() !== '.pdf') return;
  handlePdf(filePath);
});

watcher.on('error', (err) => log('✗ Erreur du surveillant de dossier : ' + err.message));

process.on('SIGINT', () => { log('Arrêt du watcher.'); process.exit(0); });
