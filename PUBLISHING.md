# Publishing

```bash
npm version patch   # or minor / major
git push --tags
```

Then [create a release](https://github.com/jannone/msx-testing-library/releases/new) from the tag. GitHub Actions will test, build, and publish to npm automatically via trusted publishing.
