# GitHub Actions Workflows

This directory contains GitHub Actions workflows for continuous integration and deployment of the Shoehive project.

## Workflows

### `test.yml` - Run Tests

This workflow runs on pull requests to any branch and on push events to all branches.

**Purpose:**
- Ensure all tests pass when changes are proposed
- Maintain code quality by running the test suite automatically

**Steps:**
1. Checkout the code
2. Setup Node.js environment
3. Install dependencies
4. Run linters
5. Run tests
6. Build the project

### `publish.yml` - Publish to npm

This workflow runs on push events to the `main` branch only.

**Purpose:**
- Automatically publish new versions to npm when version is bumped
- Ensure only tested code is published

**Steps:**
1. Checkout the code
2. Setup Node.js environment
3. Install dependencies
4. Run tests
5. Build the project
6. Check if version has changed since the last commit
7. Publish to npm if the version has changed

## Configuration Notes

- Both workflows ignore changes to markdown files and GitHub workflow files (except their own)
- The publish workflow requires an NPM_TOKEN secret to be configured in your repository settings
- The version check compares the current package.json version with the version from the previous commit

## Adding NPM_TOKEN Secret

To set up the NPM_TOKEN secret:

1. Generate an npm access token with publish permissions
2. Go to your GitHub repository settings
3. Navigate to "Secrets and variables" > "Actions"
4. Click "New repository secret"
5. Name: `NPM_TOKEN`
6. Value: Your npm access token
7. Click "Add secret" 