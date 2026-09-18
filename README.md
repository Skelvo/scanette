# Scanette

App web mobile pour scanner des codes-barres/QR et compter des pièces par
fournisseur — verrouillage par code, export CSV/PDF, aucune installation
requise.

Projet personnel, indépendant du site skelvo.fr.

## Utilisation

L'app est accessible à :
`https://scanette.gameaxoo64.workers.dev/`

Ouvrir ce lien depuis un téléphone, autoriser la caméra, et scanner.
Depuis Safari (iPhone) : Partager → "Sur l'écran d'accueil" pour l'utiliser
comme une vraie app (icône, plein écran).

## Stack

Une seule page HTML/CSS/JS, sans build ni dépendances installées :
- Scan : `BarcodeDetector` natif (Chrome/Android), repli sur
  [ZXing](https://github.com/zxing-js/library) (Safari/Firefox)
- Export : CSV, PDF ([jsPDF](https://github.com/parallax/jsPDF)), et un
  format dédié pour l'import Star6000
- Stockage : `localStorage` pour l'inventaire (propre à chaque appareil) ;
  catalogue code-barres → référence et répertoire d'emplacements en rayon
  partagés en temps réel via [Supabase](https://supabase.com)
  (tables `catalog` et `locations`)
- Hébergement : déployé automatiquement sur
  [Cloudflare Workers](https://developers.cloudflare.com/workers/) à
  chaque push sur `main` (config dans `wrangler.jsonc`)

## Base de données Supabase

En plus de la table `catalog` déjà existante, la fonctionnalité
"Emplacements" (où est rangée une référence en rayon) attend une table
`locations` dans le même projet Supabase :

```sql
create table public.locations (
  ref text primary key,
  locs jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter publication supabase_realtime add table public.locations;
```

Sans cette table (ou si le realtime n'est pas activé dessus), la
fonctionnalité reste utilisable en local sur l'appareil, mais les
emplacements ne sont pas partagés avec le reste de l'équipe.
