# Contributing to Shoehive

Thank you for considering contributing to Shoehive! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

1. [Development Setup](#-development-setup)
2. [Code Style](#-code-style)
3. [Testing](#-testing)
4. [Pull Requests](#-pull-requests)
5. [Release Process](#-release-process)

## Development Setup

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/shoehive.git`
3. Install dependencies: `npm install`
4. Build the project: `npm run build`
5. Run tests: `npm test`

### Node.js Version Requirements

Shoehive requires Node.js 18.0.0 or later. This is specified in the `engines` field in package.json.

If you're using nvm (Node Version Manager), you can switch to the appropriate version with:

```bash
nvm use 18
```

## Code Style

We use ESLint to enforce consistent code style. Our linting rules are defined in `.eslintrc.js`.

### Running the Linter

```bash
npm run lint
```

### Linting Rules

We've configured ESLint with the following rules:
- Extends the recommended ESLint and TypeScript ESLint rulesets
- Warns on `any` types (but doesn't error, as framework code sometimes requires them)
- Allows unused variables prefixed with underscore (e.g., `_unusedVar`)

If you need to ignore a specific ESLint rule in a particular line, you can use:

```typescript
// eslint-disable-next-line rule-name
const someCode = 'that would trigger the rule';
```

## Testing

We use Jest for testing. All new features should include tests, and all tests must pass before a pull request can be merged.

### Running Tests

```bash
# Run all tests
npm test

# Run tests with coverage
npm test -- --coverage
```

### Writing Tests

- Test files should be placed in the `tests` directory
- Test files should be named `*.test.ts`
- Use descriptive test names that explain what the test is verifying

## Pull Requests

1. Create a new branch for your feature or bug fix
2. Make your changes
3. Run tests to ensure they pass
4. Run the linter to ensure code quality
5. Submit a pull request to the `dev` branch
6. Wait for code review and address any feedback

### Commit Messages

Please use clear and descriptive commit messages. For significant changes, include a detailed description in the commit body.

## Release Process

Releases are managed by the maintainers. We use GitHub Actions for automated testing and publishing to npm.

### Version Bumping

When preparing a release:
1. Update the version in `package.json` according to [Semantic Versioning](https://semver.org/)
2. The GitHub Actions workflow will automatically publish to npm when a version change is detected on the main branch

### Release Notes

Release notes are maintained in the GitHub Releases section. Each release should include:
- Summary of changes
- New features
- Bug fixes
- Breaking changes (if any) 