# List repository workflows.
default:
    @just --list

# Install dependencies for Rejudge and the site.
setup:
    bun install
    cd site && bun install

# Run the full test suite, including live tests when credentials are available.
test:
    bun run test

# Run deterministic tests without model calls.
test-unit:
    bun run test:unit

# Check TypeScript types.
typecheck:
    bun run typecheck

# Build only the standalone CLI.
build-cli:
    bun run build:cli

# Build the CLI and Pi extension.
build:
    bun run build

# Run packaged interface smoke tests and forward their arguments.
smoke-package *args:
    bun run smoke:package {{args}}

# Start the landing-page development server.
site-dev:
    cd site && bun run dev

# Build the landing page.
site-build:
    cd site && bun run build

# Preview the built landing page.
site-preview:
    cd site && bun run preview

# Deploy the landing page through its package-owned Cloudflare script.
site-deploy:
    cd site && bun run deploy

# Run the deterministic repository checks and build every artifact.
check: typecheck test-unit build site-build
