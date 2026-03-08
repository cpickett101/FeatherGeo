# Contributing to FeatherGeo

Thanks for your interest in contributing. Here's everything you need to get going.

## Running locally

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The dev server hot-reloads on save.

## Building

```bash
npm run build
```

Output goes to `dist/`. Run `npm run preview` to serve the production build locally.

## Making changes

1. Fork the repo
2. Create a branch: `git checkout -b my-feature`
3. Make your changes and test them in the browser
4. Commit with a clear message describing what and why
5. Push and open a pull request against `main`

## Pull request guidelines

- Keep PRs focused — one feature or fix per PR
- Describe what the change does and why in the PR description
- If fixing a bug, link the related issue

## Reporting bugs

Open an [issue](https://github.com/cpickett101/FeatherGeo/issues) with:
- What you did
- What you expected to happen
- What actually happened
- Browser and OS

## Code style

- TypeScript throughout — avoid `any` where possible
- Components live in `src/components/`, utilities in `src/lib/`
- Keep components focused; lift state only when necessary
