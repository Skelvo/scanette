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
  catalogue code-barres → référence, répertoire d'emplacements en rayon et
  stock total partagé (réception + préparation de commande) synchronisés en
  temps réel via [Supabase](https://supabase.com)
  (tables `catalog`, `locations`, `stock`, `stock_anomalies`, `stock_movements`)
- Hébergement : déployé automatiquement sur
  [Cloudflare Workers](https://developers.cloudflare.com/workers/) à
  chaque push sur `main` (config dans `wrangler.jsonc`)
- Commandes : file de BL alimentée à la main (parseur) ou automatiquement
  par `star6000-watcher/` — un petit programme séparé, à installer sur le
  PC qui fait tourner Star6000, qui capture les BL imprimés et les pousse
  dans la file sans intervention (voir `star6000-watcher/README.md`)

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

La fonctionnalité "Stock" (total permanent par référence, alimenté par la
réception et prélevé par la préparation de commande) attend deux tables et
une fonction, dans le même projet Supabase :

```sql
create table public.stock (
  ref text primary key,
  qty integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Incrément/décrément atomique côté serveur : indispensable pour que deux
-- téléphones qui scannent en même temps s'additionnent vraiment, plutôt que
-- l'un écrase la mise à jour de l'autre (ce qu'un simple upsert depuis le
-- client ferait).
create or replace function public.increment_stock(p_ref text, p_delta integer)
returns void
language sql
as $$
  insert into public.stock (ref, qty, updated_at)
  values (p_ref, p_delta, now())
  on conflict (ref) do update
    set qty = public.stock.qty + excluded.qty,
        updated_at = now();
$$;

create table public.stock_anomalies (
  id text primary key,
  ref text not null,
  qty_before integer not null,
  qty_requested integer not null,
  qty_after integer not null,
  by text,
  at timestamptz not null default now(),
  resolved boolean not null default false
);

alter publication supabase_realtime add table public.stock;
alter publication supabase_realtime add table public.stock_anomalies;
```

Sans ces tables, la réception et la préparation de commande continuent de
fonctionner (stock suivi en local sur l'appareil), mais sans partage
d'équipe ni journal d'anomalies commun.

L'onglet "Stock" (journal des entrées/sorties + recherche de quantité par
référence) attend une troisième table, un journal en ajout seul (append-only)
de chaque mouvement :

```sql
create table public.stock_movements (
  id text primary key,
  ref text not null,
  delta integer not null,
  qty_after integer not null,
  type text not null,
  by text,
  at timestamptz not null default now()
);
create index on public.stock_movements (ref);
create index on public.stock_movements (at desc);

alter publication supabase_realtime add table public.stock_movements;
```

Sans cette table, le journal des mouvements reste local à l'appareil
(pas de partage d'équipe sur l'onglet "Stock").

### File de BL / Commandes

Pour préparer les commandes depuis un BL Star6000 : file d'attente triée par
départ, verrou anti-double-prise, scan obligatoire de chaque pièce. Deux
tables sur le projet Supabase :

```sql
create table public.bl_queue (
  id text primary key,
  doc_number text,
  doc_date text,
  client text,
  ref_commande text,
  garage_name text,
  carrier_label text,
  departure_at timestamptz,
  status text not null default 'pending', -- pending | claimed | ready
  claimed_by text,
  claimed_at timestamptz,
  items jsonb not null default '[]'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  completed_by text,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter publication supabase_realtime add table public.bl_queue;

-- Journal en ajout seul : qui a fait quoi sur quel BL, à quelle heure
-- (créé, pris, relâché, pièce scannée, terminé) — historique/audit.
create table public.bl_events (
  id text primary key,
  bl_id text not null,
  doc_number text,
  event_type text not null,
  actor text,
  detail jsonb,
  at timestamptz not null default now()
);
create index on public.bl_events (bl_id);
create index on public.bl_events (at desc);
```

Le verrou anti-double-prise repose sur une mise à jour conditionnelle
(`update ... where claimed_by is null`), atomique côté serveur : si deux
personnes prennent le même BL en même temps, une seule réussit, l'autre
reçoit 0 ligne modifiée et voit le BL déjà grisé au rafraîchissement suivant.

### Prénoms uniques

Pour éviter que deux personnes choisissent le même prénom (ex. deux
"Benoit", impossible à distinguer ensuite dans les journaux), chaque
nouveau prénom est vérifié contre une liste partagée avant d'être accepté :

```sql
create table public.registered_names (
  name_key text primary key,   -- normalisé (minuscules, espaces réduits)
  name_display text not null,  -- tel que tapé, affiché partout
  created_at timestamptz not null default now()
);
```

Sans cette table, le contrôle d'unicité est simplement ignoré (jamais
bloquant) — chaque appareil garde son prénom tel quel, comme avant.

### Notes de rayon

Pour les cas où un rayon contient un lot de pièces sans référence précise à
associer une par une (ex. un surstock d'une marque), une note libre par
rayon, cherchée comme une référence dans "Emplacements" :

```sql
create table public.shelf_notes (
  shelf_code text primary key,
  note text not null,
  updated_at timestamptz not null default now()
);

alter publication supabase_realtime add table public.shelf_notes;
```

Sans cette table, ces notes restent locales à l'appareil (pas de partage
d'équipe).
