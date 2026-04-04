# Code Review Rules

## General
- JavaScript ES Modules only (no CommonJS, no TypeScript)
- No classes unless already present in the file
- async/await over callbacks or raw promises
- Console logs must use `[ServiceName]` prefix

## Node.js / Backend
- Services in `backend/src/services/`
- Routes in `backend/src/routes/`
- No test framework required
- Environment variables via `process.env` with inline defaults using `??`

## Style
- Single quotes for strings in code (JSDoc comments are exempt)
- 2-space indentation
- Named exports, no default exports

## Language
- Code comments and console log messages may be in Spanish or English — both are acceptable
- Telegram message strings are intentionally in Spanish for end users — do NOT flag as violations
- Do NOT invent rules that are not listed above
