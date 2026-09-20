// Même logique de parsing que dans index.html (prototype "Commandes"),
// portée ici en CommonJS pour tourner côté serveur (Node), pas navigateur.

function labelValue(lines, label) {
  var re = new RegExp('^\\s*' + label + '\\s*:?\\s*(.+)$', 'i');
  for (var i = 0; i < lines.length; i++) {
    var m = re.exec(lines[i]);
    if (m) return m[1].trim();
  }
  return null;
}

// Le nom du client n'est pas étiqueté explicitement sur le BL (pas de
// "Client :") : d'après l'exemple vu, il apparaît juste après la ligne
// "CAPITAL SOCIAL : ...", avant l'adresse (rue, puis code postal + ville).
// Heuristique à recalibrer dès qu'on a un vrai PDF Star6000 en main.
function extractClientName(lines) {
  var capitalIdx = lines.findIndex(function (l) { return /CAPITAL SOCIAL/i.test(l); });
  if (capitalIdx === -1 || capitalIdx + 1 >= lines.length) return null;
  var candidate = lines[capitalIdx + 1];
  // Filet de sécurité : une ligne d'adresse (numéro + rue) ou un code postal
  // ne serait pas le nom du client — dans ce cas on ne sait pas, on laisse
  // le triage manuel s'en charger plutôt que de proposer un faux nom.
  if (!candidate || /^\d/.test(candidate) || /^\d{5}\s/.test(candidate)) return null;
  return candidate.trim();
}

function parseBLText(text) {
  var lines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);

  var docNumberMatch = /BON DE LIVRAISON\s+(\d+)/i.exec(text);
  var docType = labelValue(lines, 'Document');
  var docNumber = docNumberMatch ? docNumberMatch[1] : labelValue(lines, 'Num[ée]ro document');
  var docDateRaw = labelValue(lines, 'Date Document');
  var docDate = docDateRaw ? (docDateRaw.split('*')[0] || '').trim() : null;
  var refCommande = labelValue(lines, 'Ref Commande');
  var magasin = labelValue(lines, 'Etabli par');
  var client = extractClientName(lines);

  // Lignes produit : <FRS> <REF.FOUR> <DESIGNATION...> <QTE> Unite <PU>
  var lineRe = /^([A-Z0-9]{2,6})\s+([A-Z0-9#.\-]{3,15})\s+(.+?)\s+(\d+)\s*Unite\s*([\d,]+)?/i;
  var items = [];
  lines.forEach(function (l) {
    var m = lineRe.exec(l);
    if (m) {
      items.push({
        frs: m[1].toUpperCase(),
        refFournisseur: m[2].toUpperCase(),
        designation: m[3].trim(),
        qty: parseInt(m[4], 10),
        prixUnitaire: m[5] ? parseFloat(m[5].replace(',', '.')) : null
      });
    }
  });

  return {
    docType: docType, docNumber: docNumber, docDate: docDate,
    refCommande: refCommande, magasin: magasin, client: client, items: items
  };
}

function normalizeForMatch(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matchGarage(clientName, garages) {
  var target = normalizeForMatch(clientName);
  if (!target) return null;
  var targetWords = target.split(' ').filter(Boolean);
  var best = null, bestScore = 0;
  garages.forEach(function (g) {
    var gname = normalizeForMatch(g.g);
    if (gname === target) { best = g; bestScore = 1; return; }
    var gwords = gname.split(' ').filter(Boolean);
    var common = targetWords.filter(function (w) { return gwords.indexOf(w) !== -1; }).length;
    var score = common / Math.max(targetWords.length, gwords.length);
    if (score > bestScore) { bestScore = score; best = g; }
  });
  return best ? { garage: best, score: bestScore } : null;
}

function nextDepartureFor(garage) {
  if (!garage || !garage.carriers || !garage.carriers.length) return null;
  var now = new Date();
  var best = null;
  garage.carriers.forEach(function (c) {
    (c.deps || []).forEach(function (dep) {
      var m = /^(\d{1,2})h(\d{2})$/.exec(dep);
      if (!m) return;
      var d = new Date(now);
      d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
      if (d.getTime() <= now.getTime()) return;
      if (!best || d.getTime() < best.at) best = { at: d.getTime(), carrier: c.id, label: dep };
    });
  });
  return best;
}

var MATCH_CONFIDENCE_THRESHOLD = 0.8;

module.exports = {
  parseBLText: parseBLText,
  matchGarage: matchGarage,
  normalizeForMatch: normalizeForMatch,
  nextDepartureFor: nextDepartureFor,
  MATCH_CONFIDENCE_THRESHOLD: MATCH_CONFIDENCE_THRESHOLD
};
