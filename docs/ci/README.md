# Continuous integration

Two workflows are kept here rather than in `.github/workflows`, because the
GitHub login used to create this repository did not have permission to push
workflow files.

## Switch on the tests

```bash
gh auth refresh -s workflow
```

```bash
mkdir -p .github/workflows && cp docs/ci/test.yml .github/workflows/test.yml
```

```bash
git add .github && git commit -m "Run tests on every push" && git push
```

## Publish the app to a link

GitHub Pages on a free plan needs a public repository. Making this repository
public puts all of its code and the product images on the open web, so decide
that first.

1. Make the repository public, or move to a plan that allows private Pages.
2. In the repository settings, under Pages, set the source to GitHub Actions.
3. Copy the workflow in and push:

```bash
cp docs/ci/pages.yml .github/workflows/pages.yml
```

```bash
git add .github && git commit -m "Publish to GitHub Pages" && git push
```

The app is then served at `https://<user>.github.io/warmup-app/`. Open that on
a phone and use Add to Home Screen.

Any static host works as well. `npm run build` writes the whole app to
`dist/`, with relative paths, so the folder can be dropped anywhere.
