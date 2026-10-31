# Contributing to Brightloop

Thank you for your interest in contributing to Brightloop! We welcome contributions, bug reports, feature suggestions, and documentation improvements.

---

## Code of Conduct

All contributors and maintainers are expected to adhere to our [Code of Conduct](CODE_OF_CONDUCT.md). Please report any violations to **security@brightloop.io**.

---

## Getting Started

### 1. Prerequisites
- **Node.js**: v20 or higher
- **npm**: v10 or higher
- **Python**: v3.12 or higher (for backend development)
- **Docker & Docker Compose** (optional for local multi-service orchestration)

### 2. Fork and Clone
```bash
git clone https://github.com/<your-username>/brightloop.git
cd brightloop
```

### 3. Setup Frontend
```bash
cd frontend
npm install
npm run dev
```

### 4. Setup Backend (Optional)
```bash
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload
```

---

## Development Workflow

1. **Branching Strategy**:
   - Create feature or bugfix branches off `main`.
   - Branch naming convention:
     - `feat/<short-description>` (e.g., `feat/dunning-webhook-retry`)
     - `fix/<short-description>` (e.g., `fix/tax-rounding-edge-case`)
     - `docs/<short-description>` (e.g., `docs/api-spec-update`)

2. **Commit Message Discipline**:
   We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:
   - `feat(scope): add support for quarterly billing cadence`
   - `fix(scope): prevent negative discount calculation on zero subtotal`
   - `test(scope): add e2e test for invoice settlement reversal`
   - `docs(scope): update environment variable documentation`

---

## Quality Gates & Verification

Before submitting a Pull Request, ensure all local checks pass:

```bash
# 1. Typecheck TypeScript files
npm --prefix frontend run typecheck

# 2. Linting (0 warnings enforced)
npm --prefix frontend run lint

# 3. Unit and integration tests
npm --prefix frontend run test

# 4. Production build verification
npm --prefix frontend run build
```

---

## Submitting a Pull Request

1. Push your branch to your fork.
2. Open a Pull Request targeting the `main` branch.
3. Fill out the provided [Pull Request Template](.github/pull_request_template.md).
4. Ensure CI checks pass.
5. Address any code review comments promptly.

---

## Questions & Support

Feel free to open an issue or reach out to the project maintainers if you need guidance on architecture, domain rules, or setup.

