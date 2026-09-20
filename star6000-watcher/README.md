# Watcher BL Star6000 — TEST LOCAL

Petit programme qui tourne en arrière-plan sur le PC où Star6000 imprime les
BL, et qui les pousse automatiquement dans la file de préparation Scanette
(sans que personne ait à faire quoi que ce soit).

**Jamais poussé dans l'app principale, prototype de test.**

## Comment ça marche

1. Star6000 imprime un BL comme d'habitude, sur l'imprimante déjà
   sélectionnée (rien ne change pour le vendeur).
2. Cette "imprimante" est en réalité **PDFCreator**, configuré pour à la
   fois (a) enregistrer un PDF dans un dossier, et (b) renvoyer
   l'impression vers la vraie imprimante physique.
3. Ce script surveille ce dossier. Dès qu'un PDF apparaît : il en extrait
   le texte, identifie le client et les pièces, et l'ajoute à la file
   `bl_queue` sur Supabase — visible instantanément dans Scanette, onglet
   Préparation, sur tous les appareils.
4. Le PDF traité est déplacé dans `traites/` (archive). S'il n'a pas pu
   être compris (client non identifié dans le texte, ou aucune pièce
   reconnue), il part dans `a_verifier/` pour un coup d'œil manuel.

## Installation (sur le PC qui fait tourner Star6000)

### 1. Installer Node.js

Télécharger et installer la version **LTS** depuis
[nodejs.org](https://nodejs.org/) (installeur Windows classique, suivant
suivant terminer). Une seule fois.

### 2. Copier ce dossier

Copier tout le dossier `star6000-watcher/` sur le PC (clé USB, partage
réseau, peu importe), par exemple dans `C:\ScanetteWatcher\`.

### 3. Installer les dépendances

Ouvrir une invite de commandes dans ce dossier (Maj + clic droit → "Ouvrir
la fenêtre PowerShell ici", ou `cd C:\ScanetteWatcher`), puis :

```
npm install
```

Une seule fois (télécharge les petites briques dont le script a besoin).

### 4. Configurer PDFCreator

Dans PDFCreator, créer/éditer un profil :
- **Enregistrer** : cocher, dossier de destination = par exemple
  `C:\ScanetteWatcher\a_traiter\` (créer ce dossier s'il n'existe pas).
- **Imprimer** : cocher, choisir la vraie imprimante physique en
  destination — pour que le papier sorte toujours normalement.

Renommer/faire pointer l'imprimante utilisée par Star6000 vers ce profil.

### 5. Indiquer le bon dossier au script

Ouvrir `watcher.js` avec un éditeur de texte (Bloc-notes suffit), tout en
haut dans `CONFIG.watchFolder` : mettre le même dossier que celui choisi
dans PDFCreator à l'étape 4 (ou définir la variable d'environnement
`BL_WATCH_FOLDER`, voir plus bas).

### 6. Premier essai en mode sans risque (recommandé)

Avant de le laisser tourner pour de vrai, un test qui n'écrit rien dans
Supabase (juste affiché à l'écran) :

```
set BL_DRY_RUN=1
node watcher.js
```

Imprimer un vrai BL depuis Star6000, regarder ce que le script affiche.
S'il n'arrive pas à reconnaître le client ou les pièces, envoyer le texte
affiché pour recalibrer le parseur.

### 7. Lancement pour de vrai

```
node watcher.js
```

Le laisser tourner (fenêtre ouverte) pendant les heures d'ouverture.

### 8. Démarrage automatique (pour ne pas avoir à y penser chaque matin)

Créer un fichier `demarrer.bat` dans le dossier avec ce contenu :

```
@echo off
cd /d C:\ScanetteWatcher
node watcher.js
```

Puis : touche Windows + R, taper `shell:startup`, Entrée — ça ouvre le
dossier "Démarrage". Glisser un raccourci vers `demarrer.bat` dedans. Le
script se relancera tout seul à chaque démarrage du PC.

## Réglages (variables d'environnement, optionnel)

| Variable | Rôle | Par défaut |
|---|---|---|
| `BL_WATCH_FOLDER` | Dossier surveillé (sortie PDFCreator) | `./a_traiter` |
| `BL_PROCESSED_FOLDER` | Archive des PDF traités | `./traites` |
| `BL_REVIEW_FOLDER` | PDF non compris, à vérifier à la main | `./a_verifier` |
| `BL_DRY_RUN` | `1` = n'écrit rien dans Supabase, affiche seulement | (désactivé) |

## Si ça ne reconnaît pas bien un BL

Le parseur (`bl_parser.js`) a été calibré sur un seul exemple (une photo de
BL). Le format réel généré par PDFCreator sera probablement légèrement
différent — c'est normal et attendu au premier essai. Envoyer le texte
extrait (visible dans les logs, ou dans `watcher.log`) pour ajuster les
expressions régulières de détection.
