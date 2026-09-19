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
  (tables `catalog`, `locations`, `stock`, `stock_anomalies`)
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
