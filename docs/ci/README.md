# Continuous integration

The live site is published by `npm run deploy`, which pushes the built app to
the `gh-pages` branch. That needs nothing beyond an ordinary repository login.

The two workflows here are optional extras. They are kept in this folder
rather than in `.github/workflows` because the GitHub login used to create
this repository did not have permission to push workflow files.

## Run the tests on every push

```bash
gh auth refresh -s workflow
```

```bash
mkdir -p .github/workflows && cp docs/ci/test.yml .github/workflows/test.yml
```

```bash
git add .github && git commit -m "Run tests on every push" && git push
```

## Publish automatically on every push

`pages.yml` builds and publishes whenever `main` changes, so `npm run deploy`
is no longer needed. To use it:

1. Run `gh auth refresh -s workflow` as above.
2. In the repository settings, under Pages, change the source from the
   `gh-pages` branch to **GitHub Actions**.
3. Copy the workflow in and push:

```bash
cp docs/ci/pages.yml .github/workflows/pages.yml
```

```bash
git add .github && git commit -m "Publish to GitHub Pages on push" && git push
```

## Taking the site down

In the repository settings, under Pages, choose **Unpublish site**. To hide the
code as well, change the repository back to private in the settings, which
also takes the site down on a free plan.
