# Conversation - Déploiement DodoTracker

## 1. Démarrage de l'application

**Utilisateur** : démarre moi l'appli

**Kiro** : C'est une PWA (Progressive Web App) statique — il n'y a pas de serveur Node.js à démarrer. J'ai utilisé `npx serve` pour servir les fichiers via un serveur HTTP local.

Le serveur tourne sur le port 3000. L'appli DodoTracker est accessible sur :

**http://localhost:3000**

C'est une PWA statique, donc pas de backend — tout fonctionne directement dans le navigateur avec IndexedDB pour le stockage. Tu peux aussi l'installer comme app (le navigateur devrait proposer l'option "Installer" dans la barre d'adresse).

---

## 2. Création du repository GitHub

**Utilisateur** : j'ai un compte github.com et je veux mettre cette appli dans un repository. Mon token est : `github_pat_11CLI2FZA0...`

**Kiro** : J'ai initialisé git et tenté de créer le repo, mais le token n'avait pas les permissions pour créer des repositories.

**Utilisateur** : voici le nouveau token avec les droits : `ghp_KhGVTYs...`

**Kiro** : Le repository a été créé avec succès. J'ai :
1. Créé le repo `dodo-tracker` sur GitHub
2. Ajouté tous les fichiers (app.js, index.html, styles.css, sw.js, manifest.json, icons/)
3. Fait le commit initial
4. Poussé le code sur GitHub

**Résultat** : https://github.com/Vmet-appli/dodo-tracker

---

## 3. Déploiement GitHub Pages

**Utilisateur** : peux-tu faire un déploiement sur Github via les actions de façon à ce que je puisse tester l'appli sur mon tel

**Kiro** : J'ai configuré GitHub Pages avec une GitHub Action :

1. Créé le fichier `.github/workflows/deploy.yml` avec le workflow de déploiement
2. Activé GitHub Pages via l'API GitHub (mode workflow)
3. Poussé le workflow sur le repo

**URL de l'application** : https://vmet-appli.github.io/dodo-tracker/

Le déploiement se fait automatiquement à chaque push sur la branche `main`.

---

## Fichiers du projet

```
dodo/
├── .github/
│   └── workflows/
│       └── deploy.yml      # Workflow GitHub Actions
├── icons/
│   ├── generate-icons.html
│   ├── icon-192.png
│   ├── icon-512.png
│   └── icon.svg
├── app.js                  # Logique de l'application
├── index.html              # Page principale
├── manifest.json           # Manifest PWA
├── styles.css              # Styles
└── sw.js                   # Service Worker
```

---

## Liens utiles

- **Repository** : https://github.com/Vmet-appli/dodo-tracker
- **Application en ligne** : https://vmet-appli.github.io/dodo-tracker/
- **Actions (déploiements)** : https://github.com/Vmet-appli/dodo-tracker/actions
