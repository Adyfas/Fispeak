# Contributing to fispeak

Thanks for taking the time to contribute. fispeak is an offline-first desktop app, so a healthy
contribution is one that keeps it **local, small, and predictable**. This guide is intentionally
short: fork, branch, build, test, open a pull request.

By participating, you agree to be respectful and constructive. Harassment, personal attacks, and
dismissive behaviour are not welcome.

---

## Before you start

- **Small fix or typo?** Open a pull request directly.
- **New feature, refactor, or behaviour change?** Open an issue first. Describe the problem, the
  proposed solution, and the scope. It is much easier to agree on a direction before writing code
  than to rewrite a large PR.
- **Security issue?** Do **not** open a public issue. Use GitHub's private
  **Security → Report a vulnerability** flow.

Keep pull requests focused. One concern per PR is easier to review and easier to revert.

---

## Workflow

1. **Fork** the repository on GitHub.
2. **Clone your fork** and add the upstream remote:

   ```bash
   git clone https://github.com/<your-user>/Fispeak.git
   cd Fispeak
   git remote add upstream https://github.com/Adyfas/Fispeak.git
   ```

3. **Create a branch** from an up-to-date `main`:

   ```bash
   git fetch upstream
   git checkout -b feat/short-description upstream/main
   ```

   Use a descriptive prefix:

   | Prefix      | Use for                      |
   | ----------- | ---------------------------- |
   | `feat/`     | new feature                  |
   | `fix/`      | bug fix                      |
   | `perf/`     | performance work             |
   | `refactor/` | internal restructuring       |
   | `docs/`     | documentation only           |
   | `test/`     | tests only                   |
   | `chore/`    | tooling, dependencies, build |

4. **Make your change**, then run the checks below.
5. **Commit** with a clear message (see [Commit messages](#commit-messages)).
6. **Push** your branch to your fork and open a pull request against `main`.

---

## Development setup

Requirements are listed in the [README](README.md#requirements). In short: macOS 13+, Node 20+,
pnpm 10, Python 3.11, and ffmpeg.

```bash
pnpm install
python3.11 -m venv .venv
.venv/bin/pip install -r sidecar/requirements.txt
pnpm dev
```

The Python sidecar is started on demand by the app. Use `pnpm dev:sidecar` if you want to run it
alone while debugging. Models are downloaded into
`~/Library/Application Support/fispeak/models` and are never committed.

---

## Quality gates

A pull request is ready when all of these pass locally:

```bash
pnpm typecheck     # TypeScript, main + renderer
pnpm lint          # ESLint
pnpm test          # Vitest
pnpm test:sidecar  # pytest
pnpm build         # production build
```

Guidelines:

- Add or update tests for every behaviour change. Bug fixes should include a regression test
  when the behaviour can be tested.
- Do not weaken or delete existing tests to make a change pass.
- Keep the build warning-free. Fix the cause, not the symptom.
- If a change touches the UI, include a screenshot or a short screen recording in the PR.

---

## Code guidelines

- **TypeScript is strict.** Avoid `any`; if it is unavoidable, explain why in a comment.
- **Respect the process boundaries.** The renderer never talks to the Python sidecar directly.
  It uses the preload/IPC bridge; the main process owns windows, the database, audio, and network
  calls.
- **Stay local-first.** Do not add telemetry, analytics, or hidden network calls. Any feature that
  sends data off the machine must be opt-in and documented.
- **Keep the island small.** UI text should be short and simple. New pages belong in the feature
  rail; avoid adding dashboard-style clutter.
- **Match the existing style.** Follow the naming, file layout, and patterns around you instead of
  introducing a parallel abstraction.
- **Handle failure.** A missing model, a denied permission, or an offline machine must produce a
  clear message, not a crash or a silent no-op.
- **No secrets, no artifacts.** Never commit API keys, `.env` files, model weights, build output,
  logs, databases, or personal paths.

### Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add hover labels to the feature rail
fix: release the sidecar when dictation stops
perf: keep the island window from resizing on page change
docs: explain the local model layout
```

Write the subject in the imperative mood, keep it under ~72 characters, and use the body to
explain **why** the change is needed when it is not obvious.

---

## Pull request checklist

Before opening a PR, confirm:

- [ ] The branch is rebased on the latest `main`
- [ ] The change is focused on one problem
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:sidecar`, and `pnpm build` pass
- [ ] New behaviour is covered by tests
- [ ] UI changes include a screenshot or recording
- [ ] No secrets, models, build artifacts, or unrelated files are included
- [ ] Documentation is updated when behaviour or setup changes

In the PR description, explain **what** changed, **why**, and **how you verified it**. Link the
issue it closes, for example `Closes #42`.

A maintainer may ask for changes or suggest a different approach. That is normal review, not a
rejection.

---

## Reporting bugs

A useful bug report includes:

- what you expected and what actually happened,
- steps to reproduce,
- your macOS version and Mac model (Apple Silicon or Intel),
- the relevant log lines (the terminal running `pnpm dev`, or the app log file),
- a screenshot or recording for UI issues.

Please remove personal data (titles, transcripts, file paths) before posting logs.

---

## License

fispeak is released under the [MIT License](LICENSE). By submitting a contribution, you agree that
your contribution is licensed under the same terms.
