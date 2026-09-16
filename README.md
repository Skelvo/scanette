# Scanette

App web mobile pour scanner des codes-barres/QR et compter des pièces par
fournisseur — verrouillage par code, export CSV/PDF, aucune installation
requise.

Projet personnel, indépendant du site skelvo.fr.

## Utilisation

Une fois GitHub Pages actif sur ce dépôt, l'app est accessible à :
`https://skelvo.github.io/scanette/`

Ouvrir ce lien depuis un téléphone, autoriser la caméra, et scanner.

## Stack

Une seule page HTML/CSS/JS, sans build ni dépendances installées :
- Scan : `BarcodeDetector` natif (Chrome/Android), repli sur
  [ZXing](https://github.com/zxing-js/library) (Safari/Firefox)
- Export : CSV et PDF ([jsPDF](https://github.com/parallax/jsPDF))
- Stockage : `localStorage`, propre à chaque appareil
